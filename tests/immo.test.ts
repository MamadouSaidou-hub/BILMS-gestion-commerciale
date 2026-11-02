import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { buildings, leases, rentPayments, units } from '@/lib/db/schema'
import { createBuilding, createLease, createUnit, endLease, recordRentPayment, renewLease } from '@/lib/db/mutations/immo'

const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const buildingIds: number[] = []
const unitIds: number[] = []
const leaseIds: number[] = []

async function makeUnit(label: string, monthlyRent = 500000) {
  const building = await createBuilding({ name: `Immeuble ${label} ${runId}`, address: 'Adresse test' })
  buildingIds.push(building.id)
  const unit = await createUnit({ buildingId: building.id, label: `Logement ${label}`, floor: 1, monthlyRent })
  unitIds.push(unit.id)
  return unit
}

afterAll(async () => {
  for (const id of leaseIds) {
    await db.delete(rentPayments).where(eq(rentPayments.leaseId, id))
    await db.delete(leases).where(eq(leases.id, id))
  }
  for (const id of unitIds) {
    await db.delete(units).where(eq(units.id, id))
  }
  for (const id of buildingIds) {
    await db.delete(buildings).where(eq(buildings.id, id))
  }
})

describe('createLease', () => {
  it('snapshots the unit rent and marks the unit occupied', async () => {
    const unit = await makeUnit('A', 500000)
    const lease = await createLease({ unitId: unit.id, tenantName: 'Locataire Test', startDate: '2026-11-01', months: 12 })
    leaseIds.push(lease.id)

    expect(lease.monthlyRent).toBe(500000)

    const [updated] = await db.select().from(units).where(eq(units.id, unit.id))
    expect(updated.status).toBe('occupied')
  })

  it('rejects a lease on a unit that already has one', async () => {
    const unit = await makeUnit('B')
    const lease = await createLease({ unitId: unit.id, tenantName: 'Premier locataire', startDate: '2026-11-01', months: 12 })
    leaseIds.push(lease.id)

    await expect(createLease({ unitId: unit.id, tenantName: 'Deuxième locataire', startDate: '2026-11-01', months: 12 })).rejects.toThrow(/vacant/i)
  })
})

describe('recordRentPayment', () => {
  it('creates one payment row per period and updates it on a second call for the same period', async () => {
    const unit = await makeUnit('C')
    const lease = await createLease({ unitId: unit.id, tenantName: 'Locataire Loyers', startDate: '2026-11-01', months: 12 })
    leaseIds.push(lease.id)

    const first = await recordRentPayment({ leaseId: lease.id, period: '2026-11', status: 'unpaid' })
    const second = await recordRentPayment({ leaseId: lease.id, period: '2026-11', status: 'paid' })

    expect(second.id).toBe(first.id)
    expect(second.status).toBe('paid')

    const rows = await db.select().from(rentPayments).where(eq(rentPayments.leaseId, lease.id))
    expect(rows.length).toBe(1)
  })
})

describe('renewLease', () => {
  it('pushes the end date back by the given number of months', async () => {
    const unit = await makeUnit('E')
    const lease = await createLease({ unitId: unit.id, tenantName: 'Locataire Renouvellement', startDate: '2026-11-01', months: 6 })
    leaseIds.push(lease.id)
    expect(lease.endDate).toBe('2027-05-01')

    const renewed = await renewLease(lease.id, 6)
    expect(renewed.endDate).toBe('2027-11-01')
  })

  it('rejects renewing a lease that already ended', async () => {
    const unit = await makeUnit('F')
    const lease = await createLease({ unitId: unit.id, tenantName: 'Locataire Fin Renew', startDate: '2026-11-01', months: 1 })
    leaseIds.push(lease.id)
    await endLease(lease.id)

    await expect(renewLease(lease.id, 1)).rejects.toThrow(/actif/i)
  })
})

describe('endLease', () => {
  it('marks the lease ended and frees the unit', async () => {
    const unit = await makeUnit('D')
    const lease = await createLease({ unitId: unit.id, tenantName: 'Locataire Fin', startDate: '2026-11-01', months: 12 })
    leaseIds.push(lease.id)

    const ended = await endLease(lease.id)
    expect(ended.status).toBe('ended')

    const [updated] = await db.select().from(units).where(eq(units.id, unit.id))
    expect(updated.status).toBe('vacant')
  })
})
