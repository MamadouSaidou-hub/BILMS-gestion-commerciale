import { and, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { payments, products, receivables, saleItems, sales, stockLevels, stockMovements } from '../schema'
import { getQuantity } from './shared'
import { writeAuditLog, type Actor } from './audit'
import { recordAutoCashMovement } from './cash-accounts'

type SaleItemInput = { productId: number; quantity: number; unitPrice: number }

export async function createSale(input: {
  storeId: number
  clientId?: number | null
  paymentStatus: 'paid' | 'partial' | 'credit'
  paidNow: number
  dueInDays: number
  saleDate?: string | null
  items: SaleItemInput[]
}) {
  if (input.items.length === 0) {
    throw new Error('Une vente doit contenir au moins un article.')
  }

  const sale = await db.transaction(async (tx) => {
    const resolved = await resolveAndCheckStock(tx, input.storeId, input.items)

    // A Postgres sequence (not a count of existing rows) — counting breaks the moment a sale is
    // ever deleted (reused number) or two sales are created at nearly the same instant (both read
    // the same count before either inserts, both compute the same reference, the second insert
    // fails on the unique constraint). nextval() is atomic and never hands out the same value twice.
    const seqResult = await tx.execute<{ next: string }>(sql`SELECT nextval('sales_reference_seq') AS next`)
    const reference = `BG-${1000 + Number(seqResult.rows[0].next)}`

    const [sale] = await tx
      .insert(sales)
      .values({
        reference,
        storeId: input.storeId,
        clientId: input.clientId ?? null,
        totalAmount: resolved.totalAmount,
        costAmount: resolved.costAmount,
        paymentStatus: input.paymentStatus,
        saleDate: input.saleDate ?? null,
      })
      .returning()

    await applySaleEffects(tx, sale, resolved.items, input)
    return sale
  })

  // Outside the transaction: recordAutoCashMovement uses its own connection, and only runs once
  // the sale has actually committed (never want a cash entry for a sale that got rolled back).
  const receivedNow = input.paymentStatus === 'paid' ? sale.totalAmount : input.paymentStatus === 'partial' ? input.paidNow : 0
  if (receivedNow > 0) {
    await recordAutoCashMovement({
      direction: 'in',
      amount: receivedNow,
      storeId: input.storeId,
      category: 'Vente',
      description: `Vente #${sale.reference}`,
      date: sale.saleDate,
    })
  }

  return sale
}

export async function updateSale(
  reference: string,
  input: {
    storeId: number
    clientId?: number | null
    paymentStatus: 'paid' | 'partial' | 'credit'
    paidNow: number
    dueInDays: number
    saleDate?: string | null
    items: SaleItemInput[]
  },
  actor: Actor,
  reason?: string,
) {
  if (input.items.length === 0) {
    throw new Error('Une vente doit contenir au moins un article.')
  }

  const { updated, reversedAmount } = await db.transaction(async (tx) => {
    const [existingSale] = await tx.select().from(sales).where(eq(sales.reference, reference)).for('update')
    if (!existingSale || existingSale.deletedAt) {
      throw new Error('Vente introuvable.')
    }
    await assertNoExternalPaymentSince(tx, existingSale)
    const existingItems = await tx.select().from(saleItems).where(eq(saleItems.saleId, existingSale.id))
    const existingPayments = await tx.select().from(payments).where(eq(payments.saleId, existingSale.id))
    const existingReceivables = await tx.select().from(receivables).where(eq(receivables.saleId, existingSale.id))
    const beforeData = { sale: existingSale, items: existingItems, payments: existingPayments, receivables: existingReceivables }

    // What this sale actually put in the caisse at creation time: the full total if it was paid
    // in full on the spot (no `payments` row for that case — see applySaleEffects), otherwise
    // whatever partial amount was recorded against it (0 for a pure credit sale).
    const reversedAmount = existingSale.paymentStatus === 'paid' ? existingSale.totalAmount : existingPayments.reduce((sum, p) => sum + p.amount, 0)

    await reverseSaleEffects(tx, existingSale, existingItems)

    const resolved = await resolveAndCheckStock(tx, input.storeId, input.items)

    const [updated] = await tx
      .update(sales)
      .set({
        storeId: input.storeId,
        clientId: input.clientId ?? null,
        totalAmount: resolved.totalAmount,
        costAmount: resolved.costAmount,
        paymentStatus: input.paymentStatus,
        saleDate: input.saleDate ?? null,
      })
      .where(eq(sales.id, existingSale.id))
      .returning()

    await applySaleEffects(tx, updated, resolved.items, input)

    const newItems = await tx.select().from(saleItems).where(eq(saleItems.saleId, updated.id))
    const newPayments = await tx.select().from(payments).where(eq(payments.saleId, updated.id))
    const newReceivables = await tx.select().from(receivables).where(eq(receivables.saleId, updated.id))
    await writeAuditLog(tx, {
      entityType: 'sale',
      entityId: updated.id,
      action: 'update',
      actor,
      reason,
      beforeData,
      afterData: { sale: updated, items: newItems, payments: newPayments, receivables: newReceivables },
    })

    return { updated, reversedAmount }
  })

  // Outside the transaction, mirroring createSale: never edit a historical cash entry in place,
  // append a compensating pair instead — an "out" for whatever the old version put in the caisse,
  // an "in" for whatever the corrected version actually puts in. Two entries rather than one
  // netted figure keeps the caisse's own history legible (a correction happened here).
  //
  // Skipped entirely when the correction left the cash side untouched (fixing only the date or the
  // client, say): a +X/-X pair that nets to zero tells the reader nothing and has to be cleaned up
  // by hand.
  const receivedNow = input.paymentStatus === 'paid' ? updated.totalAmount : input.paymentStatus === 'partial' ? input.paidNow : 0
  const cashUnchanged = reversedAmount === receivedNow

  if (!cashUnchanged && reversedAmount > 0) {
    await recordAutoCashMovement({
      direction: 'out',
      amount: reversedAmount,
      storeId: updated.storeId,
      category: 'Correction vente',
      description: `Correction vente #${updated.reference} (ancien montant)`,
      date: updated.saleDate,
    })
  }
  if (!cashUnchanged && receivedNow > 0) {
    await recordAutoCashMovement({
      direction: 'in',
      amount: receivedNow,
      storeId: updated.storeId,
      category: 'Correction vente',
      description: `Correction vente #${updated.reference} (nouveau montant)`,
      date: updated.saleDate,
    })
  }

  return updated
}

export async function cancelSale(reference: string, actor: Actor, reason?: string) {
  const { cancelled, reversedAmount } = await db.transaction(async (tx) => {
    const [existingSale] = await tx.select().from(sales).where(eq(sales.reference, reference)).for('update')
    if (!existingSale || existingSale.deletedAt) {
      throw new Error('Vente introuvable.')
    }
    await assertNoExternalPaymentSince(tx, existingSale)
    const existingItems = await tx.select().from(saleItems).where(eq(saleItems.saleId, existingSale.id))
    const existingPayments = await tx.select().from(payments).where(eq(payments.saleId, existingSale.id))
    const existingReceivables = await tx.select().from(receivables).where(eq(receivables.saleId, existingSale.id))
    const beforeData = { sale: existingSale, items: existingItems, payments: existingPayments, receivables: existingReceivables }

    const reversedAmount = existingSale.paymentStatus === 'paid' ? existingSale.totalAmount : existingPayments.reduce((sum, p) => sum + p.amount, 0)

    await reverseSaleEffects(tx, existingSale, existingItems)

    const [cancelled] = await tx
      .update(sales)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(sales.id, existingSale.id))
      .returning()

    await writeAuditLog(tx, {
      entityType: 'sale',
      entityId: existingSale.id,
      action: 'delete',
      actor,
      reason,
      beforeData,
    })

    return { cancelled, reversedAmount }
  })

  // Outside the transaction, same reasoning as createSale/updateSale: never delete the original
  // "money came in" record, add an equal-and-opposite one instead — the caisse's history should
  // show that a sale happened and was later cancelled, not pretend it never did.
  if (reversedAmount > 0) {
    await recordAutoCashMovement({
      direction: 'out',
      amount: reversedAmount,
      storeId: cancelled.storeId,
      category: 'Annulation vente',
      description: `Annulation vente #${cancelled.reference}`,
      date: cancelled.saleDate,
    })
  }

  return cancelled
}

// ─── Shared helpers ─────────────────────────────────────────────────────

type Queryable = Pick<typeof db, 'select'>

/** `recordPayment` (lib/db/mutations/payments.ts) allocates standalone client payments against
 * open receivables independently of any sale, with no link back to the sale that produced them —
 * so if one of those payments already reduced or settled this sale's receivable, deleting and
 * recreating it from `totalAmount - paidNow` (as a plain edit/cancel would) silently resurrects a
 * debt the client already paid off. Refuse rather than risk double-billing; the admin has to
 * correct the créance directly in that case. */
async function assertNoExternalPaymentSince(tx: Queryable, sale: typeof sales.$inferSelect) {
  const [receivable] = await tx.select().from(receivables).where(eq(receivables.saleId, sale.id))
  if (!receivable) return

  const linkedPayments = await tx.select().from(payments).where(eq(payments.saleId, sale.id))
  const paidAtCreation = linkedPayments.reduce((sum, payment) => sum + payment.amount, 0)
  const expectedRemaining = sale.totalAmount - paidAtCreation

  if (receivable.status === 'paid' || receivable.amount !== expectedRemaining) {
    throw new Error(
      'Cette vente a déjà été encaissée (totalement ou partiellement) via la Trésorerie depuis sa création — modification/suppression impossible. Corrigez la créance directement si besoin.',
    )
  }
}

/** Resolves each item's unit from its product (fixed at product creation, not chosen per sale),
 * computes totals, and checks stock availability against what's currently on the shelf. */
async function resolveAndCheckStock(tx: Queryable, storeId: number, items: SaleItemInput[]) {
  const productRows = await tx.select().from(products)
  const productMap = new Map(productRows.map((product) => [product.id, product]))

  const resolvedItems = items.map((item) => ({
    ...item,
    unit: productMap.get(item.productId)?.unit ?? 'sack',
  }))

  for (const item of resolvedItems) {
    const available = await getQuantity(tx, item.productId, storeId)
    if (available < item.quantity) {
      const product = productMap.get(item.productId)
      throw new Error(`Stock insuffisant pour ${product?.name ?? 'cet article'} (disponible : ${available}).`)
    }
  }

  const totalAmount = resolvedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const costAmount = resolvedItems.reduce((sum, item) => {
    const product = productMap.get(item.productId)
    return sum + item.quantity * (product?.costPrice ?? 0)
  }, 0)

  return { items: resolvedItems, totalAmount, costAmount }
}

type ResolvedItem = SaleItemInput & { unit: 'sack' | 'carton' | 'tonne' }

/** Inserts the sale's line items, deducts stock, and records the payment/receivable implied by
 * `input.paymentStatus` — the half of createSale/updateSale that's identical either way. */
async function applySaleEffects(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  sale: typeof sales.$inferSelect,
  items: ResolvedItem[],
  input: { storeId: number; clientId?: number | null; paymentStatus: 'paid' | 'partial' | 'credit'; paidNow: number; dueInDays: number },
) {
  await tx.insert(saleItems).values(
    items.map((item) => ({
      saleId: sale.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      unit: item.unit,
    })),
  )

  for (const item of items) {
    const currentQuantity = await getQuantity(tx, item.productId, input.storeId)
    await tx
      .update(stockLevels)
      .set({ quantity: currentQuantity - item.quantity })
      .where(and(eq(stockLevels.productId, item.productId), eq(stockLevels.storeId, input.storeId)))
    await tx.insert(stockMovements).values({
      type: 'sale',
      productId: item.productId,
      storeId: input.storeId,
      quantity: -item.quantity,
      reference: sale.reference,
    })
  }

  if (input.paymentStatus === 'partial' && input.paidNow > 0 && input.clientId) {
    await tx.insert(payments).values({
      clientId: input.clientId,
      saleId: sale.id,
      storeId: input.storeId,
      amount: input.paidNow,
      method: 'cash',
    })
  }

  if ((input.paymentStatus === 'credit' || input.paymentStatus === 'partial') && input.clientId) {
    const remaining = sale.totalAmount - input.paidNow
    if (remaining > 0) {
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + input.dueInDays)
      await tx.insert(receivables).values({
        clientId: input.clientId,
        saleId: sale.id,
        amount: remaining,
        dueDate: dueDate.toISOString(),
        status: 'pending',
      })
    }
  }
}

/** Undoes everything `applySaleEffects` did: restocks each item (logged as an `adjustment`
 * movement, not a deletion of the original `sale` stock movement, so the history stays intact),
 * then removes the sale's items/payments/receivables so they can be re-inserted fresh. */
async function reverseSaleEffects(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  sale: typeof sales.$inferSelect,
  items: (typeof saleItems.$inferSelect)[],
) {
  for (const item of items) {
    const currentQuantity = await getQuantity(tx, item.productId, sale.storeId)
    await tx
      .update(stockLevels)
      .set({ quantity: currentQuantity + item.quantity })
      .where(and(eq(stockLevels.productId, item.productId), eq(stockLevels.storeId, sale.storeId)))
    await tx.insert(stockMovements).values({
      type: 'adjustment',
      productId: item.productId,
      storeId: sale.storeId,
      quantity: item.quantity,
      reference: `Correction ${sale.reference}`,
    })
  }

  await tx.delete(payments).where(eq(payments.saleId, sale.id))
  await tx.delete(receivables).where(eq(receivables.saleId, sale.id))
  await tx.delete(saleItems).where(eq(saleItems.saleId, sale.id))
}
