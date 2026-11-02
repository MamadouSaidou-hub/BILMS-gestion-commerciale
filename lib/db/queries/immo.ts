import { desc } from 'drizzle-orm'
import { db } from '../client'
import { buildings, leases, rentPayments, units } from '../schema'
import { formatFcfa } from '@/lib/format'

export async function getBuildingsOverview() {
  const buildingRows = await db.select().from(buildings).orderBy(buildings.name)
  const unitRows = await db.select().from(units).orderBy(units.floor, units.label)
  const leaseRows = await db.select().from(leases).orderBy(desc(leases.createdAt))
  const paymentRows = await db.select().from(rentPayments).orderBy(desc(rentPayments.period))

  return {
    buildings: buildingRows.map((building) => ({
      id: building.id,
      name: building.name,
      address: building.address,
      units: unitRows
        .filter((unit) => unit.buildingId === building.id)
        .map((unit) => {
          const activeLease = leaseRows.find((lease) => lease.unitId === unit.id && lease.status === 'active')
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
                  payments: paymentRows
                    .filter((payment) => payment.leaseId === activeLease.id)
                    .map((payment) => ({ period: payment.period, status: payment.status, amountFormatted: formatFcfa(payment.amount) })),
                }
              : null,
          }
        }),
    })),
  }
}
