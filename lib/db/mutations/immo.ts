import { and, eq } from 'drizzle-orm'
import { db } from '../client'
import { buildingExpenses, buildings, leases, rentPayments, tenants, units } from '../schema'
import { addMonths } from '@/lib/dates'

type TenantBioInput = {
  email?: string | null
  profession?: string | null
  birthDate?: string | null
  birthPlace?: string | null
  nationality?: string | null
  cin?: string | null
  cinValidUntil?: string | null
}

export async function createTenant(input: { name: string; phone?: string | null } & TenantBioInput) {
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      profession: input.profession ?? null,
      birthDate: input.birthDate ?? null,
      birthPlace: input.birthPlace ?? null,
      nationality: input.nationality ?? null,
      cin: input.cin ?? null,
      cinValidUntil: input.cinValidUntil ?? null,
    })
    .returning()
  return tenant
}

// Fills in biographical details (CIN, date/lieu de naissance...) a tenant didn't have yet —
// needed because every tenant created before this feature predates these columns, and a lease
// contract can't be generated without them.
export async function updateTenant(tenantId: number, input: { name?: string; phone?: string | null } & TenantBioInput) {
  const [updated] = await db
    .update(tenants)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.profession !== undefined ? { profession: input.profession } : {}),
      ...(input.birthDate !== undefined ? { birthDate: input.birthDate } : {}),
      ...(input.birthPlace !== undefined ? { birthPlace: input.birthPlace } : {}),
      ...(input.nationality !== undefined ? { nationality: input.nationality } : {}),
      ...(input.cin !== undefined ? { cin: input.cin } : {}),
      ...(input.cinValidUntil !== undefined ? { cinValidUntil: input.cinValidUntil } : {}),
    })
    .where(eq(tenants.id, tenantId))
    .returning()
  if (!updated) {
    throw new Error('Locataire introuvable.')
  }
  return updated
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

export async function createBuilding(input: { name: string; address: string; servicesIncluded?: string | null }) {
  const [building] = await db.insert(buildings).values({ name: input.name, address: input.address, servicesIncluded: input.servicesIncluded ?? null }).returning()
  return building
}

export async function createUnit(input: { buildingId: number; label: string; floor: number; monthlyRent: number; description?: string | null }) {
  if (input.monthlyRent <= 0) {
    throw new Error('Le loyer doit être supérieur à zéro.')
  }
  const [unit] = await db
    .insert(units)
    .values({ buildingId: input.buildingId, label: input.label, floor: input.floor, monthlyRent: input.monthlyRent, description: input.description ?? null })
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

type GuarantorInput = {
  guarantorName?: string | null
  guarantorPhone?: string | null
  guarantorEmail?: string | null
  guarantorResidence?: string | null
  guarantorNationality?: string | null
  guarantorCin?: string | null
  guarantorCinValidUntil?: string | null
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
  noticeMonths?: number
  latePenaltyPct?: number
} & GuarantorInput) {
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
        durationMonths: input.months,
        noticeMonths: input.noticeMonths ?? 3,
        latePenaltyPct: input.latePenaltyPct ?? 10,
        guarantorName: input.guarantorName ?? null,
        guarantorPhone: input.guarantorPhone ?? null,
        guarantorEmail: input.guarantorEmail ?? null,
        guarantorResidence: input.guarantorResidence ?? null,
        guarantorNationality: input.guarantorNationality ?? null,
        guarantorCin: input.guarantorCin ?? null,
        guarantorCinValidUntil: input.guarantorCinValidUntil ?? null,
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

// Fills in guarantor details and boilerplate contract terms a lease didn't capture at signing —
// needed for leases created before this feature, and to correct a guarantor entered wrong.
export async function updateLeaseContractTerms(
  leaseId: number,
  input: { noticeMonths?: number; latePenaltyPct?: number } & GuarantorInput,
) {
  const [updated] = await db
    .update(leases)
    .set({
      ...(input.noticeMonths !== undefined ? { noticeMonths: input.noticeMonths } : {}),
      ...(input.latePenaltyPct !== undefined ? { latePenaltyPct: input.latePenaltyPct } : {}),
      ...(input.guarantorName !== undefined ? { guarantorName: input.guarantorName } : {}),
      ...(input.guarantorPhone !== undefined ? { guarantorPhone: input.guarantorPhone } : {}),
      ...(input.guarantorEmail !== undefined ? { guarantorEmail: input.guarantorEmail } : {}),
      ...(input.guarantorResidence !== undefined ? { guarantorResidence: input.guarantorResidence } : {}),
      ...(input.guarantorNationality !== undefined ? { guarantorNationality: input.guarantorNationality } : {}),
      ...(input.guarantorCin !== undefined ? { guarantorCin: input.guarantorCin } : {}),
      ...(input.guarantorCinValidUntil !== undefined ? { guarantorCinValidUntil: input.guarantorCinValidUntil } : {}),
    })
    .where(eq(leases.id, leaseId))
    .returning()
  if (!updated) {
    throw new Error('Bail introuvable.')
  }
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
