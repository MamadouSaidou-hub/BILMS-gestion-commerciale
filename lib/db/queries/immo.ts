import { desc, eq } from 'drizzle-orm'
import { db } from '../client'
import { buildingExpenses, buildings, leases, rentPayments, tenants, units } from '../schema'
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
                tenantId: activeLease.tenantId,
                tenantName: activeLease.tenantName,
                tenantPhone: activeLease.tenantPhone,
                startDate: activeLease.startDate,
                endDate: activeLease.endDate,
                daysRemaining: daysUntil(activeLease.endDate),
                monthlyRent: activeLease.monthlyRent,
                monthlyRentFormatted: formatFcfa(activeLease.monthlyRent),
                depositAmount: activeLease.depositAmount,
                depositAmountFormatted: formatFcfa(activeLease.depositAmount),
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
    unpaidRent: await getUnpaidRentAlerts(),
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

// Leases ending within a week — same threshold/shape as getBuildingsOverview's upcomingDeadlines,
// but standalone (leases + units + buildings only) so the global notification bell can pull this
// signal without paying for the full overview's payments/expenses queries.
export async function getLeaseDeadlineAlerts() {
  const leaseRows = await db.select().from(leases).where(eq(leases.status, 'active'))
  const unitRows = await db.select().from(units)
  const buildingRows = await db.select().from(buildings)

  return leaseRows
    .map((lease) => {
      const unit = unitRows.find((u) => u.id === lease.unitId)
      const building = unit ? buildingRows.find((b) => b.id === unit.buildingId) : undefined
      return {
        leaseId: lease.id,
        unitLabel: unit?.label ?? '—',
        buildingName: building?.name ?? '—',
        tenantName: lease.tenantName,
        endDate: lease.endDate,
        daysRemaining: daysUntil(lease.endDate),
      }
    })
    .filter((row) => row.daysRemaining <= 7)
}

// A grace period before an unpaid current-month rent counts as an alert — gives tenants the first
// days of the month to pay before the admin is bothered about it. rent_payments rows are only
// created when someone explicitly records a status, so a lease with no row at all for the current
// period is treated the same as an explicit 'unpaid' row (the UI already defaults missing rows the
// same way when showing the month's status per unit).
const RENT_GRACE_DAY = 5

export async function getUnpaidRentAlerts() {
  const today = new Date()
  if (today.getDate() <= RENT_GRACE_DAY) return []
  const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const leaseRows = await db.select().from(leases).where(eq(leases.status, 'active'))
  const paymentRows = await db.select().from(rentPayments).where(eq(rentPayments.period, period))
  const unitRows = await db.select().from(units)
  const buildingRows = await db.select().from(buildings)

  return leaseRows
    .filter((lease) => paymentRows.find((p) => p.leaseId === lease.id)?.status !== 'paid')
    .map((lease) => {
      const unit = unitRows.find((u) => u.id === lease.unitId)
      const building = unit ? buildingRows.find((b) => b.id === unit.buildingId) : undefined
      return {
        leaseId: lease.id,
        unitLabel: unit?.label ?? '—',
        buildingName: building?.name ?? '—',
        tenantName: lease.tenantName,
        period,
        amountFormatted: formatFcfa(lease.monthlyRent),
        daysOverdue: today.getDate() - RENT_GRACE_DAY,
      }
    })
}

export async function getBuildingOptions() {
  return db.select({ id: buildings.id, name: buildings.name }).from(buildings).orderBy(buildings.name)
}

export async function getTenantsOverview() {
  const tenantRows = await db.select().from(tenants).orderBy(tenants.name)
  const leaseRows = await db.select().from(leases)
  const paymentRows = await db.select().from(rentPayments)

  const result = tenantRows.map((tenant) => {
    const tenantLeases = leaseRows.filter((lease) => lease.tenantId === tenant.id)
    const leaseIds = new Set(tenantLeases.map((lease) => lease.id))
    const totalPaid = paymentRows.filter((payment) => leaseIds.has(payment.leaseId) && payment.status === 'paid').reduce((sum, payment) => sum + payment.amount, 0)
    return {
      id: tenant.id,
      name: tenant.name,
      phone: tenant.phone ?? '—',
      leasesCount: tenantLeases.length,
      hasActiveLease: tenantLeases.some((lease) => lease.status === 'active'),
      totalPaid,
      totalPaidFormatted: formatFcfa(totalPaid),
    }
  })

  return { tenants: result }
}

export async function getTenantDetail(tenantId: number) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  if (!tenant) return null

  const leaseRows = await db.select().from(leases).where(eq(leases.tenantId, tenantId)).orderBy(desc(leases.createdAt))
  const unitRows = await db.select().from(units)
  const buildingRows = await db.select().from(buildings)
  const paymentRows = await db.select().from(rentPayments)

  const leaseHistory = leaseRows.map((lease) => {
    const unit = unitRows.find((u) => u.id === lease.unitId)
    const building = unit ? buildingRows.find((b) => b.id === unit.buildingId) : undefined
    const leasePayments = paymentRows.filter((payment) => payment.leaseId === lease.id)
    return {
      id: lease.id,
      unitLabel: unit?.label ?? '—',
      buildingName: building?.name ?? '—',
      startDate: lease.startDate,
      endDate: lease.endDate,
      status: lease.status,
      monthlyRentFormatted: formatFcfa(lease.monthlyRent),
      depositAmount: lease.depositAmount,
      depositAmountFormatted: formatFcfa(lease.depositAmount),
      depositStatus: lease.depositStatus,
      depositReturnedAmountFormatted: lease.depositReturnedAmount !== null ? formatFcfa(lease.depositReturnedAmount) : null,
      depositNotes: lease.depositNotes,
      durationMonths: lease.durationMonths,
      noticeMonths: lease.noticeMonths,
      latePenaltyPct: lease.latePenaltyPct,
      guarantorName: lease.guarantorName,
      guarantorPhone: lease.guarantorPhone,
      guarantorEmail: lease.guarantorEmail,
      guarantorResidence: lease.guarantorResidence,
      guarantorNationality: lease.guarantorNationality,
      guarantorCin: lease.guarantorCin,
      guarantorCinValidUntil: lease.guarantorCinValidUntil,
      payments: leasePayments.map((payment) => ({ id: payment.id, period: payment.period, status: payment.status, amountFormatted: formatFcfa(payment.amount) })),
    }
  })

  return {
    id: tenant.id,
    name: tenant.name,
    phone: tenant.phone ?? '—',
    email: tenant.email,
    profession: tenant.profession,
    birthDate: tenant.birthDate,
    birthPlace: tenant.birthPlace,
    nationality: tenant.nationality,
    cin: tenant.cin,
    cinValidUntil: tenant.cinValidUntil,
    leases: leaseHistory,
  }
}

function currentPeriodKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export async function getImmoReportsOverview(period?: string) {
  const selectedPeriod = period ?? currentPeriodKey()

  const unitRows = await db.select().from(units)
  const paymentRows = await db.select().from(rentPayments)
  const expenseRows = await db.select().from(buildingExpenses)
  const tenantRows = await db.select().from(tenants).orderBy(tenants.name)
  const leaseRows = await db.select().from(leases)

  const periodPayments = paymentRows.filter((payment) => payment.period === selectedPeriod)
  const rentCollected = periodPayments.filter((payment) => payment.status === 'paid').reduce((sum, payment) => sum + payment.amount, 0)
  const rentExpected = periodPayments.reduce((sum, payment) => sum + payment.amount, 0)
  const collectionRate = rentExpected > 0 ? Math.round((rentCollected / rentExpected) * 100) : 0

  const periodExpenses = expenseRows.filter((expense) => expense.date.slice(0, 7) === selectedPeriod)
  const totalExpenses = periodExpenses.reduce((sum, expense) => sum + expense.amount, 0)

  const expensesByCategoryMap = new Map<string, number>()
  for (const expense of periodExpenses) {
    expensesByCategoryMap.set(expense.category, (expensesByCategoryMap.get(expense.category) ?? 0) + expense.amount)
  }
  const expensesByCategory = Array.from(expensesByCategoryMap.entries())
    .map(([category, amount]) => ({ category, amount, amountFormatted: formatFcfa(amount) }))
    .sort((a, b) => b.amount - a.amount)

  const occupiedCount = unitRows.filter((unit) => unit.status === 'occupied').length

  // Cumulative, not period-filtered — a tenant's value is read over their whole history, not one month.
  const topTenants = tenantRows
    .map((tenant) => {
      const leaseIds = new Set(leaseRows.filter((lease) => lease.tenantId === tenant.id).map((lease) => lease.id))
      const totalPaid = paymentRows.filter((payment) => leaseIds.has(payment.leaseId) && payment.status === 'paid').reduce((sum, payment) => sum + payment.amount, 0)
      return { id: tenant.id, name: tenant.name, totalPaid, totalPaidFormatted: formatFcfa(totalPaid) }
    })
    .filter((tenant) => tenant.totalPaid > 0)
    .sort((a, b) => b.totalPaid - a.totalPaid)
    .slice(0, 5)

  const availablePeriods = Array.from(new Set([...paymentRows.map((p) => p.period), ...expenseRows.map((e) => e.date.slice(0, 7)), selectedPeriod])).sort().reverse()

  return {
    period: selectedPeriod,
    availablePeriods,
    rentCollected,
    rentCollectedFormatted: formatFcfa(rentCollected),
    rentExpected,
    rentExpectedFormatted: formatFcfa(rentExpected),
    collectionRate,
    totalExpenses,
    totalExpensesFormatted: formatFcfa(totalExpenses),
    net: rentCollected - totalExpenses,
    netFormatted: formatFcfa(rentCollected - totalExpenses),
    occupancyRate: unitRows.length > 0 ? Math.round((occupiedCount / unitRows.length) * 100) : 0,
    expensesByCategory,
    topTenants,
  }
}

// Everything a "CONTRAT DE BAIL" PDF needs — tenant/guarantor identity, the unit/building it's
// for, and the lease's financial/contractual terms. Mirrors getRentPaymentDetail's join shape
// (lease → unit → building), plus a live read of the tenant row (not the lease's name/phone
// snapshot) since the contract needs the tenant's full biographical details, not just the two
// fields the lease snapshotted at signing.
export async function getLeaseContractDetail(leaseId: number) {
  const [lease] = await db.select().from(leases).where(eq(leases.id, leaseId))
  if (!lease) return null
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, lease.tenantId))
  const [unit] = await db.select().from(units).where(eq(units.id, lease.unitId))
  const building = unit ? (await db.select().from(buildings).where(eq(buildings.id, unit.buildingId)))[0] : undefined

  return {
    id: lease.id,
    startDate: lease.startDate,
    endDate: lease.endDate,
    durationMonths: lease.durationMonths,
    noticeMonths: lease.noticeMonths,
    latePenaltyPct: lease.latePenaltyPct,
    monthlyRent: lease.monthlyRent,
    monthlyRentFormatted: formatFcfa(lease.monthlyRent),
    depositAmount: lease.depositAmount,
    depositAmountFormatted: formatFcfa(lease.depositAmount),
    tenant: {
      name: lease.tenantName,
      phone: lease.tenantPhone,
      email: tenant?.email ?? null,
      profession: tenant?.profession ?? null,
      birthDate: tenant?.birthDate ?? null,
      birthPlace: tenant?.birthPlace ?? null,
      nationality: tenant?.nationality ?? null,
      cin: tenant?.cin ?? null,
      cinValidUntil: tenant?.cinValidUntil ?? null,
    },
    guarantor: {
      name: lease.guarantorName,
      phone: lease.guarantorPhone,
      email: lease.guarantorEmail,
      residence: lease.guarantorResidence,
      nationality: lease.guarantorNationality,
      cin: lease.guarantorCin,
      cinValidUntil: lease.guarantorCinValidUntil,
    },
    unit: {
      label: unit?.label ?? '—',
      floor: unit?.floor ?? 0,
      description: unit?.description ?? null,
    },
    building: {
      name: building?.name ?? '—',
      address: building?.address ?? '—',
      servicesIncluded: building?.servicesIncluded ?? null,
    },
  }
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
