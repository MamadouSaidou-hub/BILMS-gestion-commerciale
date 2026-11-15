import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import { db } from '../client'
import { paymentAllocations, payments, paymentMethod, receivables, supplierPaymentAllocations, supplierPayables, supplierPayments } from '../schema'
import { writeAuditLog, type Actor } from './audit'
import { recordAutoCashMovement } from './cash-accounts'

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

export async function recordPayment(input: {
  clientId: number
  amount: number
  method: (typeof paymentMethod)[number]
  storeId: number
  date?: string | null
}) {
  const payment = await db.transaction(async (tx) => {
    const [payment] = await tx
      .insert(payments)
      .values({ clientId: input.clientId, saleId: null, storeId: input.storeId, amount: input.amount, method: input.method, date: input.date ?? null })
      .returning()

    await allocateToReceivables(tx, payment.id, input.clientId, input.amount)
    return payment
  })

  await recordAutoCashMovement({
    direction: 'in',
    amount: input.amount,
    storeId: input.storeId,
    category: 'Encaissement client',
    description: `Paiement #${payment.id}`,
    date: input.date ?? null,
  })

  return payment
}

export async function updatePayment(
  id: number,
  input: { amount: number; method: (typeof paymentMethod)[number]; storeId: number; date?: string | null },
  actor: Actor,
  reason?: string,
) {
  if (input.amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }

  const { existing, updated } = await db.transaction(async (tx) => {
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
      .set({ amount: input.amount, method: input.method, storeId: input.storeId, date: input.date ?? null })
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

    return { existing, updated }
  })

  // Skipped when the amount didn't change (a method or date correction): a +X/-X pair that nets to
  // zero only clutters the caisse's history. Same reasoning as updateSale.
  if (existing.amount !== input.amount) {
    await recordAutoCashMovement({
      direction: 'out',
      amount: existing.amount,
      storeId: existing.storeId,
      category: 'Correction paiement',
      description: `Correction paiement #${existing.id} (ancien montant)`,
      date: existing.date,
    })
    await recordAutoCashMovement({
      direction: 'in',
      amount: input.amount,
      storeId: input.storeId,
      category: 'Correction paiement',
      description: `Correction paiement #${existing.id} (nouveau montant)`,
      date: input.date ?? null,
    })
  }

  return updated
}

export async function deletePayment(id: number, actor: Actor, reason?: string) {
  const deleted = await db.transaction(async (tx) => {
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

  await recordAutoCashMovement({
    direction: 'out',
    amount: deleted.amount,
    storeId: deleted.storeId,
    category: 'Annulation paiement',
    description: `Annulation paiement #${deleted.id}`,
    date: deleted.date,
  })

  return deleted
}

/** Supplier-side mirror of `allocateToReceivables`/`reversePaymentAllocations` above. */
async function allocateToPayables(tx: Tx, paymentId: number, supplierId: number, amount: number) {
  let remaining = amount
  const openPayables = await tx
    .select()
    .from(supplierPayables)
    .where(and(eq(supplierPayables.supplierId, supplierId), ne(supplierPayables.status, 'paid')))
    .orderBy(asc(supplierPayables.dueDate))

  for (const payable of openPayables) {
    if (remaining <= 0) break
    const applied = Math.min(remaining, payable.amount)
    remaining -= applied
    if (applied >= payable.amount) {
      await tx.update(supplierPayables).set({ amount: 0, status: 'paid' }).where(eq(supplierPayables.id, payable.id))
    } else {
      await tx.update(supplierPayables).set({ amount: payable.amount - applied }).where(eq(supplierPayables.id, payable.id))
    }
    await tx.insert(supplierPaymentAllocations).values({ paymentId, payableId: payable.id, amount: applied })
  }
}

async function reverseSupplierPaymentAllocations(tx: Tx, paymentId: number) {
  const allocations = await tx.select().from(supplierPaymentAllocations).where(eq(supplierPaymentAllocations.paymentId, paymentId))
  for (const allocation of allocations) {
    const [payable] = await tx.select().from(supplierPayables).where(eq(supplierPayables.id, allocation.payableId))
    if (payable) {
      await tx
        .update(supplierPayables)
        .set({ amount: payable.amount + allocation.amount, status: payable.status === 'paid' ? 'pending' : payable.status })
        .where(eq(supplierPayables.id, payable.id))
    }
  }
  await tx.delete(supplierPaymentAllocations).where(eq(supplierPaymentAllocations.paymentId, paymentId))
}

export async function recordSupplierPayment(input: {
  supplierId: number
  amount: number
  method: (typeof paymentMethod)[number]
  date?: string | null
}) {
  const payment = await db.transaction(async (tx) => {
    const [payment] = await tx
      .insert(supplierPayments)
      .values({ supplierId: input.supplierId, amount: input.amount, method: input.method, date: input.date ?? null })
      .returning()

    await allocateToPayables(tx, payment.id, input.supplierId, input.amount)
    return payment
  })

  // Suppliers aren't store-scoped, so this resolves to the default caisse regardless.
  await recordAutoCashMovement({
    direction: 'out',
    amount: input.amount,
    category: 'Paiement fournisseur',
    description: `Paiement fournisseur #${payment.id}`,
    date: input.date ?? null,
  })

  return payment
}

export async function updateSupplierPayment(
  id: number,
  input: { amount: number; method: (typeof paymentMethod)[number]; date?: string | null },
  actor: Actor,
  reason?: string,
) {
  if (input.amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }

  const { existing, updated } = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(supplierPayments).where(and(eq(supplierPayments.id, id), isNull(supplierPayments.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Paiement introuvable.')
    }

    await reverseSupplierPaymentAllocations(tx, id)

    const [updated] = await tx
      .update(supplierPayments)
      .set({ amount: input.amount, method: input.method, date: input.date ?? null })
      .where(eq(supplierPayments.id, id))
      .returning()

    await allocateToPayables(tx, id, existing.supplierId, input.amount)

    await writeAuditLog(tx, {
      entityType: 'supplier_payment',
      entityId: id,
      action: 'update',
      actor,
      reason,
      beforeData: existing,
      afterData: updated,
    })

    return { existing, updated }
  })

  // Reversing an outflow brings that money back ("in"); applying the corrected amount sends it
  // back out ("out") — same two-entry pattern as updatePayment above, and skipped the same way
  // when the amount didn't change.
  if (existing.amount !== input.amount) {
    await recordAutoCashMovement({
      direction: 'in',
      amount: existing.amount,
      category: 'Correction paiement fournisseur',
      description: `Correction paiement fournisseur #${existing.id} (ancien montant)`,
      date: existing.date,
    })
    await recordAutoCashMovement({
      direction: 'out',
      amount: input.amount,
      category: 'Correction paiement fournisseur',
      description: `Correction paiement fournisseur #${existing.id} (nouveau montant)`,
      date: input.date ?? null,
    })
  }

  return updated
}

export async function deleteSupplierPayment(id: number, actor: Actor, reason?: string) {
  const deleted = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(supplierPayments).where(and(eq(supplierPayments.id, id), isNull(supplierPayments.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Paiement introuvable.')
    }

    await reverseSupplierPaymentAllocations(tx, id)

    const [deleted] = await tx
      .update(supplierPayments)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(supplierPayments.id, id))
      .returning()

    await writeAuditLog(tx, {
      entityType: 'supplier_payment',
      entityId: id,
      action: 'delete',
      actor,
      reason,
      beforeData: existing,
    })

    return deleted
  })

  await recordAutoCashMovement({
    direction: 'in',
    amount: deleted.amount,
    category: 'Annulation paiement fournisseur',
    description: `Annulation paiement fournisseur #${deleted.id}`,
    date: deleted.date,
  })

  return deleted
}
