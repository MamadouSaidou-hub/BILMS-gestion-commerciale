import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { auditLog, products, stockCounts, stockLevels, stockMovements, stores } from '@/lib/db/schema'
import { deleteStockCount, recordStockCount, updateStockCount } from '@/lib/db/mutations/stock'

const actor = { userId: 'u1', userName: 'Admin Test' }
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let storeId: number
let productId: number
const countIds: number[] = []

async function stockOf() {
  const [row] = await db.select({ quantity: stockLevels.quantity }).from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId)))
  return row?.quantity ?? 0
}

beforeAll(async () => {
  const [store] = await db.insert(stores).values({ name: `Magasin ${runId}`, city: 'Test' }).returning()
  storeId = store.id
  const [product] = await db.insert(products).values({ name: `Produit ${runId}`, sku: `SKU-CNT-${runId}`, category: 'Test', unitPrice: 1000, costPrice: 500 }).returning()
  productId = product.id
  await db.insert(stockLevels).values({ productId, storeId, quantity: 100 })
})

afterAll(async () => {
  for (const id of countIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'stock_count'), eq(auditLog.entityId, id)))
  }
  await db.delete(stockCounts).where(eq(stockCounts.storeId, storeId))
  await db.delete(stockMovements).where(eq(stockMovements.storeId, storeId))
  await db.delete(stockLevels).where(eq(stockLevels.storeId, storeId))
  await db.delete(products).where(eq(products.id, productId))
  await db.delete(stores).where(eq(stores.id, storeId))
})

describe('recordStockCount', () => {
  it('sets stock to the counted quantity and records the variance', async () => {
    const before = await stockOf()
    const count = await recordStockCount({ storeId, productId, countedQty: before + 10, countedBy: 'u1' })
    countIds.push(count.id)
    expect(count.variance).toBe(10)
    expect(await stockOf()).toBe(before + 10)
  })
})

describe('updateStockCount', () => {
  it('applies only the change in variance, not the absolute counted quantity, on top of current stock', async () => {
    const before = await stockOf()
    const count = await recordStockCount({ storeId, productId, countedQty: before + 10, countedBy: 'u1' })
    countIds.push(count.id)
    expect(await stockOf()).toBe(before + 10)

    // Correcting the count to +15 instead of +10 should only add the extra 5, not reset stock.
    const updated = await updateStockCount(count.id, { countedQty: before + 15 }, actor, 'Erreur de comptage')
    expect(updated.variance).toBe(15)
    expect(await stockOf()).toBe(before + 15)

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'stock_count'), eq(auditLog.entityId, count.id)))
    expect(log.action).toBe('update')
    expect(log.reason).toBe('Erreur de comptage')
  })

  it('rejects a correction that would push stock below zero', async () => {
    // Force a known baseline so the scenario is deterministic regardless of what earlier tests left.
    await db.update(stockLevels).set({ quantity: 5 }).where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId)))
    const count = await recordStockCount({ storeId, productId, countedQty: 5, countedBy: 'u1' }) // theoretical=5, variance=0
    countIds.push(count.id)
    // Simulate a sale consuming 4 units after the count was taken.
    await db.update(stockLevels).set({ quantity: 1 }).where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId)))

    // Correcting the count down to 0 would subtract another 5 from the current stock of 1 (-4).
    await expect(updateStockCount(count.id, { countedQty: 0 }, actor)).rejects.toThrow(/sous zéro/i)
  })
})

describe('deleteStockCount', () => {
  it('removes the variance from current stock and soft-deletes the row', async () => {
    const before = await stockOf()
    const count = await recordStockCount({ storeId, productId, countedQty: before + 8, countedBy: 'u1' })
    countIds.push(count.id)
    expect(await stockOf()).toBe(before + 8)

    await deleteStockCount(count.id, actor, 'Doublon')
    expect(await stockOf()).toBe(before)

    const [row] = await db.select().from(stockCounts).where(eq(stockCounts.id, count.id))
    expect(row.deletedAt).not.toBeNull()

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'stock_count'), eq(auditLog.entityId, count.id)))
    expect(log.action).toBe('delete')
    expect(log.reason).toBe('Doublon')
  })

  it('rejects deleting a count twice', async () => {
    const before = await stockOf()
    const count = await recordStockCount({ storeId, productId, countedQty: before + 3, countedBy: 'u1' })
    countIds.push(count.id)

    await deleteStockCount(count.id, actor)
    await expect(deleteStockCount(count.id, actor)).rejects.toThrow(/introuvable/i)
  })
})
