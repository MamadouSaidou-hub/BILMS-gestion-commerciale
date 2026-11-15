import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../client'
import { rentalCharges, rentalClients, rentalPayments, rentalRenewals, vehicleExpenses, vehicleRentals, vehicles } from '../schema'
import { addDays } from '@/lib/dates'
import { writeAuditLog, type Actor } from './audit'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Extra invoice lines (fuel, road fees...) are owed just as much as the vehicle-rental line
 * itself — `paymentStatus` must be computed against `totalAmount + chargesTotal` ("grand total",
 * same figure the invoice shows), not `totalAmount` alone, or a rental with unpaid charges can
 * read as fully "paid" once the base rental amount is covered. */
async function getChargesTotal(tx: Tx | typeof db, rentalId: number) {
  const charges = await tx.select().from(rentalCharges).where(eq(rentalCharges.rentalId, rentalId))
  return charges.reduce((sum, charge) => sum + charge.quantity * charge.unitPrice, 0)
}

function paymentStatusFor(amountPaid: number, grandTotal: number): 'paid' | 'partial' | 'unpaid' {
  return amountPaid >= grandTotal ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'
}

/** Recomputes `amountPaid`/`paymentStatus` from the rental's live payment rows — called after any
 * payment is added, corrected or removed, so the rental's running total can never drift from the
 * payments that justify it. */
async function syncRentalPaidTotals(tx: Tx, rentalId: number, grandTotalBase: number) {
  const paymentRows = await tx.select().from(rentalPayments).where(and(eq(rentalPayments.rentalId, rentalId), isNull(rentalPayments.deletedAt)))
  const amountPaid = paymentRows.reduce((sum, row) => sum + row.amount, 0)
  const chargesTotal = await getChargesTotal(tx, rentalId)
  const paymentStatus = paymentStatusFor(amountPaid, grandTotalBase + chargesTotal)

  const [updated] = await tx.update(vehicleRentals).set({ amountPaid, paymentStatus }).where(eq(vehicleRentals.id, rentalId)).returning()
  return updated
}

export async function createRentalClient(input: { name: string; phone?: string | null }) {
  const [client] = await db.insert(rentalClients).values({ name: input.name, phone: input.phone ?? null }).returning()
  return client
}

export async function createVehicle(input: { name: string; plate: string; dailyRate: number; notes?: string | null }) {
  if (input.dailyRate <= 0) {
    throw new Error('Le tarif journalier doit être supérieur à zéro.')
  }
  const [vehicle] = await db
    .insert(vehicles)
    .values({ name: input.name, plate: input.plate, dailyRate: input.dailyRate, notes: input.notes ?? null })
    .returning()
  return vehicle
}

export async function createRental(input: {
  vehicleId: number
  // Either an existing client (clientId) or a brand-new one entered inline (clientName, +
  // optional clientPhone) — exactly one of the two paths, enforced by the API route.
  clientId?: number
  clientName?: string
  clientPhone?: string | null
  startDate: string
  days: number
  // Lets the admin price this specific trip differently from the vehicle's standing rate (e.g. a
  // longer/farther route) instead of always inheriting `vehicle.dailyRate`.
  dailyRateOverride?: number
  // Purely informational trip record — see schema.ts's comment on these columns.
  departureCity?: string | null
  destinationCity?: string | null
  // Extra invoice lines (fuel, road fees...) entered at booking time instead of only afterward via
  // addRentalCharge — same shape, just inserted inside this same transaction.
  charges?: { description: string; unit?: string | null; quantity: number; unitPrice: number }[]
}) {
  if (input.days <= 0) {
    throw new Error('La durée de location doit être supérieure à zéro.')
  }
  if (input.dailyRateOverride !== undefined && input.dailyRateOverride <= 0) {
    throw new Error('Le tarif journalier doit être supérieur à zéro.')
  }
  if (input.charges?.some((charge) => charge.quantity <= 0 || charge.unitPrice <= 0)) {
    throw new Error('Quantité et prix unitaire doivent être supérieurs à zéro.')
  }

  return db.transaction(async (tx) => {
    const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicleId)).for('update')
    if (!vehicle) {
      throw new Error('Véhicule introuvable.')
    }
    if (vehicle.status !== 'available') {
      throw new Error('Ce véhicule n’est pas disponible.')
    }

    let clientId = input.clientId
    let clientName = input.clientName
    let clientPhone = input.clientPhone ?? null
    if (!clientId) {
      if (!clientName) {
        throw new Error('Nom du client requis.')
      }
      const [client] = await tx.insert(rentalClients).values({ name: clientName, phone: clientPhone }).returning()
      clientId = client.id
    } else {
      const [client] = await tx.select().from(rentalClients).where(eq(rentalClients.id, clientId))
      if (!client) {
        throw new Error('Client introuvable.')
      }
      clientName = client.name
      clientPhone = client.phone
    }

    const dailyRate = input.dailyRateOverride ?? vehicle.dailyRate
    const totalAmount = dailyRate * input.days
    const [rental] = await tx
      .insert(vehicleRentals)
      .values({
        vehicleId: input.vehicleId,
        clientId,
        clientName: clientName!,
        clientPhone,
        startDate: input.startDate,
        plannedEndDate: addDays(input.startDate, input.days),
        dailyRate,
        totalAmount,
        departureCity: input.departureCity ?? null,
        destinationCity: input.destinationCity ?? null,
      })
      .returning()

    await tx.update(vehicles).set({ status: 'rented' }).where(eq(vehicles.id, input.vehicleId))

    if (input.charges && input.charges.length > 0) {
      await tx.insert(rentalCharges).values(
        input.charges.map((charge) => ({
          rentalId: rental.id,
          description: charge.description,
          unit: charge.unit ?? null,
          quantity: charge.quantity,
          unitPrice: charge.unitPrice,
        })),
      )
    }

    return rental
  })
}

export async function closeRental(rentalId: number, input: { endDate: string }) {
  return db.transaction(async (tx) => {
    const [rental] = await tx.select().from(vehicleRentals).where(and(eq(vehicleRentals.id, rentalId), isNull(vehicleRentals.deletedAt)))
    if (!rental) {
      throw new Error('Location introuvable.')
    }
    if (rental.status !== 'active') {
      throw new Error('Cette location est déjà clôturée.')
    }

    const [updated] = await tx
      .update(vehicleRentals)
      .set({ status: 'completed', endDate: input.endDate })
      .where(eq(vehicleRentals.id, rentalId))
      .returning()

    await tx.update(vehicles).set({ status: 'available' }).where(eq(vehicles.id, rental.vehicleId))

    return updated
  })
}

export async function renewRental(rentalId: number, additionalDays: number, input: { date?: string | null } = {}) {
  if (additionalDays <= 0) {
    throw new Error('Le nombre de jours doit être supérieur à zéro.')
  }

  return db.transaction(async (tx) => {
    const [rental] = await tx.select().from(vehicleRentals).where(and(eq(vehicleRentals.id, rentalId), isNull(vehicleRentals.deletedAt))).for('update')
    if (!rental) {
      throw new Error('Location introuvable.')
    }
    if (rental.status !== 'active') {
      throw new Error('Seule une location active peut être renouvelée.')
    }

    // Extending the contract adds to what's owed, so a rental already marked "paid" can genuinely
    // become "partial" again — recompute from the new total rather than leaving the old status.
    const totalAmount = rental.totalAmount + rental.dailyRate * additionalDays
    const chargesTotal = await getChargesTotal(tx, rentalId)
    const paymentStatus = paymentStatusFor(rental.amountPaid, totalAmount + chargesTotal)

    const [updated] = await tx
      .update(vehicleRentals)
      .set({ plannedEndDate: addDays(rental.plannedEndDate, additionalDays), totalAmount, paymentStatus })
      .where(eq(vehicleRentals.id, rentalId))
      .returning()

    await tx.insert(rentalRenewals).values({
      rentalId,
      additionalDays,
      addedAmount: rental.dailyRate * additionalDays,
      date: input.date ?? null,
    })
    return updated
  })
}

export async function recordVehicleExpense(input: { vehicleId?: number | null; date: string; category: string; amount: number; notes?: string | null }) {
  if (input.amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }
  const [expense] = await db
    .insert(vehicleExpenses)
    .values({ vehicleId: input.vehicleId ?? null, date: input.date, category: input.category, amount: input.amount, notes: input.notes ?? null })
    .returning()
  return expense
}

export async function updateVehicleExpense(
  id: number,
  input: { vehicleId?: number | null; date?: string; category?: string; amount?: number; notes?: string | null },
  actor: Actor,
  reason?: string,
) {
  if (input.amount !== undefined && input.amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(vehicleExpenses).where(and(eq(vehicleExpenses.id, id), isNull(vehicleExpenses.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Dépense introuvable.')
    }

    const [updated] = await tx
      .update(vehicleExpenses)
      .set({
        ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
        ...(input.date !== undefined ? { date: input.date } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })
      .where(eq(vehicleExpenses.id, id))
      .returning()

    await writeAuditLog(tx, { entityType: 'vehicle_expense', entityId: id, action: 'update', actor, reason, beforeData: existing, afterData: updated })

    return updated
  })
}

export async function deleteVehicleExpense(id: number, actor: Actor, reason?: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(vehicleExpenses).where(and(eq(vehicleExpenses.id, id), isNull(vehicleExpenses.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Dépense introuvable.')
    }

    const [deleted] = await tx
      .update(vehicleExpenses)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(vehicleExpenses.id, id))
      .returning()

    await writeAuditLog(tx, { entityType: 'vehicle_expense', entityId: id, action: 'delete', actor, reason, beforeData: existing })

    return deleted
  })
}

export async function addRentalCharge(
  rentalId: number,
  input: { description: string; unit?: string | null; quantity: number; unitPrice: number; date?: string | null },
) {
  if (input.quantity <= 0 || input.unitPrice <= 0) {
    throw new Error('Quantité et prix unitaire doivent être supérieurs à zéro.')
  }
  return db.transaction(async (tx) => {
    const [rental] = await tx.select().from(vehicleRentals).where(and(eq(vehicleRentals.id, rentalId), isNull(vehicleRentals.deletedAt))).for('update')
    if (!rental) {
      throw new Error('Location introuvable.')
    }
    const [charge] = await tx
      .insert(rentalCharges)
      .values({
        rentalId,
        description: input.description,
        unit: input.unit ?? null,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        date: input.date ?? null,
      })
      .returning()

    const chargesTotal = await getChargesTotal(tx, rentalId)
    const paymentStatus = paymentStatusFor(rental.amountPaid, rental.totalAmount + chargesTotal)
    if (paymentStatus !== rental.paymentStatus) {
      await tx.update(vehicleRentals).set({ paymentStatus }).where(eq(vehicleRentals.id, rentalId))
    }

    return charge
  })
}

export async function removeRentalCharge(chargeId: number) {
  return db.transaction(async (tx) => {
    const [charge] = await tx.select().from(rentalCharges).where(eq(rentalCharges.id, chargeId))
    if (!charge) return

    await tx.delete(rentalCharges).where(eq(rentalCharges.id, chargeId))

    const [rental] = await tx.select().from(vehicleRentals).where(eq(vehicleRentals.id, charge.rentalId)).for('update')
    if (!rental) return

    const chargesTotal = await getChargesTotal(tx, charge.rentalId)
    const paymentStatus = paymentStatusFor(rental.amountPaid, rental.totalAmount + chargesTotal)
    if (paymentStatus !== rental.paymentStatus) {
      await tx.update(vehicleRentals).set({ paymentStatus }).where(eq(vehicleRentals.id, charge.rentalId))
    }
  })
}

export async function recordRentalPayment(rentalId: number, amount: number, input: { date?: string | null } = {}) {
  if (amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }

  return db.transaction(async (tx) => {
    const [rental] = await tx.select().from(vehicleRentals).where(and(eq(vehicleRentals.id, rentalId), isNull(vehicleRentals.deletedAt))).for('update')
    if (!rental) {
      throw new Error('Location introuvable.')
    }

    await tx.insert(rentalPayments).values({ rentalId, amount, date: input.date ?? null })
    return syncRentalPaidTotals(tx, rentalId, rental.totalAmount)
  })
}

export async function updateRentalPayment(
  id: number,
  input: { amount: number; date?: string | null },
  actor: Actor,
  reason?: string,
) {
  if (input.amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(rentalPayments).where(and(eq(rentalPayments.id, id), isNull(rentalPayments.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Paiement introuvable.')
    }
    const [rental] = await tx.select().from(vehicleRentals).where(eq(vehicleRentals.id, existing.rentalId)).for('update')
    if (!rental) {
      throw new Error('Location introuvable.')
    }

    const [updated] = await tx
      .update(rentalPayments)
      .set({ amount: input.amount, date: input.date ?? null })
      .where(eq(rentalPayments.id, id))
      .returning()

    await syncRentalPaidTotals(tx, existing.rentalId, rental.totalAmount)

    await writeAuditLog(tx, {
      entityType: 'rental_payment',
      entityId: id,
      action: 'update',
      actor,
      reason,
      beforeData: existing,
      afterData: updated,
    })

    return updated
  })
}

export async function deleteRentalPayment(id: number, actor: Actor, reason?: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(rentalPayments).where(and(eq(rentalPayments.id, id), isNull(rentalPayments.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Paiement introuvable.')
    }
    const [rental] = await tx.select().from(vehicleRentals).where(eq(vehicleRentals.id, existing.rentalId)).for('update')
    if (!rental) {
      throw new Error('Location introuvable.')
    }

    const [deleted] = await tx
      .update(rentalPayments)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(rentalPayments.id, id))
      .returning()

    await syncRentalPaidTotals(tx, existing.rentalId, rental.totalAmount)

    await writeAuditLog(tx, {
      entityType: 'rental_payment',
      entityId: id,
      action: 'delete',
      actor,
      reason,
      beforeData: existing,
    })

    return deleted
  })
}

export async function updateRental(
  rentalId: number,
  input: { startDate?: string; days?: number; dailyRateOverride?: number; notes?: string | null; departureCity?: string | null; destinationCity?: string | null },
  actor: Actor,
  reason?: string,
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(vehicleRentals)
      .where(and(eq(vehicleRentals.id, rentalId), isNull(vehicleRentals.deletedAt)))
      .for('update')
    if (!existing) {
      throw new Error('Location introuvable.')
    }
    if (input.days !== undefined && input.days <= 0) {
      throw new Error('La durée de location doit être supérieure à zéro.')
    }
    if (input.dailyRateOverride !== undefined && input.dailyRateOverride <= 0) {
      throw new Error('Le tarif journalier doit être supérieur à zéro.')
    }

    const startDate = input.startDate ?? existing.startDate
    const days = input.days ?? Math.max(1, Math.round((new Date(existing.plannedEndDate).getTime() - new Date(existing.startDate).getTime()) / (24 * 60 * 60 * 1000)))
    const dailyRate = input.dailyRateOverride ?? existing.dailyRate
    const totalAmount = dailyRate * days
    const chargesTotal = await getChargesTotal(tx, rentalId)
    const paymentStatus = paymentStatusFor(existing.amountPaid, totalAmount + chargesTotal)

    const [updated] = await tx
      .update(vehicleRentals)
      .set({
        startDate,
        plannedEndDate: addDays(startDate, days),
        dailyRate,
        totalAmount,
        paymentStatus,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.departureCity !== undefined ? { departureCity: input.departureCity } : {}),
        ...(input.destinationCity !== undefined ? { destinationCity: input.destinationCity } : {}),
      })
      .where(eq(vehicleRentals.id, rentalId))
      .returning()

    await writeAuditLog(tx, {
      entityType: 'vehicle_rental',
      entityId: rentalId,
      action: 'update',
      actor,
      reason,
      beforeData: existing,
      afterData: updated,
    })

    return updated
  })
}

export async function deleteRental(rentalId: number, actor: Actor, reason?: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(vehicleRentals)
      .where(and(eq(vehicleRentals.id, rentalId), isNull(vehicleRentals.deletedAt)))
      .for('update')
    if (!existing) {
      throw new Error('Location introuvable.')
    }

    if (existing.status === 'active') {
      await tx.update(vehicles).set({ status: 'available' }).where(eq(vehicles.id, existing.vehicleId))
    }

    const [deleted] = await tx
      .update(vehicleRentals)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(vehicleRentals.id, rentalId))
      .returning()

    await writeAuditLog(tx, {
      entityType: 'vehicle_rental',
      entityId: rentalId,
      action: 'delete',
      actor,
      reason,
      beforeData: existing,
    })

    return deleted
  })
}
