import { desc, eq } from 'drizzle-orm'
import { db } from '../client'
import { vehicleRentals, vehicles } from '../schema'
import { formatFcfa } from '@/lib/format'
import { daysUntil } from '@/lib/dates'

export async function getVehiclesOverview() {
  const vehicleRows = await db.select().from(vehicles).orderBy(vehicles.name)
  const rentalRows = await db.select().from(vehicleRentals).orderBy(desc(vehicleRentals.createdAt))

  const rentals = rentalRows.map((rental) => ({
    id: rental.id,
    vehicleId: rental.vehicleId,
    vehicleName: vehicleRows.find((v) => v.id === rental.vehicleId)?.name ?? '—',
    clientName: rental.clientName,
    clientPhone: rental.clientPhone,
    startDate: rental.startDate,
    plannedEndDate: rental.plannedEndDate,
    endDate: rental.endDate,
    daysRemaining: rental.status === 'active' ? daysUntil(rental.plannedEndDate) : null,
    totalAmount: rental.totalAmount,
    totalAmountFormatted: formatFcfa(rental.totalAmount),
    amountPaid: rental.amountPaid,
    amountPaidFormatted: formatFcfa(rental.amountPaid),
    paymentStatus: rental.paymentStatus,
    status: rental.status,
  }))

  return {
    vehicles: vehicleRows.map((vehicle) => ({
      id: vehicle.id,
      name: vehicle.name,
      plate: vehicle.plate,
      dailyRate: vehicle.dailyRate,
      dailyRateFormatted: formatFcfa(vehicle.dailyRate),
      status: vehicle.status,
      notes: vehicle.notes,
    })),
    rentals,
    // Active rentals due back within a week — the whole point of tracking plannedEndDate is to
    // surface these before the vehicle is overdue, not just record dates nobody looks at.
    upcomingDeadlines: rentals.filter((rental) => rental.status === 'active' && rental.daysRemaining !== null && rental.daysRemaining <= 7),
  }
}

export async function getVehicleOptions() {
  return db
    .select({ id: vehicles.id, name: vehicles.name, plate: vehicles.plate, status: vehicles.status })
    .from(vehicles)
    .where(eq(vehicles.status, 'available'))
    .orderBy(vehicles.name)
}
