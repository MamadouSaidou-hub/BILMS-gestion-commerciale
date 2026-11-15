import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import {
  auditLog,
  discountApplications,
  discountScales,
  products,
  stockLevels,
  stockMovements,
  stores,
  supplierDeliveries,
  supplierPayables,
  supplierPaymentAllocations,
  supplierPayments,
  suppliers,
} from '@/lib/db/schema'
import { deleteSupplierDelivery, recordSupplierDelivery, updateSupplierDelivery } from '@/lib/db/mutations/suppliers'
import { deleteSupplierPayment, recordSupplierPayment, updateSupplierPayment } from '@/lib/db/mutations/payments'

const actor = { userId: 'u1', userName: 'Admin Test' }
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let storeId: number
let productId: number
let supplierId: number
let paymentsSupplierId: number
const deliveryIds: number[] = []
const paymentIds: number[] = []

async function stockOf() {
  const [row] = await db.select({ quantity: stockLevels.quantity }).from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId)))
  return row?.quantity ?? 0
}

beforeAll(async () => {
  const [store] = await db.insert(stores).values({ name: `Magasin ${runId}`, city: 'Test' }).returning()
  storeId = store.id
  const [product] = await db.insert(products).values({ name: `Produit ${runId}`, sku: `SKU-SUP-${runId}`, category: 'Test', unitPrice: 2000, costPrice: 1000 }).returning()
  productId = product.id
  await db.insert(stockLevels).values({ productId, storeId, quantity: 100 })
  const [supplier] = await db.insert(suppliers).values({ name: `Fournisseur ${runId}` }).returning()
  supplierId = supplier.id
  // Dedicated supplier for the payments tests below, so FIFO allocation never picks up a stray
  // open payable left behind by an earlier delivery test on `supplierId`.
  const [paymentsSupplier] = await db.insert(suppliers).values({ name: `Fournisseur Paiements ${runId}` }).returning()
  paymentsSupplierId = paymentsSupplier.id
})

afterAll(async () => {
  for (const id of paymentIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'supplier_payment'), eq(auditLog.entityId, id)))
    await db.delete(supplierPaymentAllocations).where(eq(supplierPaymentAllocations.paymentId, id))
    await db.delete(supplierPayments).where(eq(supplierPayments.id, id))
  }
  for (const id of deliveryIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'supplier_delivery'), eq(auditLog.entityId, id)))
    await db.delete(supplierPayables).where(eq(supplierPayables.deliveryId, id))
    await db.delete(supplierDeliveries).where(eq(supplierDeliveries.id, id))
  }
  const scaleRows = await db.select({ id: discountScales.id }).from(discountScales).where(and(eq(discountScales.partyType, 'supplier'), eq(discountScales.partyId, supplierId)))
  for (const scale of scaleRows) {
    await db.delete(discountApplications).where(eq(discountApplications.scaleId, scale.id))
  }
  await db.delete(discountScales).where(and(eq(discountScales.partyType, 'supplier'), eq(discountScales.partyId, supplierId)))
  await db.delete(stockMovements).where(eq(stockMovements.storeId, storeId))
  await db.delete(stockLevels).where(eq(stockLevels.storeId, storeId))
  await db.delete(suppliers).where(eq(suppliers.id, supplierId))
  await db.delete(suppliers).where(eq(suppliers.id, paymentsSupplierId))
  await db.delete(products).where(eq(products.id, productId))
  await db.delete(stores).where(eq(stores.id, storeId))
})

describe('updateSupplierDelivery', () => {
  it('restores stock for the old count, applies the new count, and recomputes the payable', async () => {
    const before = await stockOf()
    const delivery = await recordSupplierDelivery({
      supplierId,
      storeId,
      productId,
      sackCount: 10,
      paymentStatus: 'credit',
      paidNow: 0,
      dueInDays: 30,
    })
    deliveryIds.push(delivery.id)
    expect(await stockOf()).toBe(before + 10)

    const updated = await updateSupplierDelivery(
      delivery.id,
      { supplierId, storeId, productId, sackCount: 4, paymentStatus: 'credit', paidNow: 0, dueInDays: 30 },
      actor,
      'Erreur de comptage',
    )
    expect(updated.sackCount).toBe(4)
    expect(updated.totalAmount).toBe(4000) // 4 * costPrice(1000)
    expect(await stockOf()).toBe(before + 4)

    const [payable] = await db.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, delivery.id))
    expect(payable.amount).toBe(4000)

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'supplier_delivery'), eq(auditLog.entityId, delivery.id)))
    expect(log.action).toBe('update')
    expect(log.reason).toBe('Erreur de comptage')
  })

  it('rejects correcting a delivery whose payable was already settled by a supplier payment', async () => {
    const delivery = await recordSupplierDelivery({
      supplierId,
      storeId,
      productId,
      sackCount: 5,
      paymentStatus: 'credit',
      paidNow: 0,
      dueInDays: 30,
    })
    deliveryIds.push(delivery.id)

    const payment = await recordSupplierPayment({ supplierId, amount: 5000, method: 'cash' })
    paymentIds.push(payment.id)

    await expect(
      updateSupplierDelivery(delivery.id, { supplierId, storeId, productId, sackCount: 2, paymentStatus: 'credit', paidNow: 0, dueInDays: 30 }, actor),
    ).rejects.toThrow(/déjà été réglée/i)
  })

  it('rejects reducing a delivery below what current stock can absorb (already resold)', async () => {
    const before = await stockOf()
    const delivery = await recordSupplierDelivery({
      supplierId,
      storeId,
      productId,
      sackCount: 10,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
    })
    deliveryIds.push(delivery.id)

    // Simulate most of this delivery having already been sold onward — drop the STORE's total
    // stock below this delivery's own sackCount (the only thing the insufficiency check can see),
    // not just below `before`, since accumulated stock from earlier tests in this file would
    // otherwise mask the check.
    await db.update(stockLevels).set({ quantity: 2 }).where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId)))

    await expect(
      updateSupplierDelivery(delivery.id, { supplierId, storeId, productId, sackCount: 3, paymentStatus: 'paid', paidNow: 0, dueInDays: 30 }, actor),
    ).rejects.toThrow(/stock insuffisant/i)

    // Restore for subsequent tests' baseline assumptions.
    await db.update(stockLevels).set({ quantity: before + 10 }).where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId)))
  })
})

describe('deleteSupplierDelivery', () => {
  it('restores stock, removes the payable, and soft-deletes the delivery', async () => {
    const before = await stockOf()
    const delivery = await recordSupplierDelivery({
      supplierId,
      storeId,
      productId,
      sackCount: 6,
      paymentStatus: 'credit',
      paidNow: 0,
      dueInDays: 30,
    })
    deliveryIds.push(delivery.id)
    expect(await stockOf()).toBe(before + 6)

    await deleteSupplierDelivery(delivery.id, actor, 'Doublon')
    expect(await stockOf()).toBe(before)

    const [row] = await db.select().from(supplierDeliveries).where(eq(supplierDeliveries.id, delivery.id))
    expect(row.deletedAt).not.toBeNull()

    const payableRows = await db.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, delivery.id))
    expect(payableRows).toHaveLength(0)

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'supplier_delivery'), eq(auditLog.entityId, delivery.id)))
    expect(log.action).toBe('delete')
    expect(log.reason).toBe('Doublon')
  })

  it('rejects deleting a delivery twice', async () => {
    const delivery = await recordSupplierDelivery({ supplierId, storeId, productId, sackCount: 1, paymentStatus: 'paid', paidNow: 0, dueInDays: 30 })
    deliveryIds.push(delivery.id)

    await deleteSupplierDelivery(delivery.id, actor)
    await expect(deleteSupplierDelivery(delivery.id, actor)).rejects.toThrow(/introuvable/i)
  })
})

describe('updateSupplierPayment / deleteSupplierPayment', () => {
  it('reverses the old allocation and reapplies the new amount on update', async () => {
    const delivery = await recordSupplierDelivery({ supplierId: paymentsSupplierId, storeId, productId, sackCount: 10, paymentStatus: 'credit', paidNow: 0, dueInDays: 30 }) // 10,000 owed
    deliveryIds.push(delivery.id)

    const payment = await recordSupplierPayment({ supplierId: paymentsSupplierId, amount: 4000, method: 'cash' })
    paymentIds.push(payment.id)
    const [afterPartial] = await db.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, delivery.id))
    expect(afterPartial.amount).toBe(6000)

    const updated = await updateSupplierPayment(payment.id, { amount: 10000, method: 'cash' }, actor, 'Correction montant')
    expect(updated.amount).toBe(10000)

    const [afterFull] = await db.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, delivery.id))
    expect(afterFull.status).toBe('paid')
    expect(afterFull.amount).toBe(0)

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'supplier_payment'), eq(auditLog.entityId, payment.id)))
    expect(log.action).toBe('update')
    expect(log.reason).toBe('Correction montant')
  })

  it('reopens the payable it had settled and soft-deletes the payment', async () => {
    const delivery = await recordSupplierDelivery({ supplierId: paymentsSupplierId, storeId, productId, sackCount: 5, paymentStatus: 'credit', paidNow: 0, dueInDays: 30 }) // 5,000 owed
    deliveryIds.push(delivery.id)

    const payment = await recordSupplierPayment({ supplierId: paymentsSupplierId, amount: 5000, method: 'cash' })
    paymentIds.push(payment.id)

    await deleteSupplierPayment(payment.id, actor, 'Erreur de saisie')

    const [payable] = await db.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, delivery.id))
    expect(payable.status).toBe('pending')
    expect(payable.amount).toBe(5000)

    const [deleted] = await db.select().from(supplierPayments).where(eq(supplierPayments.id, payment.id))
    expect(deleted.deletedAt).not.toBeNull()

    const remainingAllocations = await db.select().from(supplierPaymentAllocations).where(eq(supplierPaymentAllocations.paymentId, payment.id))
    expect(remainingAllocations).toHaveLength(0)
  })
})
