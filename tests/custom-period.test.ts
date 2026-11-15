import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import {
  auditLog,
  cashAccounts,
  cashMovements,
  clients,
  payments,
  paymentAllocations,
  products,
  receivables,
  saleItems,
  sales,
  stockLevels,
  stockMovements,
  stores,
} from '@/lib/db/schema'
import { createSale, updateSale } from '@/lib/db/mutations/sales'
import { recordPayment, updatePayment } from '@/lib/db/mutations/payments'
import { recordCashMovement } from '@/lib/db/mutations/cash-accounts'
import { getSalesList } from '@/lib/db/queries/sales'
import { getTreasuryOverview } from '@/lib/db/queries/treasury'
import { getCashAccountsOverview } from '@/lib/db/queries/cash-accounts'
import { cleanupCashMovements } from './helpers/cash-cleanup'

const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let storeId: number
let storeName: string
let productId: number
let clientId: number
let accountId: number
const saleIds: number[] = []
const paymentIds: number[] = []
const movementIds: number[] = []

/** A date N days before today, as the "YYYY-MM-DD" string the forms submit. */
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
    .values({ name: `Produit ${runId}`, sku: `SKU-CP-${runId}`, category: 'Test', unitPrice: 1000, costPrice: 800, unit: 'sack' })
    .returning()
  productId = product.id
  await db.insert(stockLevels).values({ productId, storeId, quantity: 500 })
  const [client] = await db.insert(clients).values({ name: `Client ${runId}`, storeId }).returning()
  clientId = client.id
  const [account] = await db.insert(cashAccounts).values({ name: `Caisse ${runId}`, type: 'cash', balance: 0 }).returning()
  accountId = account.id
})

afterAll(async () => {
  if (saleIds.length > 0) {
    const saleRows = await db.select({ reference: sales.reference }).from(sales).where(inArray(sales.id, saleIds))
    await cleanupCashMovements(saleRows.flatMap((s) => [`Vente #${s.reference}`, `Annulation vente #${s.reference}`]))
  }
  await cleanupCashMovements(
    paymentIds.flatMap((id) => [
      `Paiement #${id}`,
      `Correction paiement #${id} (ancien montant)`,
      `Correction paiement #${id} (nouveau montant)`,
      `Annulation paiement #${id}`,
    ]),
  )

  for (const id of paymentIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'payment'), eq(auditLog.entityId, id)))
    await db.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, id))
    await db.delete(payments).where(eq(payments.id, id))
  }
  for (const saleId of saleIds) {
    await db.delete(receivables).where(eq(receivables.saleId, saleId))
    await db.delete(payments).where(eq(payments.saleId, saleId))
    await db.delete(saleItems).where(eq(saleItems.saleId, saleId))
    await db.delete(sales).where(eq(sales.id, saleId))
  }
  for (const id of movementIds) {
    await db.delete(cashMovements).where(eq(cashMovements.id, id))
  }
  await db.delete(cashMovements).where(eq(cashMovements.cashAccountId, accountId))
  await db.delete(cashAccounts).where(eq(cashAccounts.id, accountId))
  await db.delete(stockMovements).where(eq(stockMovements.storeId, storeId))
  await db.delete(stockLevels).where(eq(stockLevels.storeId, storeId))
  await db.delete(products).where(eq(products.id, productId))
  await db.delete(clients).where(eq(clients.id, clientId))
  await db.delete(stores).where(eq(stores.id, storeId))
})

describe('custom period range', () => {
  it('includes only the sales whose date falls inside the chosen from/to window', async () => {
    const inside = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
      saleDate: daysAgo(20),
      items: [{ productId, quantity: 1, unitPrice: 1000 }],
    })
    saleIds.push(inside.id)

    const outside = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
      saleDate: daysAgo(60),
      items: [{ productId, quantity: 1, unitPrice: 1000 }],
    })
    saleIds.push(outside.id)

    const list = await getSalesList('custom', storeName, { from: daysAgo(30), to: daysAgo(10) })
    const references = list.sales.map((row) => row.reference)
    expect(references).toContain(inside.reference)
    expect(references).not.toContain(outside.reference)
  })

  it('includes a sale dated exactly on each boundary of the window', async () => {
    const onFrom = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
      saleDate: daysAgo(15),
      items: [{ productId, quantity: 1, unitPrice: 1000 }],
    })
    saleIds.push(onFrom.id)

    const onTo = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
      saleDate: daysAgo(5),
      items: [{ productId, quantity: 1, unitPrice: 1000 }],
    })
    saleIds.push(onTo.id)

    const list = await getSalesList('custom', storeName, { from: daysAgo(15), to: daysAgo(5) })
    const references = list.sales.map((row) => row.reference)
    expect(references).toContain(onFrom.reference)
    expect(references).toContain(onTo.reference)
  })
})

describe('backdating the remaining modules', () => {
  it('reports a backdated client payment under its own date, not the day it was entered', async () => {
    const backdated = daysAgo(25)
    const payment = await recordPayment({ clientId, amount: 4000, method: 'cash', storeId, date: backdated })
    paymentIds.push(payment.id)
    expect(payment.date).toBe(backdated)

    const today = await getTreasuryOverview('today', storeName)
    expect(today.payments.map((row) => row.id)).not.toContain(payment.id)

    const year = await getTreasuryOverview('year', storeName)
    const row = year.payments.find((item) => item.id === payment.id)
    expect(row).toBeDefined()
    expect(row!.date.slice(0, 10)).toBe(backdated)
  })

  it('reports a backdated caisse expense under its own date', async () => {
    const backdated = daysAgo(18)
    const movement = await recordCashMovement({
      cashAccountId: accountId,
      type: 'expense',
      category: 'Transport',
      amount: 2500,
      date: backdated,
    })
    movementIds.push(movement.id)
    expect(movement.date).toBe(backdated)

    const today = await getCashAccountsOverview('today')
    expect(today.movements.map((row) => row.id)).not.toContain(movement.id)

    const year = await getCashAccountsOverview('year')
    const row = year.movements.find((item) => item.id === movement.id)
    expect(row).toBeDefined()
    expect(row!.date.slice(0, 10)).toBe(backdated)
  })

  it('writes no compensating caisse pair when a correction leaves the amount untouched', async () => {
    const sale = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
      saleDate: daysAgo(9),
      items: [{ productId, quantity: 2, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)

    // Correct only the date — the cash side is identical, so the caisse should stay silent rather
    // than record a +2000/-2000 pair the admin then has to clean up by hand.
    await updateSale(
      sale.reference,
      { storeId, clientId: null, paymentStatus: 'paid', paidNow: 0, dueInDays: 30, saleDate: daysAgo(8), items: [{ productId, quantity: 2, unitPrice: 1000 }] },
      { userId: 'u1', userName: 'Admin Test' },
      'Date corrigée',
    )

    const corrections = await db
      .select()
      .from(cashMovements)
      .where(inArray(cashMovements.description, [`Correction vente #${sale.reference} (ancien montant)`, `Correction vente #${sale.reference} (nouveau montant)`]))
    expect(corrections).toHaveLength(0)

    const payment = await recordPayment({ clientId, amount: 1500, method: 'cash', storeId, date: daysAgo(9) })
    paymentIds.push(payment.id)
    await updatePayment(payment.id, { amount: 1500, method: 'mobile_money', storeId, date: daysAgo(8) }, { userId: 'u1', userName: 'Admin Test' })

    const paymentCorrections = await db
      .select()
      .from(cashMovements)
      .where(inArray(cashMovements.description, [`Correction paiement #${payment.id} (ancien montant)`, `Correction paiement #${payment.id} (nouveau montant)`]))
    expect(paymentCorrections).toHaveLength(0)
  })

  it('gives an auto-recorded caisse entry the date of the backdated sale that produced it', async () => {
    const backdated = daysAgo(12)
    const sale = await createSale({
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
      saleDate: backdated,
      items: [{ productId, quantity: 3, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)

    const [movement] = await db.select().from(cashMovements).where(eq(cashMovements.description, `Vente #${sale.reference}`))
    expect(movement).toBeTruthy()
    expect(movement.date).toBe(backdated)
  })
})
