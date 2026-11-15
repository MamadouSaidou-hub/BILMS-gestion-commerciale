import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { auditLog, clients, payments, products, receivables, saleItems, sales, stockLevels, stockMovements, stores } from '@/lib/db/schema'
import { cleanupCashMovements } from './helpers/cash-cleanup'
import { cancelSale, createSale, updateSale } from '@/lib/db/mutations/sales'
import { recordPayment } from '@/lib/db/mutations/payments'

const actor = { userId: 'u1', userName: 'Admin Test' }

const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let storeId: number
let clientId: number
let sackProductId: number
let cartonProductId: number
const saleIds: number[] = []

async function stockOf(productId: number) {
  const [row] = await db.select({ quantity: stockLevels.quantity }).from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId)))
  return row?.quantity ?? 0
}

beforeAll(async () => {
  const [store] = await db.insert(stores).values({ name: `Magasin ${runId}`, city: 'Test' }).returning()
  storeId = store.id
  const [client] = await db.insert(clients).values({ name: `Client ${runId}`, storeId }).returning()
  clientId = client.id

  const [sackProduct] = await db
    .insert(products)
    .values({ name: `Produit sac ${runId}`, sku: `SKU-SACK-${runId}`, category: 'Test', unitPrice: 1000, costPrice: 800, unit: 'sack' })
    .returning()
  sackProductId = sackProduct.id

  const [cartonProduct] = await db
    .insert(products)
    .values({ name: `Produit carton ${runId}`, sku: `SKU-CARTON-${runId}`, category: 'Test', unitPrice: 1000, costPrice: 800, unit: 'carton' })
    .returning()
  cartonProductId = cartonProduct.id

  await db.insert(stockLevels).values([
    { productId: sackProductId, storeId, quantity: 100 },
    { productId: cartonProductId, storeId, quantity: 100 },
  ])
})

afterAll(async () => {
  // createSale/updateSale/cancelSale auto-route into the real caisse (lib/db/mutations/cash-accounts.ts)
  // — clean up the cash movements they created before the sales themselves disappear, otherwise
  // fake test money permanently pollutes the real "Caisse principale" balance.
  if (saleIds.length > 0) {
    const saleRows = await db.select({ reference: sales.reference }).from(sales).where(inArray(sales.id, saleIds))
    const descriptions = saleRows.flatMap((s) => [
      `Vente #${s.reference}`,
      `Annulation vente #${s.reference}`,
      `Correction vente #${s.reference} (ancien montant)`,
      `Correction vente #${s.reference} (nouveau montant)`,
    ])
    await cleanupCashMovements(descriptions)
  }

  for (const saleId of saleIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'sale'), eq(auditLog.entityId, saleId)))
    await db.delete(receivables).where(eq(receivables.saleId, saleId))
    await db.delete(payments).where(eq(payments.saleId, saleId))
    await db.delete(saleItems).where(eq(saleItems.saleId, saleId))
    await db.delete(sales).where(eq(sales.id, saleId))
  }
  await db.delete(stockMovements).where(eq(stockMovements.storeId, storeId))
  await db.delete(stockLevels).where(eq(stockLevels.storeId, storeId))
  await db.delete(products).where(eq(products.id, sackProductId))
  await db.delete(products).where(eq(products.id, cartonProductId))
  await db.delete(clients).where(eq(clients.id, clientId))
  await db.delete(stores).where(eq(stores.id, storeId))
})

describe('createSale', () => {
  it('deducts stock for a paid sale', async () => {
    const before = await stockOf(sackProductId)
    const sale = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 15,
      items: [{ productId: sackProductId, quantity: 10, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)
    expect(await stockOf(sackProductId)).toBe(before - 10)
  })

  it('records both a payment and the correct receivable remainder for a partial sale', async () => {
    const sale = await createSale({
      storeId,
      clientId,
      paymentStatus: 'partial',
      paidNow: 4000,
      dueInDays: 15,
      items: [{ productId: sackProductId, quantity: 10, unitPrice: 1000 }], // total = 10,000
    })
    saleIds.push(sale.id)

    const [payment] = await db.select().from(payments).where(eq(payments.saleId, sale.id))
    expect(payment?.amount).toBe(4000)

    const [receivable] = await db.select().from(receivables).where(eq(receivables.saleId, sale.id))
    expect(receivable?.amount).toBe(6000)
  })

  it('rejects a sale when stock is insufficient and leaves stock unchanged', async () => {
    const before = await stockOf(sackProductId)
    await expect(
      createSale({
        storeId,
        clientId: null,
        paymentStatus: 'paid',
        paidNow: 0,
        dueInDays: 15,
        items: [{ productId: sackProductId, quantity: before + 1000, unitPrice: 1000 }],
      }),
    ).rejects.toThrow(/stock insuffisant/i)
    expect(await stockOf(sackProductId)).toBe(before)
  })

  it('derives the sale item unit from the product, not from caller input', async () => {
    const before = await stockOf(cartonProductId)
    const sale = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 15,
      items: [{ productId: cartonProductId, quantity: 4, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)

    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id))
    expect(item.quantity).toBe(4)
    expect(item.unit).toBe('carton')
    expect(await stockOf(cartonProductId)).toBe(before - 4)
  })

  it('keeps the sack unit for a sack product', async () => {
    const sale = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 15,
      items: [{ productId: sackProductId, quantity: 2, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)

    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id))
    expect(item.unit).toBe('sack')
  })

  it('stores an explicit saleDate when provided, defaulting to null otherwise', async () => {
    const saleWithDate = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 15,
      saleDate: '2026-01-15',
      items: [{ productId: sackProductId, quantity: 1, unitPrice: 1000 }],
    })
    saleIds.push(saleWithDate.id)
    expect(saleWithDate.saleDate).toBe('2026-01-15')

    const saleWithoutDate = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 15,
      items: [{ productId: sackProductId, quantity: 1, unitPrice: 1000 }],
    })
    saleIds.push(saleWithoutDate.id)
    expect(saleWithoutDate.saleDate).toBeNull()
  })
})

describe('updateSale', () => {
  it('restores stock for the old quantity, deducts stock for the new quantity, and recomputes the total', async () => {
    const before = await stockOf(sackProductId)
    const sale = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 15,
      items: [{ productId: sackProductId, quantity: 10, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)
    expect(await stockOf(sackProductId)).toBe(before - 10)

    const updated = await updateSale(
      sale.reference,
      { storeId, clientId: null, paymentStatus: 'paid', paidNow: 0, dueInDays: 15, items: [{ productId: sackProductId, quantity: 4, unitPrice: 1500 }] },
      actor,
      'Correction quantité',
    )
    expect(updated.totalAmount).toBe(6000)
    expect(await stockOf(sackProductId)).toBe(before - 4)

    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id))
    expect(item.quantity).toBe(4)
    expect(item.unitPrice).toBe(1500)

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'sale'), eq(auditLog.entityId, sale.id)))
    expect(log.action).toBe('update')
    expect(log.reason).toBe('Correction quantité')
  })

  it('replaces the payment/receivable rows when paymentStatus changes', async () => {
    const sale = await createSale({
      storeId,
      clientId,
      paymentStatus: 'partial',
      paidNow: 4000,
      dueInDays: 15,
      items: [{ productId: sackProductId, quantity: 10, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)

    await updateSale(
      sale.reference,
      { storeId, clientId, paymentStatus: 'paid', paidNow: 0, dueInDays: 15, items: [{ productId: sackProductId, quantity: 10, unitPrice: 1000 }] },
      actor,
    )

    const paymentRows = await db.select().from(payments).where(eq(payments.saleId, sale.id))
    expect(paymentRows).toHaveLength(0)
    const receivableRows = await db.select().from(receivables).where(eq(receivables.saleId, sale.id))
    expect(receivableRows).toHaveLength(0)
  })
})

describe('cancelSale', () => {
  it('restores stock, removes payments/receivables, soft-deletes the sale, and writes an audit entry', async () => {
    const before = await stockOf(sackProductId)
    const sale = await createSale({
      storeId,
      clientId,
      paymentStatus: 'partial',
      paidNow: 4000,
      dueInDays: 15,
      items: [{ productId: sackProductId, quantity: 10, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)
    expect(await stockOf(sackProductId)).toBe(before - 10)

    await cancelSale(sale.reference, actor, 'Erreur de saisie')

    expect(await stockOf(sackProductId)).toBe(before)

    const [cancelledSale] = await db.select().from(sales).where(eq(sales.id, sale.id))
    expect(cancelledSale.deletedAt).not.toBeNull()

    const paymentRows = await db.select().from(payments).where(eq(payments.saleId, sale.id))
    expect(paymentRows).toHaveLength(0)
    const receivableRows = await db.select().from(receivables).where(eq(receivables.saleId, sale.id))
    expect(receivableRows).toHaveLength(0)

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'sale'), eq(auditLog.entityId, sale.id)))
    expect(log.action).toBe('delete')
    expect(log.reason).toBe('Erreur de saisie')
  })

  it('rejects cancelling a sale twice', async () => {
    const sale = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 15,
      items: [{ productId: sackProductId, quantity: 1, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)

    await cancelSale(sale.reference, actor)
    await expect(cancelSale(sale.reference, actor)).rejects.toThrow(/introuvable/i)
  })

  it('refuses to edit or cancel a credit sale whose receivable was already settled by a standalone payment', async () => {
    // A dedicated client, isolated from every other test's receivables — recordPayment() allocates
    // across ALL of a client's open receivables oldest-due-first, so sharing the describe-level
    // `clientId` here would let the payment land on an unrelated test's receivable instead.
    const [isolatedClient] = await db.insert(clients).values({ name: `Client isolé ${runId}`, storeId }).returning()

    const sale = await createSale({
      storeId,
      clientId: isolatedClient.id,
      paymentStatus: 'credit',
      paidNow: 0,
      dueInDays: 15,
      items: [{ productId: sackProductId, quantity: 10, unitPrice: 1000 }], // total = 10,000, full amount owed
    })
    saleIds.push(sale.id)

    // The client later settles the debt through Trésorerie — independent of the sale, exactly
    // like a real standalone payment. This must not be silently undone by a later edit/cancel.
    const standalonePayment = await recordPayment({ clientId: isolatedClient.id, amount: 10000, method: 'cash', storeId })

    await expect(
      updateSale(
        sale.reference,
        {
          storeId,
          clientId: isolatedClient.id,
          paymentStatus: 'credit',
          paidNow: 0,
          dueInDays: 15,
          items: [{ productId: sackProductId, quantity: 5, unitPrice: 1000 }],
        },
        actor,
      ),
    ).rejects.toThrow(/déjà été encaissée/i)

    await expect(cancelSale(sale.reference, actor)).rejects.toThrow(/déjà été encaissée/i)

    // Confirm the guard didn't let anything through: the sale is untouched and the receivable stays settled.
    const [unchangedSale] = await db.select().from(sales).where(eq(sales.id, sale.id))
    expect(unchangedSale.deletedAt).toBeNull()
    const [receivable] = await db.select().from(receivables).where(eq(receivables.saleId, sale.id))
    expect(receivable.status).toBe('paid')

    await cleanupCashMovements([`Paiement #${standalonePayment.id}`])
    await db.delete(payments).where(eq(payments.clientId, isolatedClient.id))
    await db.delete(receivables).where(eq(receivables.saleId, sale.id))
    await db.delete(clients).where(eq(clients.id, isolatedClient.id))
  })
})
