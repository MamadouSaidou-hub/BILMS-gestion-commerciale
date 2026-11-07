import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { buildingExpenses, buildings, leases, rentPayments, tenants, units } from '@/lib/db/schema'
import { createBuilding, createLease, createTenant, createUnit, endLease, recordBuildingExpense, recordRentPayment, renewLease, updateLeaseRent, updateUnitRent } from '@/lib/db/mutations/immo'
import { getTenantDetail } from '@/lib/db/queries/immo'

const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const buildingIds: number[] = []
const unitIds: number[] = []
const leaseIds: number[] = []
const expenseIds: number[] = []
const tenantIds: number[] = []

async function makeUnit(label: string, monthlyRent = 500000) {
  const building = await createBuilding({ name: `Immeuble ${label} ${runId}`, address: 'Adresse test' })
  buildingIds.push(building.id)
  const unit = await createUnit({ buildingId: building.id, label: `Logement ${label}`, floor: 1, monthlyRent })
  unitIds.push(unit.id)
  return unit
}

afterAll(async () => {
  for (const id of expenseIds) {
    await db.delete(buildingExpenses).where(eq(buildingExpenses.id, id))
  }
  // Every createLease() call auto-creates a tenant row (unless an existing tenantId was passed) —
  // collect them before the leases are gone, so none are left orphaned in the real tenants table.
  const leaseTenantIds = new Set(tenantIds)
  for (const id of leaseIds) {
    const [lease] = await db.select({ tenantId: leases.tenantId }).from(leases).where(eq(leases.id, id))
    if (lease) leaseTenantIds.add(lease.tenantId)
    await db.delete(rentPayments).where(eq(rentPayments.leaseId, id))
    await db.delete(leases).where(eq(leases.id, id))
  }
  for (const id of unitIds) {
    await db.delete(units).where(eq(units.id, id))
  }
  for (const id of buildingIds) {
    await db.delete(buildings).where(eq(buildings.id, id))
  }
  for (const id of leaseTenantIds) {
    await db.delete(tenants).where(eq(tenants.id, id))
  }
})

describe('recordBuildingExpense', () => {
  it('records an expense linked to a building', async () => {
    await makeUnit('G')
    const buildingId = buildingIds[buildingIds.length - 1]
    const expense = await recordBuildingExpense({ buildingId, date: '2026-11-01', category: 'Plomberie', amount: 200000 })
    expenseIds.push(expense.id)
    expect(expense.buildingId).toBe(buildingId)
  })

  it('records a general expense with no building link', async () => {
    const expense = await recordBuildingExpense({ date: '2026-11-01', category: 'Taxe foncière', amount: 500000 })
    expenseIds.push(expense.id)
    expect(expense.buildingId).toBeNull()
  })

  it('rejects a non-positive amount', async () => {
    await expect(recordBuildingExpense({ date: '2026-11-01', category: 'Test', amount: -1 })).rejects.toThrow(/supérieur à zéro/i)
  })
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

describe('createLease with a tenant dossier', () => {
  it('creates a new tenant when given a name, and links the lease to it', async () => {
    const unit = await makeUnit('H')
    const lease = await createLease({ unitId: unit.id, tenantName: 'Nouveau Locataire', tenantPhone: '600000000', startDate: '2026-11-01', months: 12 })
    leaseIds.push(lease.id)
    tenantIds.push(lease.tenantId)

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, lease.tenantId))
    expect(tenant.name).toBe('Nouveau Locataire')
    expect(tenant.phone).toBe('600000000')
  })

  it('reuses an existing tenant (no duplicate created) and links every lease into one history', async () => {
    const tenant = await createTenant({ name: 'Locataire Récurrent', phone: '611111111' })
    tenantIds.push(tenant.id)

    const unitA = await makeUnit('I1')
    const leaseA = await createLease({ unitId: unitA.id, tenantId: tenant.id, startDate: '2026-11-01', months: 6 })
    leaseIds.push(leaseA.id)
    expect(leaseA.tenantName).toBe('Locataire Récurrent')

    await endLease(leaseA.id)

    const unitB = await makeUnit('I2')
    const leaseB = await createLease({ unitId: unitB.id, tenantId: tenant.id, startDate: '2027-01-01', months: 6 })
    leaseIds.push(leaseB.id)

    const tenantRows = await db.select().from(tenants).where(eq(tenants.id, tenant.id))
    expect(tenantRows).toHaveLength(1)

    const detail = await getTenantDetail(tenant.id)
    expect(detail?.leases.map((l) => l.id).sort()).toEqual([leaseA.id, leaseB.id].sort())
  })

  it('rejects a lease with neither tenantId nor tenantName', async () => {
    const unit = await makeUnit('J')
    await expect(createLease({ unitId: unit.id, startDate: '2026-11-01', months: 12 })).rejects.toThrow(/nom du locataire/i)
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

describe('createLease with a deposit', () => {
  it('snapshots the deposit amount on the lease, defaulting to 0 when not given', async () => {
    const unitWithDeposit = await makeUnit('K1')
    const leaseWithDeposit = await createLease({ unitId: unitWithDeposit.id, tenantName: 'Locataire Caution', startDate: '2026-11-01', months: 12, depositAmount: 150000 })
    leaseIds.push(leaseWithDeposit.id)
    expect(leaseWithDeposit.depositAmount).toBe(150000)
    expect(leaseWithDeposit.depositStatus).toBe('held')

    const unitNoDeposit = await makeUnit('K2')
    const leaseNoDeposit = await createLease({ unitId: unitNoDeposit.id, tenantName: 'Locataire Sans Caution', startDate: '2026-11-01', months: 12 })
    leaseIds.push(leaseNoDeposit.id)
    expect(leaseNoDeposit.depositAmount).toBe(0)
  })

  it('rejects a negative deposit', async () => {
    const unit = await makeUnit('K3')
    await expect(createLease({ unitId: unit.id, tenantName: 'Locataire Test', startDate: '2026-11-01', months: 12, depositAmount: -1 })).rejects.toThrow(/caution/i)
  })
})

describe('updateUnitRent', () => {
  it('updates the unit base rent without touching an active lease on it', async () => {
    const unit = await makeUnit('M1', 500000)
    const lease = await createLease({ unitId: unit.id, tenantName: 'Locataire Loyer Base', startDate: '2026-11-01', months: 12 })
    leaseIds.push(lease.id)

    const updatedUnit = await updateUnitRent(unit.id, 600000)
    expect(updatedUnit.monthlyRent).toBe(600000)

    const [unchangedLease] = await db.select().from(leases).where(eq(leases.id, lease.id))
    expect(unchangedLease.monthlyRent).toBe(500000)
  })

  it('rejects a non-positive rent', async () => {
    const unit = await makeUnit('M2')
    await expect(updateUnitRent(unit.id, 0)).rejects.toThrow(/supérieur à zéro/i)
  })
})

describe('updateLeaseRent', () => {
  it('changes what a future recordRentPayment call snapshots, without touching an already-recorded period', async () => {
    const unit = await makeUnit('N1', 500000)
    const lease = await createLease({ unitId: unit.id, tenantName: 'Locataire Révision Loyer', startDate: '2026-11-01', months: 12 })
    leaseIds.push(lease.id)

    const novemberPayment = await recordRentPayment({ leaseId: lease.id, period: '2026-11', status: 'paid' })
    expect(novemberPayment.amount).toBe(500000)

    const updated = await updateLeaseRent(lease.id, 550000)
    expect(updated.monthlyRent).toBe(550000)

    // The already-recorded November period keeps its original amount...
    const [novemberRow] = await db.select().from(rentPayments).where(eq(rentPayments.id, novemberPayment.id))
    expect(novemberRow.amount).toBe(500000)

    // ...while a brand-new period picks up the new rate.
    const decemberPayment = await recordRentPayment({ leaseId: lease.id, period: '2026-12', status: 'unpaid' })
    expect(decemberPayment.amount).toBe(550000)
  })

  it('rejects a non-positive rent', async () => {
    const unit = await makeUnit('N2')
    const lease = await createLease({ unitId: unit.id, tenantName: 'Locataire Test', startDate: '2026-11-01', months: 12 })
    leaseIds.push(lease.id)
    await expect(updateLeaseRent(lease.id, -100)).rejects.toThrow(/supérieur à zéro/i)
  })

  it('rejects changing the rent of an already-ended lease', async () => {
    const unit = await makeUnit('N3')
    const lease = await createLease({ unitId: unit.id, tenantName: 'Locataire Fin Loyer', startDate: '2026-11-01', months: 1 })
    leaseIds.push(lease.id)
    await endLease(lease.id)

    await expect(updateLeaseRent(lease.id, 600000)).rejects.toThrow(/actif/i)
  })
})

describe('endLease deposit settlement', () => {
  it('marks the deposit returned when the full amount is given back', async () => {
    const unit = await makeUnit('L1')
    const lease = await createLease({ unitId: unit.id, tenantName: 'Locataire Caution Rendue', startDate: '2026-11-01', months: 12, depositAmount: 100000 })
    leaseIds.push(lease.id)

    const ended = await endLease(lease.id, { depositReturnedAmount: 100000 })
    expect(ended.depositStatus).toBe('returned')
    expect(ended.depositReturnedAmount).toBe(100000)
  })

  it('marks the deposit withheld when only part (or none) is given back, and records the reason', async () => {
    const unit = await makeUnit('L2')
    const lease = await createLease({ unitId: unit.id, tenantName: 'Locataire Caution Retenue', startDate: '2026-11-01', months: 12, depositAmount: 100000 })
    leaseIds.push(lease.id)

    const ended = await endLease(lease.id, { depositReturnedAmount: 40000, depositNotes: 'Réparations peinture' })
    expect(ended.depositStatus).toBe('withheld')
    expect(ended.depositReturnedAmount).toBe(40000)
    expect(ended.depositNotes).toBe('Réparations peinture')
  })

  it('leaves the deposit untouched when the lease never took one', async () => {
    const unit = await makeUnit('L3')
    const lease = await createLease({ unitId: unit.id, tenantName: 'Locataire Sans Caution Fin', startDate: '2026-11-01', months: 12 })
    leaseIds.push(lease.id)

    const ended = await endLease(lease.id)
    expect(ended.depositStatus).toBe('held')
    expect(ended.depositReturnedAmount).toBeNull()
  })
})
