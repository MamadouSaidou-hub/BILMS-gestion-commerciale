import { and, eq } from 'drizzle-orm'
import { db } from '../client'
import { buildingExpenses, buildings, leases, rentPayments, tenants, units } from '../schema'
import { addMonths } from '@/lib/dates'

export async function createTenant(input: { name: string; phone?: string | null }) {
  const [tenant] = await db.insert(tenants).values({ name: input.name, phone: input.phone ?? null }).returning()
  return tenant
}

export async function recordBuildingExpense(input: { buildingId?: number | null; date: string; category: string; amount: number; notes?: string | null }) {
  if (input.amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }
  const [expense] = await db
    .insert(buildingExpenses)
    .values({ buildingId: input.buildingId ?? null, date: input.date, category: input.category, amount: input.amount, notes: input.notes ?? null })
    .returning()
  return expense
}

export async function createBuilding(input: { name: string; address: string }) {
  const [building] = await db.insert(buildings).values({ name: input.name, address: input.address }).returning()
  return building
}

export async function createUnit(input: { buildingId: number; label: string; floor: number; monthlyRent: number }) {
  if (input.monthlyRent <= 0) {
    throw new Error('Le loyer doit être supérieur à zéro.')
  }
  const [unit] = await db
    .insert(units)
    .values({ buildingId: input.buildingId, label: input.label, floor: input.floor, monthlyRent: input.monthlyRent })
    .returning()
  return unit
}

// Only the unit's own "sticker price" for the *next* lease signed on it — an active lease already
// snapshotted its own rent at signing (see createLease) and is deliberately untouched here, same
// as any other rent change on the unit after a lease started.
export async function updateUnitRent(unitId: number, monthlyRent: number) {
  if (monthlyRent <= 0) {
    throw new Error('Le loyer doit être supérieur à zéro.')
  }
  const [updated] = await db.update(units).set({ monthlyRent }).where(eq(units.id, unitId)).returning()
  if (!updated) {
    throw new Error('Logement introuvable.')
  }
  return updated
}

export async function createLease(input: {
  unitId: number
  // Either an existing tenant (tenantId) or a brand-new one entered inline (tenantName, +
  // optional tenantPhone) — exactly one of the two paths, enforced by the API route.
  tenantId?: number
  tenantName?: string
  tenantPhone?: string | null
  startDate: string
  months: number
  depositAmount?: number
}) {
  if (input.months <= 0) {
    throw new Error('La durée du bail doit être supérieure à zéro.')
  }
  if (input.depositAmount !== undefined && input.depositAmount < 0) {
    throw new Error('La caution ne peut pas être négative.')
  }

  return db.transaction(async (tx) => {
    const [unit] = await tx.select().from(units).where(eq(units.id, input.unitId))
    if (!unit) {
      throw new Error('Logement introuvable.')
    }
    if (unit.status !== 'vacant') {
      throw new Error('Ce logement n’est pas vacant.')
    }

    let tenantId = input.tenantId
    let tenantName = input.tenantName
    let tenantPhone = input.tenantPhone ?? null
    if (!tenantId) {
      if (!tenantName) {
        throw new Error('Nom du locataire requis.')
      }
      const [tenant] = await tx.insert(tenants).values({ name: tenantName, phone: tenantPhone }).returning()
      tenantId = tenant.id
    } else {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId))
      if (!tenant) {
        throw new Error('Locataire introuvable.')
      }
      tenantName = tenant.name
      tenantPhone = tenant.phone
    }

    const [lease] = await tx
      .insert(leases)
      .values({
        unitId: input.unitId,
        tenantId,
        tenantName: tenantName!,
        tenantPhone,
        startDate: input.startDate,
        endDate: addMonths(input.startDate, input.months),
        monthlyRent: unit.monthlyRent,
        depositAmount: input.depositAmount ?? 0,
      })
      .returning()

    await tx.update(units).set({ status: 'occupied' }).where(eq(units.id, input.unitId))

    return lease
  })
}

// A deliberate mid-lease rent revision (annual increase, negotiated reduction...) — distinct from
// the automatic snapshot at signing. Only ever affects rent_payments rows created *after* this
// call: recordRentPayment reads lease.monthlyRent fresh for a brand-new period row, while periods
// already recorded keep the amount they were created with. No separate history table — the
// quittance/rent-history list already shows each period's actual amount, which is the record that
// matters; what the rate used to be before a given change isn't tracked beyond that.
export async function updateLeaseRent(leaseId: number, monthlyRent: number) {
  if (monthlyRent <= 0) {
    throw new Error('Le loyer doit être supérieur à zéro.')
  }
  const [lease] = await db.select().from(leases).where(eq(leases.id, leaseId))
  if (!lease) {
    throw new Error('Bail introuvable.')
  }
  if (lease.status !== 'active') {
    throw new Error('Seul un bail actif peut être modifié.')
  }

  const [updated] = await db.update(leases).set({ monthlyRent }).where(eq(leases.id, leaseId)).returning()
  return updated
}

export async function renewLease(leaseId: number, additionalMonths: number) {
  if (additionalMonths <= 0) {
    throw new Error('Le nombre de mois doit être supérieur à zéro.')
  }

  const [lease] = await db.select().from(leases).where(eq(leases.id, leaseId))
  if (!lease) {
    throw new Error('Bail introuvable.')
  }
  if (lease.status !== 'active') {
    throw new Error('Seul un bail actif peut être renouvelé.')
  }

  const [updated] = await db
    .update(leases)
    .set({ endDate: addMonths(lease.endDate, additionalMonths) })
    .where(eq(leases.id, leaseId))
    .returning()
  return updated
}

export async function endLease(leaseId: number, settlement?: { depositReturnedAmount?: number; depositNotes?: string | null }) {
  return db.transaction(async (tx) => {
    const [lease] = await tx.select().from(leases).where(eq(leases.id, leaseId))
    if (!lease) {
      throw new Error('Bail introuvable.')
    }
    if (lease.status !== 'active') {
      throw new Error('Ce bail est déjà terminé.')
    }

    // Only a lease that actually took a deposit needs a settlement decision — nothing to record
    // (and the column stays at its 'held' default, which is meaningless here) for the common case
    // of a lease signed with no caution.
    const depositUpdate: Partial<typeof leases.$inferInsert> = {}
    if (lease.depositAmount > 0) {
      const returned = Math.min(Math.max(settlement?.depositReturnedAmount ?? 0, 0), lease.depositAmount)
      depositUpdate.depositReturnedAmount = returned
      depositUpdate.depositStatus = returned >= lease.depositAmount ? 'returned' : 'withheld'
      depositUpdate.depositNotes = settlement?.depositNotes ?? null
    }

    const [updated] = await tx
      .update(leases)
      .set({ status: 'ended', ...depositUpdate })
      .where(eq(leases.id, leaseId))
      .returning()
    await tx.update(units).set({ status: 'vacant' }).where(eq(units.id, lease.unitId))

    return updated
  })
}

export async function recordRentPayment(input: { leaseId: number; period: string; status: 'paid' | 'late' | 'unpaid' }) {
  const [lease] = await db.select().from(leases).where(eq(leases.id, input.leaseId))
  if (!lease) {
    throw new Error('Bail introuvable.')
  }

  const [existingForPeriod] = await db
    .select()
    .from(rentPayments)
    .where(and(eq(rentPayments.leaseId, input.leaseId), eq(rentPayments.period, input.period)))

  if (existingForPeriod) {
    const [updated] = await db
      .update(rentPayments)
      .set({ status: input.status, paidDate: input.status === 'paid' ? new Date().toISOString() : null })
      .where(eq(rentPayments.id, existingForPeriod.id))
      .returning()
    return updated
  }

  const [payment] = await db
    .insert(rentPayments)
    .values({
      leaseId: input.leaseId,
      period: input.period,
      amount: lease.monthlyRent,
      status: input.status,
      paidDate: input.status === 'paid' ? new Date().toISOString() : null,
    })
    .returning()
  return payment
}
