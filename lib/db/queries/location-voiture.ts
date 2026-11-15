import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../client'
import { rentalCharges, rentalClients, rentalPayments, vehicleExpenses, vehicleRentals, vehicles } from '../schema'
import { formatFcfa } from '@/lib/format'
import { daysUntil } from '@/lib/dates'
import { periodRange, type CustomRange, type PeriodKey } from '@/lib/period'

export async function getVehiclesOverview() {
  const vehicleRows = await db.select().from(vehicles).orderBy(vehicles.name)
  const rentalRows = await db.select().from(vehicleRentals).where(isNull(vehicleRentals.deletedAt)).orderBy(desc(vehicleRentals.createdAt))
  const expenseRows = await db.select().from(vehicleExpenses).where(isNull(vehicleExpenses.deletedAt)).orderBy(desc(vehicleExpenses.date))

  const rentals = rentalRows.map((rental) => ({
    id: rental.id,
    vehicleId: rental.vehicleId,
    vehicleName: vehicleRows.find((v) => v.id === rental.vehicleId)?.name ?? '—',
    clientId: rental.clientId,
    clientName: rental.clientName,
    clientPhone: rental.clientPhone,
    startDate: rental.startDate,
    plannedEndDate: rental.plannedEndDate,
    endDate: rental.endDate,
    daysRemaining: rental.status === 'active' ? daysUntil(rental.plannedEndDate) : null,
    days: Math.max(1, Math.round((new Date(rental.plannedEndDate).getTime() - new Date(rental.startDate).getTime()) / (24 * 60 * 60 * 1000))),
    dailyRate: rental.dailyRate,
    dailyRateFormatted: formatFcfa(rental.dailyRate),
    totalAmount: rental.totalAmount,
    totalAmountFormatted: formatFcfa(rental.totalAmount),
    amountPaid: rental.amountPaid,
    amountPaidFormatted: formatFcfa(rental.amountPaid),
    paymentStatus: rental.paymentStatus,
    status: rental.status,
    notes: rental.notes,
    departureCity: rental.departureCity,
    destinationCity: rental.destinationCity,
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
      amount: row.amount,
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

// Active rentals due back within a week — same threshold/shape as getVehiclesOverview's
// upcomingDeadlines, but standalone (rentals + vehicles only) so the global notification bell can
// pull this signal without paying for the full overview's expenses query.
export async function getVehicleDueBackAlerts() {
  const rentalRows = await db.select().from(vehicleRentals).where(and(eq(vehicleRentals.status, 'active'), isNull(vehicleRentals.deletedAt)))
  const vehicleRows = await db.select().from(vehicles)

  return rentalRows
    .map((rental) => ({
      rentalId: rental.id,
      vehicleName: vehicleRows.find((v) => v.id === rental.vehicleId)?.name ?? '—',
      clientName: rental.clientName,
      plannedEndDate: rental.plannedEndDate,
      daysRemaining: daysUntil(rental.plannedEndDate),
    }))
    .filter((row) => row.daysRemaining <= 7)
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

export async function getRentalClientsOverview() {
  const clientRows = await db.select().from(rentalClients).orderBy(rentalClients.name)
  const rentalRows = await db.select().from(vehicleRentals).where(isNull(vehicleRentals.deletedAt))

  const result = clientRows.map((client) => {
    const clientRentals = rentalRows.filter((rental) => rental.clientId === client.id)
    const totalPaid = clientRentals.reduce((sum, rental) => sum + rental.amountPaid, 0)
    return {
      id: client.id,
      name: client.name,
      phone: client.phone ?? '—',
      rentalsCount: clientRentals.length,
      hasActiveRental: clientRentals.some((rental) => rental.status === 'active'),
      totalPaid,
      totalPaidFormatted: formatFcfa(totalPaid),
    }
  })

  return { clients: result }
}

export async function getRentalClientDetail(clientId: number) {
  const [client] = await db.select().from(rentalClients).where(eq(rentalClients.id, clientId))
  if (!client) return null

  const rentalRows = await db
    .select()
    .from(vehicleRentals)
    .where(and(eq(vehicleRentals.clientId, clientId), isNull(vehicleRentals.deletedAt)))
    .orderBy(desc(vehicleRentals.createdAt))
  const vehicleRows = await db.select().from(vehicles)

  const rentalHistory = rentalRows.map((rental) => ({
    id: rental.id,
    vehicleName: vehicleRows.find((v) => v.id === rental.vehicleId)?.name ?? '—',
    startDate: rental.startDate,
    plannedEndDate: rental.plannedEndDate,
    endDate: rental.endDate,
    status: rental.status,
    totalAmountFormatted: formatFcfa(rental.totalAmount),
    amountPaidFormatted: formatFcfa(rental.amountPaid),
    paymentStatus: rental.paymentStatus,
  }))

  return {
    id: client.id,
    name: client.name,
    phone: client.phone ?? '—',
    rentals: rentalHistory,
  }
}

export async function getLocationReportsOverview(period: PeriodKey, custom?: CustomRange) {
  const { start, end } = periodRange(period, custom)
  // Only a custom range gets an upper bound — the named periods stay open-ended so a rental or
  // expense dated slightly ahead still shows up rather than silently vanishing.
  const withinPeriod = (value: string) => {
    const date = new Date(value)
    return date >= start && (period !== 'custom' || date <= end)
  }

  const vehicleRows = await db.select().from(vehicles).orderBy(vehicles.name)
  const rentalRows = await db.select().from(vehicleRentals).where(isNull(vehicleRentals.deletedAt))
  const expenseRows = await db.select().from(vehicleExpenses).where(isNull(vehicleExpenses.deletedAt))
  const clientRows = await db.select().from(rentalClients).orderBy(rentalClients.name)

  // Keyed on the rental's own start date (the day the vehicle actually went out), falling back to
  // createdAt for older rows — a rental entered after the fact belongs to the period it ran in,
  // not the day it was typed in. Still labeled in the UI as "réservées sur la période," never as
  // "encaissées," since no per-payment date history exists on a rental (see getVehiclesOverview).
  const periodRentals = rentalRows.filter((rental) => withinPeriod(rental.startDate ?? rental.createdAt))
  const totalBooked = periodRentals.reduce((sum, rental) => sum + rental.totalAmount, 0)
  const totalCollectedInPeriod = periodRentals.reduce((sum, rental) => sum + rental.amountPaid, 0)

  const periodExpenses = expenseRows.filter((expense) => withinPeriod(expense.date))
  const totalExpenses = periodExpenses.reduce((sum, expense) => sum + expense.amount, 0)

  const expensesByCategoryMap = new Map<string, number>()
  for (const expense of periodExpenses) {
    expensesByCategoryMap.set(expense.category, (expensesByCategoryMap.get(expense.category) ?? 0) + expense.amount)
  }
  const expensesByCategory = Array.from(expensesByCategoryMap.entries())
    .map(([category, amount]) => ({ category, amount, amountFormatted: formatFcfa(amount) }))
    .sort((a, b) => b.amount - a.amount)

  const rentedCount = vehicleRows.filter((vehicle) => vehicle.status === 'rented').length

  // Cumulative, not period-filtered — a client's value is read over their whole history, not one period.
  const topClients = clientRows
    .map((client) => {
      const totalPaid = rentalRows.filter((rental) => rental.clientId === client.id).reduce((sum, rental) => sum + rental.amountPaid, 0)
      return { id: client.id, name: client.name, totalPaid, totalPaidFormatted: formatFcfa(totalPaid) }
    })
    .filter((client) => client.totalPaid > 0)
    .sort((a, b) => b.totalPaid - a.totalPaid)
    .slice(0, 5)

  return {
    totalBooked,
    totalBookedFormatted: formatFcfa(totalBooked),
    totalCollectedInPeriod,
    totalCollectedInPeriodFormatted: formatFcfa(totalCollectedInPeriod),
    totalExpenses,
    totalExpensesFormatted: formatFcfa(totalExpenses),
    net: totalCollectedInPeriod - totalExpenses,
    netFormatted: formatFcfa(totalCollectedInPeriod - totalExpenses),
    fleetUtilizationRate: vehicleRows.length > 0 ? Math.round((rentedCount / vehicleRows.length) * 100) : 0,
    expensesByCategory,
    topClients,
  }
}

export async function getRentalDetail(rentalId: number) {
  const [rental] = await db.select().from(vehicleRentals).where(and(eq(vehicleRentals.id, rentalId), isNull(vehicleRentals.deletedAt)))
  if (!rental) return null
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, rental.vehicleId))
  const chargeRows = await db.select().from(rentalCharges).where(eq(rentalCharges.rentalId, rentalId)).orderBy(rentalCharges.id)
  const paymentRows = await db
    .select()
    .from(rentalPayments)
    .where(and(eq(rentalPayments.rentalId, rentalId), isNull(rentalPayments.deletedAt)))
    .orderBy(rentalPayments.id)

  const days = Math.max(1, Math.round((new Date(rental.plannedEndDate).getTime() - new Date(rental.startDate).getTime()) / (24 * 60 * 60 * 1000)))

  const charges = chargeRows.map((charge) => ({
    id: charge.id,
    description: charge.description,
    unit: charge.unit,
    quantity: charge.quantity,
    unitPrice: charge.unitPrice,
    total: charge.quantity * charge.unitPrice,
    totalFormatted: formatFcfa(charge.quantity * charge.unitPrice),
  }))
  const chargesTotal = charges.reduce((sum, charge) => sum + charge.total, 0)
  const grandTotal = rental.totalAmount + chargesTotal

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
    departureCity: rental.departureCity,
    destinationCity: rental.destinationCity,
    charges,
    payments: paymentRows.map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      amountFormatted: formatFcfa(payment.amount),
      date: payment.date,
      effectiveDate: payment.date ?? payment.createdAt,
    })),
    grandTotal,
    grandTotalFormatted: formatFcfa(grandTotal),
    amountPaid: rental.amountPaid,
    amountPaidFormatted: formatFcfa(rental.amountPaid),
    paymentStatus: rental.paymentStatus,
  }
}
