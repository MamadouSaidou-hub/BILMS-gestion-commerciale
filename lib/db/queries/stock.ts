import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../client'
import { products, stockCounts, stockLevels, stockReceptions, stores } from '../schema'
import { formatFcfa } from '@/lib/format'
import { resolveStoreId } from './shared'
import { effectiveDate } from './effective-date'

export async function getStockOverview(storeName: string | null) {
  const storeId = await resolveStoreId(storeName)

  const rows = await db
    .select({
      name: products.name,
      sku: products.sku,
      category: products.category,
      unitPrice: products.unitPrice,
      threshold: products.reorderThreshold,
      quantity: stockLevels.quantity,
      storeName: stores.name,
    })
    .from(stockLevels)
    .innerJoin(products, eq(stockLevels.productId, products.id))
    .innerJoin(stores, eq(stockLevels.storeId, stores.id))
    .where(storeId ? eq(stockLevels.storeId, storeId) : undefined)
    .orderBy(products.name)

  const items = rows.map((row) => {
    const status: 'critical' | 'low' | 'ok' = row.quantity <= row.threshold / 2 ? 'critical' : row.quantity <= row.threshold ? 'low' : 'ok'
    return {
      name: row.name,
      sku: row.sku,
      category: row.category,
      store: row.storeName,
      quantity: row.quantity,
      threshold: row.threshold,
      unitPrice: formatFcfa(row.unitPrice),
      status,
    }
  })

  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0)
  const lowCount = items.filter((item) => item.status !== 'ok').length
  const stockValue = rows.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0)

  return {
    items,
    summary: {
      totalArticles: items.length,
      totalQuantity,
      lowCount,
      stockValue: formatFcfa(stockValue),
    },
  }
}

export async function getStockCountHistory(storeName: string | null) {
  const storeId = await resolveStoreId(storeName)

  const rows = await db
    .select({
      id: stockCounts.id,
      productId: stockCounts.productId,
      productName: products.name,
      sku: products.sku,
      storeId: stockCounts.storeId,
      storeName: stores.name,
      theoreticalQty: stockCounts.theoreticalQty,
      countedQty: stockCounts.countedQty,
      variance: stockCounts.variance,
      ownDate: stockCounts.date,
      createdAt: sql<string>`${effectiveDate(stockCounts.date, stockCounts.createdAt)}`,
    })
    .from(stockCounts)
    .innerJoin(products, eq(stockCounts.productId, products.id))
    .innerJoin(stores, eq(stockCounts.storeId, stores.id))
    .where(and(isNull(stockCounts.deletedAt), storeId ? eq(stockCounts.storeId, storeId) : undefined))
    .orderBy(desc(sql`${effectiveDate(stockCounts.date, stockCounts.createdAt)}`))
    .limit(50)

  return rows
}

export async function getStockReceptionHistory(storeName: string | null) {
  const storeId = await resolveStoreId(storeName)

  const rows = await db
    .select({
      id: stockReceptions.id,
      productId: stockReceptions.productId,
      productName: products.name,
      sku: products.sku,
      storeId: stockReceptions.storeId,
      storeName: stores.name,
      quantity: stockReceptions.quantity,
      reference: stockReceptions.reference,
      date: sql<string>`${effectiveDate(stockReceptions.date, stockReceptions.createdAt)}`,
      createdAt: stockReceptions.createdAt,
    })
    .from(stockReceptions)
    .innerJoin(products, eq(stockReceptions.productId, products.id))
    .innerJoin(stores, eq(stockReceptions.storeId, stores.id))
    .where(and(isNull(stockReceptions.deletedAt), storeId ? eq(stockReceptions.storeId, storeId) : undefined))
    .orderBy(desc(sql`${effectiveDate(stockReceptions.date, stockReceptions.createdAt)}`))
    .limit(50)

  return rows
}
