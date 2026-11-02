import { and, eq } from 'drizzle-orm'
import { db } from '../client'
import { buildings, leases, rentPayments, units } from '../schema'

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

export async function createLease(input: {
  unitId: number
  tenantName: string
  tenantPhone?: string | null
  startDate: string
}) {
  return db.transaction(async (tx) => {
    const [unit] = await tx.select().from(units).where(eq(units.id, input.unitId))
    if (!unit) {
      throw new Error('Logement introuvable.')
    }
    if (unit.status !== 'vacant') {
      throw new Error('Ce logement n’est pas vacant.')
    }

    const [lease] = await tx
      .insert(leases)
      .values({
        unitId: input.unitId,
        tenantName: input.tenantName,
        tenantPhone: input.tenantPhone ?? null,
        startDate: input.startDate,
        monthlyRent: unit.monthlyRent,
      })
      .returning()

    await tx.update(units).set({ status: 'occupied' }).where(eq(units.id, input.unitId))

    return lease
  })
}

export async function endLease(leaseId: number) {
  return db.transaction(async (tx) => {
    const [lease] = await tx.select().from(leases).where(eq(leases.id, leaseId))
    if (!lease) {
      throw new Error('Bail introuvable.')
    }
    if (lease.status !== 'active') {
      throw new Error('Ce bail est déjà terminé.')
    }

    const [updated] = await tx.update(leases).set({ status: 'ended' }).where(eq(leases.id, leaseId)).returning()
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
