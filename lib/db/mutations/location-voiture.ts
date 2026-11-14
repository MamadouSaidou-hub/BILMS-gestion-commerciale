import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../client'
import { rentalCharges, rentalClients, vehicleExpenses, vehicleRentals, vehicles } from '../schema'
import { addDays } from '@/lib/dates'
import { writeAuditLog, type Actor } from './audit'

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
    const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicleId))
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

export async function renewRental(rentalId: number, additionalDays: number) {
  if (additionalDays <= 0) {
    throw new Error('Le nombre de jours doit être supérieur à zéro.')
  }

  const [rental] = await db.select().from(vehicleRentals).where(and(eq(vehicleRentals.id, rentalId), isNull(vehicleRentals.deletedAt)))
  if (!rental) {
    throw new Error('Location introuvable.')
  }
  if (rental.status !== 'active') {
    throw new Error('Seule une location active peut être renouvelée.')
  }

  // Extending the contract adds to what's owed, so a rental already marked "paid" can genuinely
  // become "partial" again — recompute from the new total rather than leaving the old status.
  const totalAmount = rental.totalAmount + rental.dailyRate * additionalDays
  const paymentStatus = rental.amountPaid >= totalAmount ? 'paid' : rental.amountPaid > 0 ? 'partial' : 'unpaid'

  const [updated] = await db
    .update(vehicleRentals)
    .set({ plannedEndDate: addDays(rental.plannedEndDate, additionalDays), totalAmount, paymentStatus })
    .where(eq(vehicleRentals.id, rentalId))
    .returning()
  return updated
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

export async function addRentalCharge(rentalId: number, input: { description: string; unit?: string | null; quantity: number; unitPrice: number }) {
  if (input.quantity <= 0 || input.unitPrice <= 0) {
    throw new Error('Quantité et prix unitaire doivent être supérieurs à zéro.')
  }
  const [rental] = await db.select().from(vehicleRentals).where(and(eq(vehicleRentals.id, rentalId), isNull(vehicleRentals.deletedAt)))
  if (!rental) {
    throw new Error('Location introuvable.')
  }
  const [charge] = await db
    .insert(rentalCharges)
    .values({
      rentalId,
      description: input.description,
      unit: input.unit ?? null,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
    })
    .returning()
  return charge
}

export async function removeRentalCharge(chargeId: number) {
  await db.delete(rentalCharges).where(eq(rentalCharges.id, chargeId))
}

export async function recordRentalPayment(rentalId: number, amount: number) {
  if (amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }

  const [rental] = await db.select().from(vehicleRentals).where(and(eq(vehicleRentals.id, rentalId), isNull(vehicleRentals.deletedAt)))
  if (!rental) {
    throw new Error('Location introuvable.')
  }

  const amountPaid = rental.amountPaid + amount
  const paymentStatus = amountPaid >= rental.totalAmount ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'

  const [updated] = await db
    .update(vehicleRentals)
    .set({ amountPaid, paymentStatus })
    .where(eq(vehicleRentals.id, rentalId))
    .returning()
  return updated
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
    const paymentStatus = existing.amountPaid >= totalAmount ? 'paid' : existing.amountPaid > 0 ? 'partial' : 'unpaid'

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
