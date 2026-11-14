import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { clients, payments, products, receivables, saleItems, sales, stockLevels, stockMovements, stores } from '@/lib/db/schema'
import { createSale } from '@/lib/db/mutations/sales'

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
  for (const saleId of saleIds) {
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
