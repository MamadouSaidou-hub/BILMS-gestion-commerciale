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
  supplierDeliveryCharges,
  supplierDeliveryItems,
  supplierPayables,
  supplierPaymentAllocations,
  supplierPayments,
  suppliers,
} from '@/lib/db/schema'
import { deleteSupplierDelivery, recordSupplierDelivery, updateSupplierDelivery } from '@/lib/db/mutations/suppliers'
import { deleteSupplierPayment, recordSupplierPayment, updateSupplierPayment } from '@/lib/db/mutations/payments'
import { cleanupCashMovements } from './helpers/cash-cleanup'

const actor = { userId: 'u1', userName: 'Admin Test' }
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let storeId: number
let productId: number
let productBId: number
let supplierId: number
let paymentsSupplierId: number
const deliveryIds: number[] = []
const paymentIds: number[] = []

async function stockOf(pid: number = productId) {
  const [row] = await db.select({ quantity: stockLevels.quantity }).from(stockLevels).where(and(eq(stockLevels.productId, pid), eq(stockLevels.storeId, storeId)))
  return row?.quantity ?? 0
}

beforeAll(async () => {
  const [store] = await db.insert(stores).values({ name: `Magasin ${runId}`, city: 'Test' }).returning()
  storeId = store.id
  const [product] = await db.insert(products).values({ name: `Produit ${runId}`, sku: `SKU-SUP-${runId}`, category: 'Test', unitPrice: 2000, costPrice: 1000 }).returning()
  productId = product.id
  const [productB] = await db.insert(products).values({ name: `Produit B ${runId}`, sku: `SKU-SUPB-${runId}`, category: 'Test', unitPrice: 3000, costPrice: 1500 }).returning()
  productBId = productB.id
  await db.insert(stockLevels).values([
    { productId, storeId, quantity: 100 },
    { productId: productBId, storeId, quantity: 100 },
  ])
  const [supplier] = await db.insert(suppliers).values({ name: `Fournisseur ${runId}` }).returning()
  supplierId = supplier.id
  // Dedicated supplier for the payments tests below, so FIFO allocation never picks up a stray
  // open payable left behind by an earlier delivery test on `supplierId`.
  const [paymentsSupplier] = await db.insert(suppliers).values({ name: `Fournisseur Paiements ${runId}` }).returning()
  paymentsSupplierId = paymentsSupplier.id
})

afterAll(async () => {
  // recordSupplierPayment/updateSupplierPayment/deleteSupplierPayment auto-route into the real
  // caisse (lib/db/mutations/cash-accounts.ts) — clean those movements up before the payments
  // themselves disappear, otherwise fake test money permanently pollutes the real caisse.
  const paymentDescriptions = paymentIds.flatMap((id) => [
    `Paiement fournisseur #${id}`,
    `Correction paiement fournisseur #${id} (ancien montant)`,
    `Correction paiement fournisseur #${id} (nouveau montant)`,
    `Annulation paiement fournisseur #${id}`,
  ])
  await cleanupCashMovements(paymentDescriptions)

  for (const id of paymentIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'supplier_payment'), eq(auditLog.entityId, id)))
    await db.delete(supplierPaymentAllocations).where(eq(supplierPaymentAllocations.paymentId, id))
    await db.delete(supplierPayments).where(eq(supplierPayments.id, id))
  }
  for (const id of deliveryIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'supplier_delivery'), eq(auditLog.entityId, id)))
    await db.delete(supplierPayables).where(eq(supplierPayables.deliveryId, id))
    // supplierDeliveryItems/Charges cascade-delete with the delivery row, but tidy them up
    // explicitly first in case a test left the delivery row deleted already (soft-delete doesn't
    // cascade).
    await db.delete(supplierDeliveryItems).where(eq(supplierDeliveryItems.deliveryId, id))
    await db.delete(supplierDeliveryCharges).where(eq(supplierDeliveryCharges.deliveryId, id))
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
  await db.delete(products).where(eq(products.id, productBId))
  await db.delete(stores).where(eq(stores.id, storeId))
})

describe('recordSupplierDelivery with several products and a charge', () => {
  it('bumps stock for every product line and adds the charge to the total', async () => {
    const beforeA = await stockOf(productId)
    const beforeB = await stockOf(productBId)

    const delivery = await recordSupplierDelivery({
      supplierId,
      storeId,
      items: [
        { productId, sackCount: 10 }, // 10 * 1000 = 10 000
        { productId: productBId, sackCount: 5 }, // 5 * 1500 = 7 500
      ],
      charges: [{ description: 'Transport', quantity: 1, unitPrice: 2000 }],
      paymentStatus: 'credit',
      paidNow: 0,
      dueInDays: 30,
    })
    deliveryIds.push(delivery.id)

    expect(await stockOf(productId)).toBe(beforeA + 10)
    expect(await stockOf(productBId)).toBe(beforeB + 5)
    expect(delivery.totalAmount).toBe(10000 + 7500 + 2000)

    const [payable] = await db.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, delivery.id))
    expect(payable.amount).toBe(19500)

    const items = await db.select().from(supplierDeliveryItems).where(eq(supplierDeliveryItems.deliveryId, delivery.id))
    expect(items).toHaveLength(2)
    const charges = await db.select().from(supplierDeliveryCharges).where(eq(supplierDeliveryCharges.deliveryId, delivery.id))
    expect(charges).toHaveLength(1)
    expect(charges[0].description).toBe('Transport')
  })

  it('rejects an empty item list', async () => {
    await expect(
      recordSupplierDelivery({ supplierId, storeId, items: [], paymentStatus: 'paid', paidNow: 0, dueInDays: 30 }),
    ).rejects.toThrow(/au moins un article/i)
  })
})

describe('updateSupplierDelivery', () => {
  it('restores stock for the old lines, applies the new ones, and recomputes the payable', async () => {
    const before = await stockOf()
    const delivery = await recordSupplierDelivery({
      supplierId,
      storeId,
      items: [{ productId, sackCount: 10 }],
      paymentStatus: 'credit',
      paidNow: 0,
      dueInDays: 30,
    })
    deliveryIds.push(delivery.id)
    expect(await stockOf()).toBe(before + 10)

    const updated = await updateSupplierDelivery(
      delivery.id,
      { supplierId, storeId, items: [{ productId, sackCount: 4 }], paymentStatus: 'credit', paidNow: 0, dueInDays: 30 },
      actor,
      'Erreur de comptage',
    )
    expect(updated.totalAmount).toBe(4000) // 4 * costPrice(1000)
    expect(await stockOf()).toBe(before + 4)

    const items = await db.select().from(supplierDeliveryItems).where(eq(supplierDeliveryItems.deliveryId, delivery.id))
    expect(items).toHaveLength(1)
    expect(items[0].sackCount).toBe(4)

    const [payable] = await db.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, delivery.id))
    expect(payable.amount).toBe(4000)

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'supplier_delivery'), eq(auditLog.entityId, delivery.id)))
    expect(log.action).toBe('update')
    expect(log.reason).toBe('Erreur de comptage')
  })

  it('can change which products are on the delivery entirely', async () => {
    const beforeA = await stockOf(productId)
    const beforeB = await stockOf(productBId)
    const delivery = await recordSupplierDelivery({
      supplierId,
      storeId,
      items: [{ productId, sackCount: 8 }],
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
    })
    deliveryIds.push(delivery.id)
    expect(await stockOf(productId)).toBe(beforeA + 8)

    await updateSupplierDelivery(
      delivery.id,
      { supplierId, storeId, items: [{ productId: productBId, sackCount: 3 }], paymentStatus: 'paid', paidNow: 0, dueInDays: 30 },
      actor,
    )

    // The old product's stock is fully reversed, the new product's stock reflects the new line.
    expect(await stockOf(productId)).toBe(beforeA)
    expect(await stockOf(productBId)).toBe(beforeB + 3)
  })

  it('rejects correcting a delivery whose payable was already settled by a supplier payment', async () => {
    // Dedicated supplier — recordSupplierPayment allocates FIFO across ALL of a supplier's open
    // payables, so sharing `supplierId` here would let this payment settle a dangling payable left
    // behind by an earlier test instead of the one this test is actually checking.
    const delivery = await recordSupplierDelivery({
      supplierId: paymentsSupplierId,
      storeId,
      items: [{ productId, sackCount: 5 }],
      paymentStatus: 'credit',
      paidNow: 0,
      dueInDays: 30,
    })
    deliveryIds.push(delivery.id)

    const payment = await recordSupplierPayment({ supplierId: paymentsSupplierId, amount: 5000, method: 'cash' })
    paymentIds.push(payment.id)

    await expect(
      updateSupplierDelivery(delivery.id, { supplierId: paymentsSupplierId, storeId, items: [{ productId, sackCount: 2 }], paymentStatus: 'credit', paidNow: 0, dueInDays: 30 }, actor),
    ).rejects.toThrow(/déjà été réglée/i)
  })

  it('rejects reducing a delivery below what current stock can absorb (already resold)', async () => {
    const before = await stockOf()
    const delivery = await recordSupplierDelivery({
      supplierId,
      storeId,
      items: [{ productId, sackCount: 10 }],
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
      updateSupplierDelivery(delivery.id, { supplierId, storeId, items: [{ productId, sackCount: 3 }], paymentStatus: 'paid', paidNow: 0, dueInDays: 30 }, actor),
    ).rejects.toThrow(/stock insuffisant/i)

    // Restore for subsequent tests' baseline assumptions.
    await db.update(stockLevels).set({ quantity: before + 10 }).where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId)))
  })
})

describe('deleteSupplierDelivery', () => {
  it('restores stock for every line, removes the payable, and soft-deletes the delivery', async () => {
    const before = await stockOf()
    const delivery = await recordSupplierDelivery({
      supplierId,
      storeId,
      items: [{ productId, sackCount: 6 }],
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
    const delivery = await recordSupplierDelivery({ supplierId, storeId, items: [{ productId, sackCount: 1 }], paymentStatus: 'paid', paidNow: 0, dueInDays: 30 })
    deliveryIds.push(delivery.id)

    await deleteSupplierDelivery(delivery.id, actor)
    await expect(deleteSupplierDelivery(delivery.id, actor)).rejects.toThrow(/introuvable/i)
  })
})

describe('updateSupplierPayment / deleteSupplierPayment', () => {
  it('reverses the old allocation and reapplies the new amount on update', async () => {
    const delivery = await recordSupplierDelivery({ supplierId: paymentsSupplierId, storeId, items: [{ productId, sackCount: 10 }], paymentStatus: 'credit', paidNow: 0, dueInDays: 30 }) // 10,000 owed
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
    const delivery = await recordSupplierDelivery({ supplierId: paymentsSupplierId, storeId, items: [{ productId, sackCount: 5 }], paymentStatus: 'credit', paidNow: 0, dueInDays: 30 }) // 5,000 owed
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
