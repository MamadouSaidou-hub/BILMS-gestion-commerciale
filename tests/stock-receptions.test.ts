import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import {
  auditLog,
  products,
  stockLevels,
  stockMovements,
  stockReceptionItems,
  stockReceptions,
  stores,
  supplierDeliveries,
  supplierDeliveryItems,
  supplierPayables,
  suppliers,
} from '@/lib/db/schema'
import { deleteStockReception, recordStockReception, updateStockReception } from '@/lib/db/mutations/stock'
import { recordSupplierDelivery, updateSupplierDelivery } from '@/lib/db/mutations/suppliers'
import { getStockReceptionHistory } from '@/lib/db/queries/stock'
import { getSupplierDeliveryHistory } from '@/lib/db/queries/suppliers'

const actor = { userId: 'u1', userName: 'Admin Test' }
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let storeId: number
let storeName: string
let productId: number
let productBId: number
let supplierId: number
const receptionIds: number[] = []
const deliveryIds: number[] = []

async function stockOf(pid: number = productId) {
  const [row] = await db.select({ quantity: stockLevels.quantity }).from(stockLevels).where(and(eq(stockLevels.productId, pid), eq(stockLevels.storeId, storeId)))
  return row?.quantity ?? 0
}

beforeAll(async () => {
  const [store] = await db.insert(stores).values({ name: `Magasin ${runId}`, city: 'Test' }).returning()
  storeId = store.id
  storeName = store.name
  const [product] = await db
    .insert(products)
    .values({ name: `Produit ${runId}`, sku: `SKU-REC-${runId}`, category: 'Test', unitPrice: 2000, costPrice: 1000, unit: 'sack' })
    .returning()
  productId = product.id
  const [productB] = await db
    .insert(products)
    .values({ name: `Produit REC B ${runId}`, sku: `SKU-RECB-${runId}`, category: 'Test', unitPrice: 2500, costPrice: 1200, unit: 'sack' })
    .returning()
  productBId = productB.id
  await db.insert(stockLevels).values([
    { productId, storeId, quantity: 100 },
    { productId: productBId, storeId, quantity: 100 },
  ])
  const [supplier] = await db.insert(suppliers).values({ name: `Fournisseur ${runId}` }).returning()
  supplierId = supplier.id
})

afterAll(async () => {
  for (const id of receptionIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'stock_reception'), eq(auditLog.entityId, id)))
    await db.delete(stockReceptionItems).where(eq(stockReceptionItems.receptionId, id))
    await db.delete(stockReceptions).where(eq(stockReceptions.id, id))
  }
  for (const id of deliveryIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'supplier_delivery'), eq(auditLog.entityId, id)))
    await db.delete(supplierPayables).where(eq(supplierPayables.deliveryId, id))
    await db.delete(supplierDeliveryItems).where(eq(supplierDeliveryItems.deliveryId, id))
    await db.delete(supplierDeliveries).where(eq(supplierDeliveries.id, id))
  }
  await db.delete(stockMovements).where(eq(stockMovements.storeId, storeId))
  await db.delete(stockLevels).where(eq(stockLevels.storeId, storeId))
  await db.delete(suppliers).where(eq(suppliers.id, supplierId))
  await db.delete(products).where(eq(products.id, productId))
  await db.delete(products).where(eq(products.id, productBId))
  await db.delete(stores).where(eq(stores.id, storeId))
})

describe('recordStockReception', () => {
  it('adds the received quantity to stock and keeps the chosen reception date', async () => {
    const before = await stockOf()
    const reception = await recordStockReception({ storeId, items: [{ productId, quantity: 20 }], reference: 'BL-001', date: '2026-01-15' })
    receptionIds.push(reception.id)

    expect(await stockOf()).toBe(before + 20)
    expect(reception.date).toBe('2026-01-15')

    const history = await getStockReceptionHistory(storeName)
    const row = history.find((item) => item.id === reception.id)
    expect(row).toBeDefined()
    expect(row!.items).toHaveLength(1)
    expect(row!.items[0].quantity).toBe(20)
    expect(row!.date.slice(0, 10)).toBe('2026-01-15')
  })

  it('covers several products in the same reception', async () => {
    const beforeA = await stockOf(productId)
    const beforeB = await stockOf(productBId)
    const reception = await recordStockReception({
      storeId,
      items: [
        { productId, quantity: 7 },
        { productId: productBId, quantity: 3 },
      ],
    })
    receptionIds.push(reception.id)

    expect(await stockOf(productId)).toBe(beforeA + 7)
    expect(await stockOf(productBId)).toBe(beforeB + 3)

    const history = await getStockReceptionHistory(storeName)
    const row = history.find((item) => item.id === reception.id)
    expect(row!.items).toHaveLength(2)
  })

  it('falls back to the creation date when no date is given', async () => {
    const reception = await recordStockReception({ storeId, items: [{ productId, quantity: 5 }] })
    receptionIds.push(reception.id)
    expect(reception.date).toBeNull()

    const history = await getStockReceptionHistory(storeName)
    const row = history.find((item) => item.id === reception.id)
    expect(row!.date.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10))
  })

  it('rejects an empty item list', async () => {
    await expect(recordStockReception({ storeId, items: [] })).rejects.toThrow(/au moins un article/i)
  })

  it('rejects a non-positive quantity', async () => {
    await expect(recordStockReception({ storeId, items: [{ productId, quantity: 0 }] })).rejects.toThrow(/supérieure à zéro/i)
  })
})

describe('updateStockReception', () => {
  it('reverses the old quantity, applies the new one, and writes an audit entry', async () => {
    const before = await stockOf()
    const reception = await recordStockReception({ storeId, items: [{ productId, quantity: 30 }], date: '2026-02-01' })
    receptionIds.push(reception.id)
    expect(await stockOf()).toBe(before + 30)

    const updated = await updateStockReception(
      reception.id,
      { storeId, items: [{ productId, quantity: 12 }], reference: 'BL-002', date: '2026-02-05' },
      actor,
      'Erreur de comptage',
    )
    expect(updated.date).toBe('2026-02-05')
    expect(await stockOf()).toBe(before + 12)

    const items = await db.select().from(stockReceptionItems).where(eq(stockReceptionItems.receptionId, reception.id))
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(12)

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'stock_reception'), eq(auditLog.entityId, reception.id)))
    expect(log.action).toBe('update')
    expect(log.reason).toBe('Erreur de comptage')
  })

  it('rejects a correction the current stock cannot absorb (already resold)', async () => {
    const reception = await recordStockReception({ storeId, items: [{ productId, quantity: 10 }] })
    receptionIds.push(reception.id)

    const restore = await stockOf()
    // Simulate everything from this reception (and more) having been sold onward.
    await db.update(stockLevels).set({ quantity: 3 }).where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId)))

    await expect(updateStockReception(reception.id, { storeId, items: [{ productId, quantity: 4 }] }, actor)).rejects.toThrow(/stock insuffisant/i)

    await db.update(stockLevels).set({ quantity: restore }).where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId)))
  })
})

describe('deleteStockReception', () => {
  it('removes the received quantity from stock, soft-deletes it, and hides it from the history', async () => {
    const before = await stockOf()
    const reception = await recordStockReception({ storeId, items: [{ productId, quantity: 8 }] })
    receptionIds.push(reception.id)
    expect(await stockOf()).toBe(before + 8)

    await deleteStockReception(reception.id, actor, 'Doublon')
    expect(await stockOf()).toBe(before)

    const [row] = await db.select().from(stockReceptions).where(eq(stockReceptions.id, reception.id))
    expect(row.deletedAt).not.toBeNull()

    const history = await getStockReceptionHistory(storeName)
    expect(history.find((item) => item.id === reception.id)).toBeUndefined()

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'stock_reception'), eq(auditLog.entityId, reception.id)))
    expect(log.action).toBe('delete')
    expect(log.reason).toBe('Doublon')
  })

  it('rejects deleting a reception twice', async () => {
    const reception = await recordStockReception({ storeId, items: [{ productId, quantity: 2 }] })
    receptionIds.push(reception.id)

    await deleteStockReception(reception.id, actor)
    await expect(deleteStockReception(reception.id, actor)).rejects.toThrow(/introuvable/i)
  })
})

describe('supplier deliveries can be backdated', () => {
  it('stores the chosen delivery date and keeps it correctable', async () => {
    const delivery = await recordSupplierDelivery({
      supplierId,
      storeId,
      items: [{ productId, sackCount: 10 }],
      date: '2026-03-10',
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
    })
    deliveryIds.push(delivery.id)
    expect(delivery.date).toBe('2026-03-10')

    const history = await getSupplierDeliveryHistory(supplierId)
    const row = history.find((item) => item.id === delivery.id)
    expect(row!.effectiveDate.slice(0, 10)).toBe('2026-03-10')

    const updated = await updateSupplierDelivery(
      delivery.id,
      { supplierId, storeId, items: [{ productId, sackCount: 10 }], date: '2026-03-12', paymentStatus: 'paid', paidNow: 0, dueInDays: 30 },
      actor,
      'Date corrigée',
    )
    expect(updated.date).toBe('2026-03-12')
  })

  it('falls back to the creation date when no delivery date is given', async () => {
    const delivery = await recordSupplierDelivery({
      supplierId,
      storeId,
      items: [{ productId, sackCount: 3 }],
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 30,
    })
    deliveryIds.push(delivery.id)
    expect(delivery.date).toBeNull()

    const history = await getSupplierDeliveryHistory(supplierId)
    const row = history.find((item) => item.id === delivery.id)
    expect(row!.effectiveDate.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10))
  })
})
