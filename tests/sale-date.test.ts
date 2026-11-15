import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { auditLog, clients, payments, products, receivables, saleItems, sales, stockLevels, stockMovements, stores } from '@/lib/db/schema'
import { createSale, updateSale } from '@/lib/db/mutations/sales'
import { getSalesList } from '@/lib/db/queries/sales'
import { getDashboardData } from '@/lib/db/queries/dashboard'
import { getReportsOverview } from '@/lib/db/queries/reports'
import { cleanupCashMovements } from './helpers/cash-cleanup'

const actor = { userId: 'u1', userName: 'Admin Test' }
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let storeId: number
let storeName: string
let productId: number
const saleIds: number[] = []

/** A date N days before today, as the "YYYY-MM-DD" string the sale form submits. */
function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

beforeAll(async () => {
  const [store] = await db.insert(stores).values({ name: `Magasin ${runId}`, city: 'Test' }).returning()
  storeId = store.id
  storeName = store.name
  const [product] = await db
    .insert(products)
    .values({ name: `Produit ${runId}`, sku: `SKU-DATE-${runId}`, category: 'Test', unitPrice: 1000, costPrice: 800, unit: 'sack' })
    .returning()
  productId = product.id
  await db.insert(stockLevels).values({ productId, storeId, quantity: 500 })
})

afterAll(async () => {
  if (saleIds.length > 0) {
    const saleRows = await db.select({ reference: sales.reference }).from(sales).where(inArray(sales.id, saleIds))
    await cleanupCashMovements(
      saleRows.flatMap((s) => [
        `Vente #${s.reference}`,
        `Annulation vente #${s.reference}`,
        `Correction vente #${s.reference} (ancien montant)`,
        `Correction vente #${s.reference} (nouveau montant)`,
      ]),
    )
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
  await db.delete(products).where(eq(products.id, productId))
  await db.delete(clients).where(eq(clients.storeId, storeId))
  await db.delete(stores).where(eq(stores.id, storeId))
})

describe('backdated sales are reported under the date they happened', () => {
  it('excludes a sale backdated 40 days ago from "today", and includes it in the year', async () => {
    const backdated = daysAgo(40)
    const sale = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
      saleDate: backdated,
      items: [{ productId, quantity: 2, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)

    const today = await getSalesList('today', storeName)
    expect(today.sales.map((row) => row.reference)).not.toContain(sale.reference)

    const year = await getSalesList('year', storeName)
    const inYear = year.sales.find((row) => row.reference === sale.reference)
    expect(inYear).toBeDefined()
    // The listed date is the chosen sale date, not the day the row was inserted.
    expect(inYear!.date.slice(0, 10)).toBe(backdated)
  })

  it('still reports a normal, non-backdated sale under "today"', async () => {
    const sale = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
      items: [{ productId, quantity: 1, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)

    const today = await getSalesList('today', storeName)
    expect(today.sales.map((row) => row.reference)).toContain(sale.reference)
  })

  it('still fills the hourly trend buckets the "today" charts use', async () => {
    // Regression guard: "Aujourd'hui" buckets the trend chart by hour, so both ends of a bucket
    // fall on the same calendar date — comparing the effective date at day granularity made every
    // hourly bucket's range empty, zeroing out the chart.
    const sale = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
      items: [{ productId, quantity: 7, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)

    const dashboard = await getDashboardData('today', storeName)
    const chartTotal = dashboard.salesTrend.reduce((sum, bucket) => sum + bucket.value, 0)
    expect(chartTotal).toBeGreaterThanOrEqual(7000)

    const reports = await getReportsOverview('today')
    const reportsChartTotal = reports.salesTrend.reduce((sum, bucket) => sum + bucket.value, 0)
    expect(reportsChartTotal).toBeGreaterThanOrEqual(7000)
  })

  it('moves a sale between periods when its date is corrected', async () => {
    const sale = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
      items: [{ productId, quantity: 1, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)
    expect((await getSalesList('today', storeName)).sales.map((r) => r.reference)).toContain(sale.reference)

    const backdated = daysAgo(20)
    await updateSale(
      sale.reference,
      { storeId, clientId: null, paymentStatus: 'paid', paidNow: 0, dueInDays: 30, saleDate: backdated, items: [{ productId, quantity: 1, unitPrice: 1000 }] },
      actor,
      'Date corrigée',
    )

    expect((await getSalesList('today', storeName)).sales.map((r) => r.reference)).not.toContain(sale.reference)
    const month = await getSalesList('year', storeName)
    expect(month.sales.find((r) => r.reference === sale.reference)?.date.slice(0, 10)).toBe(backdated)
  })
})
