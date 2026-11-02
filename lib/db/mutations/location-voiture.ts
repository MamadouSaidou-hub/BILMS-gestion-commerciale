import { eq } from 'drizzle-orm'
import { db } from '../client'
import { vehicleExpenses, vehicleRentals, vehicles } from '../schema'
import { addDays } from '@/lib/dates'

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
  clientName: string
  clientPhone?: string | null
  startDate: string
  days: number
}) {
  if (input.days <= 0) {
    throw new Error('La durée de location doit être supérieure à zéro.')
  }

  return db.transaction(async (tx) => {
    const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicleId))
    if (!vehicle) {
      throw new Error('Véhicule introuvable.')
    }
    if (vehicle.status !== 'available') {
      throw new Error('Ce véhicule n’est pas disponible.')
    }

    const totalAmount = vehicle.dailyRate * input.days
    const [rental] = await tx
      .insert(vehicleRentals)
      .values({
        vehicleId: input.vehicleId,
        clientName: input.clientName,
        clientPhone: input.clientPhone ?? null,
        startDate: input.startDate,
        plannedEndDate: addDays(input.startDate, input.days),
        dailyRate: vehicle.dailyRate,
        totalAmount,
      })
      .returning()

    await tx.update(vehicles).set({ status: 'rented' }).where(eq(vehicles.id, input.vehicleId))

    return rental
  })
}

export async function closeRental(rentalId: number, input: { endDate: string }) {
  return db.transaction(async (tx) => {
    const [rental] = await tx.select().from(vehicleRentals).where(eq(vehicleRentals.id, rentalId))
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

  const [rental] = await db.select().from(vehicleRentals).where(eq(vehicleRentals.id, rentalId))
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

export async function recordRentalPayment(rentalId: number, amount: number) {
  if (amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }

  const [rental] = await db.select().from(vehicleRentals).where(eq(vehicleRentals.id, rentalId))
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
