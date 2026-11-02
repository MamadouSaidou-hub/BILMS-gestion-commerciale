import { desc, eq } from 'drizzle-orm'
import { db } from '../client'
import { vehicleExpenses, vehicleRentals, vehicles } from '../schema'
import { formatFcfa } from '@/lib/format'
import { daysUntil } from '@/lib/dates'

export async function getVehiclesOverview() {
  const vehicleRows = await db.select().from(vehicles).orderBy(vehicles.name)
  const rentalRows = await db.select().from(vehicleRentals).orderBy(desc(vehicleRentals.createdAt))
  const expenseRows = await db.select().from(vehicleExpenses).orderBy(desc(vehicleExpenses.date))

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

  const totalCollected = rentals.reduce((sum, rental) => sum + rental.amountPaid, 0)
  const totalExpenses = expenseRows.reduce((sum, row) => sum + row.amount, 0)

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
    expenses: expenseRows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicleId,
      vehicleName: row.vehicleId ? (vehicleRows.find((v) => v.id === row.vehicleId)?.name ?? '—') : 'Dépense générale',
      date: row.date,
      category: row.category,
      amountFormatted: formatFcfa(row.amount),
      notes: row.notes,
    })),
    // Cumulative totals, not period-filtered — amountPaid on a rental has no per-payment date to
    // slice by month, so a "this month" figure here would be misleading rather than useful.
    summary: {
      totalCollected,
      totalCollectedFormatted: formatFcfa(totalCollected),
      totalExpenses,
      totalExpensesFormatted: formatFcfa(totalExpenses),
      net: totalCollected - totalExpenses,
      netFormatted: formatFcfa(totalCollected - totalExpenses),
      availableCount: vehicleRows.filter((v) => v.status === 'available').length,
      rentedCount: vehicleRows.filter((v) => v.status === 'rented').length,
      maintenanceCount: vehicleRows.filter((v) => v.status === 'maintenance').length,
      activeRentalsCount: rentals.filter((r) => r.status === 'active').length,
    },
  }
}

export async function getVehicleOptions() {
  return db
    .select({ id: vehicles.id, name: vehicles.name, plate: vehicles.plate, status: vehicles.status })
    .from(vehicles)
    .where(eq(vehicles.status, 'available'))
    .orderBy(vehicles.name)
}

// Unlike getVehicleOptions (available only, for booking a new rental), an expense can be logged
// against a vehicle regardless of its current status — including one that's currently rented out.
export async function getAllVehicleOptions() {
  return db.select({ id: vehicles.id, name: vehicles.name, plate: vehicles.plate }).from(vehicles).orderBy(vehicles.name)
}

export async function getRentalDetail(rentalId: number) {
  const [rental] = await db.select().from(vehicleRentals).where(eq(vehicleRentals.id, rentalId))
  if (!rental) return null
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, rental.vehicleId))

  const days = Math.max(1, Math.round((new Date(rental.plannedEndDate).getTime() - new Date(rental.startDate).getTime()) / (24 * 60 * 60 * 1000)))

  return {
    id: rental.id,
    reference: `LOC-${String(rental.id).padStart(4, '0')}`,
    vehicleName: vehicle?.name ?? '—',
    vehiclePlate: vehicle?.plate ?? '—',
    clientName: rental.clientName,
    clientPhone: rental.clientPhone,
    startDate: rental.startDate,
    plannedEndDate: rental.plannedEndDate,
    days,
    dailyRate: rental.dailyRate,
    dailyRateFormatted: formatFcfa(rental.dailyRate),
    totalAmount: rental.totalAmount,
    totalAmountFormatted: formatFcfa(rental.totalAmount),
    amountPaid: rental.amountPaid,
    amountPaidFormatted: formatFcfa(rental.amountPaid),
    paymentStatus: rental.paymentStatus,
  }
}
