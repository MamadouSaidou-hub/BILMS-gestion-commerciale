import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { buildingExpenses, buildings, leases, rentPayments, tenants, units } from '@/lib/db/schema'
import { createBuilding, createLease, createUnit } from '@/lib/db/mutations/immo'
import { getImmoReportsOverview } from '@/lib/db/queries/immo'

// A period far enough in the future that no real rent/expense data can collide with it — the
// report query sums across the whole table with no tenant/store scoping (single-tenant app), so
// exact-equality assertions on a shared period would be flaky against real usage.
const period = '2099-01'
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

const buildingIds: number[] = []
const unitIds: number[] = []
const leaseIds: number[] = []
const expenseIds: number[] = []
const tenantIds: number[] = []

afterAll(async () => {
  for (const id of expenseIds) {
    await db.delete(buildingExpenses).where(eq(buildingExpenses.id, id))
  }
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

describe('getImmoReportsOverview', () => {
  it('sums rent collected/expected and the collection rate for the given period', async () => {
    const building = await createBuilding({ name: `Immeuble Rapport ${runId}`, address: 'Adresse test' })
    buildingIds.push(building.id)
    const unit = await createUnit({ buildingId: building.id, label: `Logement Rapport ${runId}`, floor: 1, monthlyRent: 500000 })
    unitIds.push(unit.id)
    // A sky-high amount guarantees this tenant ranks in the top 5 regardless of any real data.
    const lease = await createLease({ unitId: unit.id, tenantName: `Locataire Rapport ${runId}`, startDate: '2026-11-01', months: 12 })
    leaseIds.push(lease.id)
    tenantIds.push(lease.tenantId)

    const [paid] = await db.insert(rentPayments).values({ leaseId: lease.id, period, amount: 90000000, status: 'paid', paidDate: '2099-01-05' }).returning()
    const [unpaid] = await db.insert(rentPayments).values({ leaseId: lease.id, period, amount: 10000000, status: 'unpaid' }).returning()

    const expense = await db
      .insert(buildingExpenses)
      .values({ buildingId: building.id, date: '2099-01-10', category: `Entretien ${runId}`, amount: 200000 })
      .returning()
    expenseIds.push(expense[0].id)

    const report = await getImmoReportsOverview(period)

    expect(report.period).toBe(period)
    expect(report.rentCollected).toBeGreaterThanOrEqual(90000000)
    expect(report.rentExpected).toBeGreaterThanOrEqual(100000000)
    expect(report.collectionRate).toBeLessThanOrEqual(90)
    expect(report.collectionRate).toBeGreaterThan(0)

    const category = report.expensesByCategory.find((row) => row.category === `Entretien ${runId}`)
    expect(category?.amount).toBe(200000)

    const topTenant = report.topTenants.find((row) => row.id === lease.tenantId)
    expect(topTenant?.totalPaid).toBe(90000000)

    await db.delete(rentPayments).where(eq(rentPayments.id, paid.id))
    await db.delete(rentPayments).where(eq(rentPayments.id, unpaid.id))
  })

  it('returns zero collection rate when nothing was expected for the period', async () => {
    const report = await getImmoReportsOverview('2099-12')
    expect(report.rentExpected).toBe(0)
    expect(report.collectionRate).toBe(0)
  })
})
