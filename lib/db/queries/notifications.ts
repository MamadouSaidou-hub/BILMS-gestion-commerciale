import { and, eq, or } from 'drizzle-orm'
import { db } from '../client'
import { products, stockLevels, stores, transfers } from '../schema'
import { getDueDateAlerts } from './alerts'
import { getLeaseDeadlineAlerts, getUnpaidRentAlerts } from './immo'
import { getVehicleDueBackAlerts } from './location-voiture'

export type NotificationItem = {
  id: string
  tone: 'red' | 'orange' | 'blue'
  title: string
  subtitle: string
  href: string
}

/**
 * Live, computed-on-read notifications — no persistence/read-tracking table. Reuses the same
 * overdue/low-stock/pending-transfer signals already surfaced elsewhere (dashboard alerts, due
 * banner) so the bell icon never disagrees with what those pages already show.
 */
export async function getNotifications(storeId: number | null, isAdminUser: boolean): Promise<NotificationItem[]> {
  const items: NotificationItem[] = []

  const dueAlerts = await getDueDateAlerts(storeId, isAdminUser)
  for (const alert of dueAlerts.overdue) {
    items.push({
      id: `due-${alert.kind}-${alert.name}-${alert.dueDate}`,
      tone: 'red',
      title: alert.kind === 'client' ? `Créance en retard — ${alert.name}` : `Dette fournisseur en retard — ${alert.name}`,
      subtitle: `${alert.amount} · échéance dépassée de ${Math.abs(alert.daysUntilDue)} j`,
      href: alert.kind === 'client' ? '/clients' : '/fournisseurs',
    })
  }
  for (const alert of dueAlerts.upcoming) {
    items.push({
      id: `soon-${alert.kind}-${alert.name}-${alert.dueDate}`,
      tone: 'orange',
      title: alert.kind === 'client' ? `Échéance proche — ${alert.name}` : `Paiement fournisseur proche — ${alert.name}`,
      subtitle: `${alert.amount} · dans ${alert.daysUntilDue} j`,
      href: alert.kind === 'client' ? '/clients' : '/fournisseurs',
    })
  }

  const stockRows = await db
    .select({
      productName: products.name,
      quantity: stockLevels.quantity,
      threshold: products.reorderThreshold,
      storeName: stores.name,
    })
    .from(stockLevels)
    .innerJoin(products, eq(stockLevels.productId, products.id))
    .innerJoin(stores, eq(stockLevels.storeId, stores.id))
    .where(storeId ? eq(stockLevels.storeId, storeId) : undefined)

  const lowStock = stockRows.filter((row) => row.quantity <= row.threshold)
  for (const row of lowStock.slice(0, 5)) {
    items.push({
      id: `stock-${row.productName}-${row.storeName}`,
      tone: row.quantity <= row.threshold / 2 ? 'red' : 'orange',
      title: `Stock critique — ${row.productName}`,
      subtitle: `${row.quantity} sac(s) restant(s) · ${row.storeName}`,
      href: '/stock',
    })
  }

  // Immo and Location voiture are admin-only sections (see middleware/route guards) — never surface
  // their alerts to a non-admin store user, same gating as includeSuppliers above.
  if (isAdminUser) {
    const leaseDeadlines = await getLeaseDeadlineAlerts()
    for (const deadline of leaseDeadlines) {
      items.push({
        id: `lease-${deadline.leaseId}`,
        tone: deadline.daysRemaining <= 0 ? 'red' : 'orange',
        title: `Bail arrivant à échéance — ${deadline.tenantName}`,
        subtitle: `${deadline.buildingName} — ${deadline.unitLabel} · ${deadline.daysRemaining <= 0 ? 'échéance dépassée' : `dans ${deadline.daysRemaining} j`}`,
        href: '/immo',
      })
    }

    const unpaidRent = await getUnpaidRentAlerts()
    for (const unpaid of unpaidRent) {
      items.push({
        id: `rent-${unpaid.leaseId}-${unpaid.period}`,
        tone: 'red',
        title: `Loyer impayé — ${unpaid.tenantName}`,
        subtitle: `${unpaid.buildingName} — ${unpaid.unitLabel} · ${unpaid.amountFormatted} · ${unpaid.period}`,
        href: '/immo',
      })
    }

    const dueBackRentals = await getVehicleDueBackAlerts()
    for (const rental of dueBackRentals) {
      items.push({
        id: `rental-${rental.rentalId}`,
        tone: rental.daysRemaining <= 0 ? 'red' : 'orange',
        title: `Véhicule à rendre — ${rental.vehicleName}`,
        subtitle: `${rental.clientName} · ${rental.daysRemaining <= 0 ? 'retour dépassé' : `dans ${rental.daysRemaining} j`}`,
        href: '/location-voiture',
      })
    }
  }

  const transferRows = await db
    .select({ reference: transfers.reference, toStoreName: stores.name })
    .from(transfers)
    .innerJoin(stores, eq(transfers.toStoreId, stores.id))
    .where(storeId ? and(eq(transfers.status, 'in_transit'), or(eq(transfers.toStoreId, storeId), eq(transfers.fromStoreId, storeId))) : eq(transfers.status, 'in_transit'))

  for (const row of transferRows) {
    items.push({
      id: `transfer-${row.reference}`,
      tone: 'blue',
      title: `Transfert en cours — ${row.reference}`,
      subtitle: `Vers ${row.toStoreName}`,
      href: '/transferts',
    })
  }

  return items
}
