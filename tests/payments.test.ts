import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { auditLog, clients, payments, paymentAllocations, products, receivables, saleItems, sales, stockLevels, stores } from '@/lib/db/schema'
import { createSale } from '@/lib/db/mutations/sales'
import { deletePayment, recordPayment, updatePayment } from '@/lib/db/mutations/payments'

const actor = { userId: 'u1', userName: 'Admin Test' }
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let storeId: number
let productId: number
const clientIds: number[] = []
const saleIds: number[] = []
const paymentIds: number[] = []

async function makeClientWithReceivable(amount: number) {
  const [client] = await db.insert(clients).values({ name: `Client ${runId}-${Math.random()}`, storeId }).returning()
  clientIds.push(client.id)
  const sale = await createSale({
    storeId,
    clientId: client.id,
    paymentStatus: 'credit',
    paidNow: 0,
    dueInDays: 15,
    items: [{ productId, quantity: Math.round(amount / 1000), unitPrice: 1000 }],
  })
  saleIds.push(sale.id)
  return client.id
}

beforeAll(async () => {
  const [store] = await db.insert(stores).values({ name: `Magasin ${runId}`, city: 'Test' }).returning()
  storeId = store.id
  const [product] = await db.insert(products).values({ name: `Produit ${runId}`, sku: `SKU-PAY-${runId}`, category: 'Test', unitPrice: 1000, costPrice: 500 }).returning()
  productId = product.id
  await db.insert(stockLevels).values({ productId, storeId, quantity: 1000 })
})

afterAll(async () => {
  for (const id of paymentIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'payment'), eq(auditLog.entityId, id)))
    await db.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, id))
    await db.delete(payments).where(eq(payments.id, id))
  }
  for (const id of saleIds) {
    await db.delete(receivables).where(eq(receivables.saleId, id))
    await db.delete(saleItems).where(eq(saleItems.saleId, id))
    await db.delete(sales).where(eq(sales.id, id))
  }
  for (const id of clientIds) {
    await db.delete(clients).where(eq(clients.id, id))
  }
  await db.delete(stockLevels).where(eq(stockLevels.storeId, storeId))
  await db.delete(products).where(eq(products.id, productId))
  await db.delete(stores).where(eq(stores.id, storeId))
})

describe('recordPayment', () => {
  it('settles the receivable in full and records the allocation', async () => {
    const clientId = await makeClientWithReceivable(10000)
    const payment = await recordPayment({ clientId, amount: 10000, method: 'cash', storeId })
    paymentIds.push(payment.id)

    const [receivable] = await db.select().from(receivables).where(eq(receivables.clientId, clientId))
    expect(receivable.status).toBe('paid')
    expect(receivable.amount).toBe(0)

    const allocations = await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, payment.id))
    expect(allocations).toHaveLength(1)
    expect(allocations[0].amount).toBe(10000)
  })

  it('partially settles a receivable and leaves it pending for the remainder', async () => {
    const clientId = await makeClientWithReceivable(10000)
    const payment = await recordPayment({ clientId, amount: 4000, method: 'cash', storeId })
    paymentIds.push(payment.id)

    const [receivable] = await db.select().from(receivables).where(eq(receivables.clientId, clientId))
    expect(receivable.status).toBe('pending')
    expect(receivable.amount).toBe(6000)
  })
})

describe('updatePayment', () => {
  it('reverses the old allocation and reapplies the new amount', async () => {
    const clientId = await makeClientWithReceivable(10000)
    const payment = await recordPayment({ clientId, amount: 4000, method: 'cash', storeId })
    paymentIds.push(payment.id)

    const updated = await updatePayment(payment.id, { amount: 10000, method: 'cash', storeId }, actor, 'Correction montant')
    expect(updated.amount).toBe(10000)

    const [receivable] = await db.select().from(receivables).where(eq(receivables.clientId, clientId))
    expect(receivable.status).toBe('paid')
    expect(receivable.amount).toBe(0)

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'payment'), eq(auditLog.entityId, payment.id)))
    expect(log.action).toBe('update')
    expect(log.reason).toBe('Correction montant')
  })

  it('rejects editing a payment that is linked to a sale', async () => {
    const clientId = await makeClientWithReceivable(10000)
    const sale = await createSale({
      storeId,
      clientId,
      paymentStatus: 'partial',
      paidNow: 2000,
      dueInDays: 15,
      items: [{ productId, quantity: 10, unitPrice: 1000 }],
    })
    saleIds.push(sale.id)
    const [linkedPayment] = await db.select().from(payments).where(eq(payments.saleId, sale.id))
    paymentIds.push(linkedPayment.id)

    await expect(updatePayment(linkedPayment.id, { amount: 3000, method: 'cash', storeId }, actor)).rejects.toThrow(/liée? à une vente/i)
  })
})

describe('deletePayment', () => {
  it('reopens the receivable it had settled and soft-deletes the payment', async () => {
    const clientId = await makeClientWithReceivable(10000)
    const payment = await recordPayment({ clientId, amount: 10000, method: 'cash', storeId })
    paymentIds.push(payment.id)

    await deletePayment(payment.id, actor, 'Erreur de saisie')

    const [receivable] = await db.select().from(receivables).where(eq(receivables.clientId, clientId))
    expect(receivable.status).toBe('pending')
    expect(receivable.amount).toBe(10000)

    const [deleted] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(deleted.deletedAt).not.toBeNull()

    const remainingAllocations = await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, payment.id))
    expect(remainingAllocations).toHaveLength(0)

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'payment'), eq(auditLog.entityId, payment.id)))
    expect(log.action).toBe('delete')
    expect(log.reason).toBe('Erreur de saisie')
  })

  it('only reopens the specific receivable it touched when a payment spanned several', async () => {
    const clientId = await makeClientWithReceivable(5000)
    const sale2 = await createSale({ storeId, clientId, paymentStatus: 'credit', paidNow: 0, dueInDays: 20, items: [{ productId, quantity: 5, unitPrice: 1000 }] })
    saleIds.push(sale2.id)
    // Two open receivables: 5000 (due sooner) and 5000 (due later) — one payment of 7000 should
    // fully settle the first and partially settle the second.
    const payment = await recordPayment({ clientId, amount: 7000, method: 'cash', storeId })
    paymentIds.push(payment.id)

    const receivablesBefore = await db.select().from(receivables).where(eq(receivables.clientId, clientId))
    const fullyPaid = receivablesBefore.find((r) => r.status === 'paid')
    const stillOpen = receivablesBefore.find((r) => r.status === 'pending')
    expect(fullyPaid).toBeDefined()
    expect(stillOpen?.amount).toBe(3000)

    await deletePayment(payment.id, actor)

    const receivablesAfter = await db.select().from(receivables).where(eq(receivables.clientId, clientId))
    const totalOwed = receivablesAfter.reduce((sum, r) => sum + r.amount, 0)
    expect(totalOwed).toBe(10000)
    expect(receivablesAfter.every((r) => r.status === 'pending')).toBe(true)
  })
})
