import { and, desc, eq, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../client'
import { stores, transferItems, transfers } from '../schema'
import { periodRange, type CustomRange, type PeriodKey } from '@/lib/period'
import { resolveStoreId } from './shared'
import { effectiveDate, effectiveDateGte, effectiveDateLt } from './effective-date'

export async function getTransfersList(period: PeriodKey, storeName: string | null, custom?: CustomRange) {
  const { start, end } = periodRange(period, custom)
  // Only a custom range gets an upper bound: the named periods stay open-ended so a row dated
  // slightly in the future (an advance entry) still shows up rather than silently vanishing.
  const upperBound = period === 'custom' ? effectiveDateLt(transfers.date, transfers.createdAt, end) : undefined
  const storeId = await resolveStoreId(storeName)
  const storeFilter = storeId ? or(eq(transfers.fromStoreId, storeId), eq(transfers.toStoreId, storeId)) : undefined

  const fromStore = alias(stores, 'from_store')
  const toStore = alias(stores, 'to_store')

  const rows = await db
    .select({
      id: transfers.id,
      reference: transfers.reference,
      createdAt: sql<string>`${effectiveDate(transfers.date, transfers.createdAt)}`,
      status: transfers.status,
      fromStoreName: fromStore.name,
      toStoreName: toStore.name,
      itemCount: sql<number>`(select count(*) from ${transferItems} where ${transferItems.transferId} = ${transfers.id})`.mapWith(Number),
      totalQuantity: sql<number>`(select coalesce(sum(${transferItems.quantity}), 0) from ${transferItems} where ${transferItems.transferId} = ${transfers.id})`.mapWith(Number),
    })
    .from(transfers)
    .innerJoin(fromStore, eq(transfers.fromStoreId, fromStore.id))
    .innerJoin(toStore, eq(transfers.toStoreId, toStore.id))
    .where(and(effectiveDateGte(transfers.date, transfers.createdAt, start), upperBound, storeFilter))
    .orderBy(desc(sql`${effectiveDate(transfers.date, transfers.createdAt)}`))

  const pendingCount = rows.filter((row) => row.status !== 'completed').length
  const totalQuantity = rows.reduce((sum, row) => sum + row.totalQuantity, 0)

  return {
    transfers: rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      date: row.createdAt,
      fromStore: row.fromStoreName,
      toStore: row.toStoreName,
      status: row.status,
      itemCount: row.itemCount,
      totalQuantity: row.totalQuantity,
    })),
    summary: {
      count: rows.length,
      pendingCount,
      totalQuantity,
    },
  }
}
