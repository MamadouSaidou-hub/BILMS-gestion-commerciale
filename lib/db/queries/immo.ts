import { desc, eq } from 'drizzle-orm'
import { db } from '../client'
import { buildingExpenses, buildings, leases, rentPayments, units } from '../schema'
import { formatFcfa } from '@/lib/format'
import { daysUntil } from '@/lib/dates'

export async function getBuildingsOverview() {
  const buildingRows = await db.select().from(buildings).orderBy(buildings.name)
  const unitRows = await db.select().from(units).orderBy(units.floor, units.label)
  const leaseRows = await db.select().from(leases).orderBy(desc(leases.createdAt))
  const paymentRows = await db.select().from(rentPayments).orderBy(desc(rentPayments.period))
  const expenseRows = await db.select().from(buildingExpenses).orderBy(desc(buildingExpenses.date))

  const upcomingDeadlines: { leaseId: number; unitLabel: string; buildingName: string; tenantName: string; endDate: string; daysRemaining: number }[] = []

  const buildingsResult = buildingRows.map((building) => ({
    id: building.id,
    name: building.name,
    address: building.address,
    units: unitRows
      .filter((unit) => unit.buildingId === building.id)
      .map((unit) => {
        const activeLease = leaseRows.find((lease) => lease.unitId === unit.id && lease.status === 'active')
        if (activeLease) {
          const daysRemaining = daysUntil(activeLease.endDate)
          // The point of tracking endDate is to catch leases coming due before they're ended —
          // surface them here instead of only recording the date.
          if (daysRemaining <= 7) {
            upcomingDeadlines.push({ leaseId: activeLease.id, unitLabel: unit.label, buildingName: building.name, tenantName: activeLease.tenantName, endDate: activeLease.endDate, daysRemaining })
          }
        }
        return {
          id: unit.id,
          label: unit.label,
          floor: unit.floor,
          monthlyRent: unit.monthlyRent,
          monthlyRentFormatted: formatFcfa(unit.monthlyRent),
          status: unit.status,
          activeLease: activeLease
            ? {
                id: activeLease.id,
                tenantName: activeLease.tenantName,
                tenantPhone: activeLease.tenantPhone,
                startDate: activeLease.startDate,
                endDate: activeLease.endDate,
                daysRemaining: daysUntil(activeLease.endDate),
                payments: paymentRows
                  .filter((payment) => payment.leaseId === activeLease.id)
                  .map((payment) => ({ id: payment.id, period: payment.period, status: payment.status, amountFormatted: formatFcfa(payment.amount) })),
              }
            : null,
        }
      }),
  }))

  const rentCollected = paymentRows.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0)
  const totalExpenses = expenseRows.reduce((sum, row) => sum + row.amount, 0)
  const occupiedCount = unitRows.filter((u) => u.status === 'occupied').length

  return {
    buildings: buildingsResult,
    upcomingDeadlines,
    expenses: expenseRows.map((row) => ({
      id: row.id,
      buildingId: row.buildingId,
      buildingName: row.buildingId ? (buildingRows.find((b) => b.id === row.buildingId)?.name ?? '—') : 'Dépense générale',
      date: row.date,
      category: row.category,
      amountFormatted: formatFcfa(row.amount),
      notes: row.notes,
    })),
    summary: {
      rentCollected,
      rentCollectedFormatted: formatFcfa(rentCollected),
      totalExpenses,
      totalExpensesFormatted: formatFcfa(totalExpenses),
      net: rentCollected - totalExpenses,
      netFormatted: formatFcfa(rentCollected - totalExpenses),
      unitsTotal: unitRows.length,
      occupiedCount,
      vacantCount: unitRows.length - occupiedCount,
      occupancyRate: unitRows.length > 0 ? Math.round((occupiedCount / unitRows.length) * 100) : 0,
    },
  }
}

export async function getBuildingOptions() {
  return db.select({ id: buildings.id, name: buildings.name }).from(buildings).orderBy(buildings.name)
}

export async function getRentPaymentDetail(paymentId: number) {
  const [payment] = await db.select().from(rentPayments).where(eq(rentPayments.id, paymentId))
  if (!payment || payment.status !== 'paid') return null

  const [lease] = await db.select().from(leases).where(eq(leases.id, payment.leaseId))
  if (!lease) return null
  const [unit] = await db.select().from(units).where(eq(units.id, lease.unitId))
  const building = unit ? (await db.select().from(buildings).where(eq(buildings.id, unit.buildingId)))[0] : undefined

  return {
    id: payment.id,
    reference: `QUIT-${payment.period}-${String(payment.id).padStart(4, '0')}`,
    period: payment.period,
    paidDate: payment.paidDate,
    amount: payment.amount,
    amountFormatted: formatFcfa(payment.amount),
    tenantName: lease.tenantName,
    tenantPhone: lease.tenantPhone,
    unitLabel: unit?.label ?? '—',
    buildingName: building?.name ?? '—',
    buildingAddress: building?.address ?? '—',
  }
}
