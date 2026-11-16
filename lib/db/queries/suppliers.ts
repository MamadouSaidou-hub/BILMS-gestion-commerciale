import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  cashAccounts,
  products,
  stores,
  supplierDeliveries,
  supplierDeliveryCharges,
  supplierDeliveryItems,
  supplierPayables,
  supplierPayments,
  suppliers,
} from '../schema'
import { formatFcfa, isPastDue } from '@/lib/format'
import { effectiveDate } from './effective-date'

export async function getSuppliersOverview() {
  const supplierRows = await db.select().from(suppliers)
  const payableRows = await db
    .select({ supplierId: supplierPayables.supplierId, amount: supplierPayables.amount, status: supplierPayables.status, dueDate: supplierPayables.dueDate })
    .from(supplierPayables)
  const paymentRows = await db
    .select({ supplierId: supplierPayments.supplierId, amount: supplierPayments.amount })
    .from(supplierPayments)
    .where(isNull(supplierPayments.deletedAt))
  const deliveryRows = await db
    .select({
      id: supplierDeliveries.id,
      supplierId: supplierDeliveries.supplierId,
      createdAt: supplierDeliveries.createdAt,
      sackCount: sql<number>`coalesce((select sum(${supplierDeliveryItems.sackCount}) from ${supplierDeliveryItems} where ${supplierDeliveryItems.deliveryId} = ${supplierDeliveries.id}), 0)`.mapWith(Number),
    })
    .from(supplierDeliveries)
    .where(isNull(supplierDeliveries.deletedAt))

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const result = supplierRows.map((supplier) => {
    const owedRows = payableRows.filter((row) => row.supplierId === supplier.id && row.status !== 'paid')
    const owed = owedRows.reduce((sum, row) => sum + row.amount, 0)
    const overdue = owedRows.some((row) => isPastDue(row.dueDate))
    const totalPaid = paymentRows.filter((row) => row.supplierId === supplier.id).reduce((sum, row) => sum + row.amount, 0)
    const deliveriesThisMonth = deliveryRows.filter((row) => row.supplierId === supplier.id && row.createdAt >= monthStart.toISOString())
    const sacksThisMonth = deliveriesThisMonth.reduce((sum, row) => sum + row.sackCount, 0)
    const status: 'ok' | 'pending' | 'overdue' = owed === 0 ? 'ok' : overdue ? 'overdue' : 'pending'
    return {
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone ?? '—',
      owed: formatFcfa(owed),
      owedRaw: owed,
      totalPaid: formatFcfa(totalPaid),
      sacksThisMonth,
      status,
    }
  })

  const totalOwed = result.reduce((sum, supplier) => sum + supplier.owedRaw, 0)
  const deliveriesThisMonthCount = deliveryRows.filter((row) => row.createdAt >= monthStart.toISOString()).length

  return {
    suppliers: result.map(({ owedRaw, ...supplier }) => supplier),
    summary: {
      totalSuppliers: result.length,
      totalOwed: formatFcfa(totalOwed),
      deliveriesThisMonth: deliveriesThisMonthCount,
    },
  }
}

export async function getSupplierOptions() {
  return db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(suppliers.name)
}

export async function getSupplierDeliveryHistory(supplierId: number) {
  const deliveries = await db
    .select({
      id: supplierDeliveries.id,
      storeId: supplierDeliveries.storeId,
      storeName: stores.name,
      reference: supplierDeliveries.reference,
      totalAmount: supplierDeliveries.totalAmount,
      date: supplierDeliveries.date,
      effectiveDate: sql<string>`${effectiveDate(supplierDeliveries.date, supplierDeliveries.createdAt)}`,
      createdAt: supplierDeliveries.createdAt,
    })
    .from(supplierDeliveries)
    .innerJoin(stores, eq(supplierDeliveries.storeId, stores.id))
    .where(and(eq(supplierDeliveries.supplierId, supplierId), isNull(supplierDeliveries.deletedAt)))
    .orderBy(desc(sql`${effectiveDate(supplierDeliveries.date, supplierDeliveries.createdAt)}`))

  if (deliveries.length === 0) return []

  const deliveryIds = deliveries.map((delivery) => delivery.id)
  const [itemRows, chargeRows] = await Promise.all([
    db
      .select({
        deliveryId: supplierDeliveryItems.deliveryId,
        productId: supplierDeliveryItems.productId,
        productName: products.name,
        sackCount: supplierDeliveryItems.sackCount,
        tonnage: supplierDeliveryItems.tonnage,
        unitCost: supplierDeliveryItems.unitCost,
      })
      .from(supplierDeliveryItems)
      .innerJoin(products, eq(supplierDeliveryItems.productId, products.id))
      .where(inArray(supplierDeliveryItems.deliveryId, deliveryIds)),
    db
      .select({ deliveryId: supplierDeliveryCharges.deliveryId, description: supplierDeliveryCharges.description, quantity: supplierDeliveryCharges.quantity, unitPrice: supplierDeliveryCharges.unitPrice })
      .from(supplierDeliveryCharges)
      .where(inArray(supplierDeliveryCharges.deliveryId, deliveryIds)),
  ])

  return deliveries.map((delivery) => {
    const items = itemRows
      .filter((item) => item.deliveryId === delivery.id)
      .map((item) => ({
        productId: item.productId,
        productName: item.productName,
        sackCount: item.sackCount,
        tonnage: item.tonnage,
        unitCost: item.unitCost,
        lineTotal: item.sackCount * item.unitCost,
      }))
    const charges = chargeRows
      .filter((charge) => charge.deliveryId === delivery.id)
      .map((charge) => ({ description: charge.description, quantity: charge.quantity, unitPrice: charge.unitPrice, lineTotal: charge.quantity * charge.unitPrice }))

    return { ...delivery, totalAmountFormatted: formatFcfa(delivery.totalAmount), items, charges }
  })
}

export async function getSupplierPaymentHistory(supplierId: number) {
  const rows = await db
    .select({
      id: supplierPayments.id,
      amount: supplierPayments.amount,
      method: supplierPayments.method,
      date: supplierPayments.date,
      createdAt: supplierPayments.createdAt,
      cashAccountId: supplierPayments.cashAccountId,
      cashAccountName: cashAccounts.name,
    })
    .from(supplierPayments)
    .leftJoin(cashAccounts, eq(supplierPayments.cashAccountId, cashAccounts.id))
    .where(and(eq(supplierPayments.supplierId, supplierId), isNull(supplierPayments.deletedAt)))
    .orderBy(desc(sql`${effectiveDate(supplierPayments.date, supplierPayments.createdAt)}`))

  return rows.map((row) => ({
    id: row.id,
    amount: row.amount,
    amountFormatted: formatFcfa(row.amount),
    method: row.method,
    date: row.date,
    cashAccountId: row.cashAccountId,
    cashAccountName: row.cashAccountName ?? 'Caisse par défaut',
    effectiveDate: row.date ?? row.createdAt,
    createdAt: row.createdAt,
  }))
}
