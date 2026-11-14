import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import { db } from '../client'
import { paymentAllocations, payments, paymentMethod, receivables, supplierPayables, supplierPayments } from '../schema'
import { writeAuditLog, type Actor } from './audit'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** FIFO-allocates `amount` across a client's open receivables (oldest due date first), recording
 * exactly which receivable got how much in `paymentAllocations` so the allocation can be reversed
 * precisely later (see schema.ts's comment on that table). */
async function allocateToReceivables(tx: Tx, paymentId: number, clientId: number, amount: number) {
  let remaining = amount
  const openReceivables = await tx
    .select()
    .from(receivables)
    .where(and(eq(receivables.clientId, clientId), ne(receivables.status, 'paid')))
    .orderBy(asc(receivables.dueDate))

  for (const receivable of openReceivables) {
    if (remaining <= 0) break
    const applied = Math.min(remaining, receivable.amount)
    remaining -= applied
    if (applied >= receivable.amount) {
      await tx.update(receivables).set({ amount: 0, status: 'paid' }).where(eq(receivables.id, receivable.id))
    } else {
      await tx.update(receivables).set({ amount: receivable.amount - applied }).where(eq(receivables.id, receivable.id))
    }
    await tx.insert(paymentAllocations).values({ paymentId, receivableId: receivable.id, amount: applied })
  }
}

/** Undoes `allocateToReceivables`: adds each allocated amount back onto its receivable (reopening
 * it if it had been marked paid), then removes the allocation rows. A receivable that no longer
 * exists (e.g. its sale was since cancelled, cascading the receivable away) has nothing to restore
 * — there's no debt left to reopen either way, so it's simply skipped. */
async function reversePaymentAllocations(tx: Tx, paymentId: number) {
  const allocations = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId))
  for (const allocation of allocations) {
    const [receivable] = await tx.select().from(receivables).where(eq(receivables.id, allocation.receivableId))
    if (receivable) {
      await tx
        .update(receivables)
        .set({ amount: receivable.amount + allocation.amount, status: receivable.status === 'paid' ? 'pending' : receivable.status })
        .where(eq(receivables.id, receivable.id))
    }
  }
  await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId))
}

export async function recordPayment(input: { clientId: number; amount: number; method: (typeof paymentMethod)[number]; storeId: number }) {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .insert(payments)
      .values({ clientId: input.clientId, saleId: null, storeId: input.storeId, amount: input.amount, method: input.method })
      .returning()

    await allocateToReceivables(tx, payment.id, input.clientId, input.amount)
    return payment
  })
}

export async function updatePayment(
  id: number,
  input: { amount: number; method: (typeof paymentMethod)[number]; storeId: number },
  actor: Actor,
  reason?: string,
) {
  if (input.amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(payments).where(and(eq(payments.id, id), isNull(payments.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Paiement introuvable.')
    }
    if (existing.saleId !== null) {
      throw new Error('Ce paiement est lié à une vente — modifiez/annulez la vente directement.')
    }

    await reversePaymentAllocations(tx, id)

    const [updated] = await tx
      .update(payments)
      .set({ amount: input.amount, method: input.method, storeId: input.storeId })
      .where(eq(payments.id, id))
      .returning()

    await allocateToReceivables(tx, id, existing.clientId, input.amount)

    await writeAuditLog(tx, {
      entityType: 'payment',
      entityId: id,
      action: 'update',
      actor,
      reason,
      beforeData: existing,
      afterData: updated,
    })

    return updated
  })
}

export async function deletePayment(id: number, actor: Actor, reason?: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(payments).where(and(eq(payments.id, id), isNull(payments.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Paiement introuvable.')
    }
    if (existing.saleId !== null) {
      throw new Error('Ce paiement est lié à une vente — modifiez/annulez la vente directement.')
    }

    await reversePaymentAllocations(tx, id)

    const [deleted] = await tx
      .update(payments)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(payments.id, id))
      .returning()

    await writeAuditLog(tx, {
      entityType: 'payment',
      entityId: id,
      action: 'delete',
      actor,
      reason,
      beforeData: existing,
    })

    return deleted
  })
}

export async function recordSupplierPayment(input: { supplierId: number; amount: number; method: (typeof paymentMethod)[number] }) {
  await db.insert(supplierPayments).values({
    supplierId: input.supplierId,
    amount: input.amount,
    method: input.method,
  })

  let remaining = input.amount
  const openPayables = await db
    .select()
    .from(supplierPayables)
    .where(and(eq(supplierPayables.supplierId, input.supplierId), ne(supplierPayables.status, 'paid')))
    .orderBy(asc(supplierPayables.dueDate))

  for (const payable of openPayables) {
    if (remaining <= 0) break
    if (remaining >= payable.amount) {
      remaining -= payable.amount
      await db.update(supplierPayables).set({ amount: 0, status: 'paid' }).where(eq(supplierPayables.id, payable.id))
    } else {
      await db.update(supplierPayables).set({ amount: payable.amount - remaining }).where(eq(supplierPayables.id, payable.id))
      remaining = 0
    }
  }
}
