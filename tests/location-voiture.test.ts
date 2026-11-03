import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { rentalClients, vehicleExpenses, vehicleRentals, vehicles } from '@/lib/db/schema'
import { createRental, closeRental, createRentalClient, createVehicle, recordRentalPayment, recordVehicleExpense, renewRental } from '@/lib/db/mutations/location-voiture'
import { getRentalClientDetail } from '@/lib/db/queries/location-voiture'

const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const vehicleIds: number[] = []
const rentalIds: number[] = []
const expenseIds: number[] = []
const explicitClientIds: number[] = []

async function makeVehicle(suffix: string, dailyRate = 10000) {
  const vehicle = await createVehicle({ name: `Véhicule ${suffix} ${runId}`, plate: `TEST-${suffix}-${runId}`, dailyRate })
  vehicleIds.push(vehicle.id)
  return vehicle
}

afterAll(async () => {
  for (const id of expenseIds) {
    await db.delete(vehicleExpenses).where(eq(vehicleExpenses.id, id))
  }
  // Every createRental() call auto-creates a rental client (unless an existing clientId was
  // passed) — collect them before the rentals are gone, so none are left orphaned in the real
  // rental_clients table.
  const rentalClientIds = new Set(explicitClientIds)
  for (const id of rentalIds) {
    const [rental] = await db.select({ clientId: vehicleRentals.clientId }).from(vehicleRentals).where(eq(vehicleRentals.id, id))
    if (rental) rentalClientIds.add(rental.clientId)
    await db.delete(vehicleRentals).where(eq(vehicleRentals.id, id))
  }
  for (const id of vehicleIds) {
    await db.delete(vehicles).where(eq(vehicles.id, id))
  }
  for (const id of rentalClientIds) {
    await db.delete(rentalClients).where(eq(rentalClients.id, id))
  }
})

describe('recordVehicleExpense', () => {
  it('records an expense linked to a vehicle', async () => {
    const vehicle = await makeVehicle('G')
    const expense = await recordVehicleExpense({ vehicleId: vehicle.id, date: '2026-11-01', category: 'Entretien', amount: 25000 })
    expenseIds.push(expense.id)
    expect(expense.vehicleId).toBe(vehicle.id)
    expect(expense.amount).toBe(25000)
  })

  it('records a general expense with no vehicle link', async () => {
    const expense = await recordVehicleExpense({ date: '2026-11-01', category: 'Assurance flotte', amount: 100000 })
    expenseIds.push(expense.id)
    expect(expense.vehicleId).toBeNull()
  })

  it('rejects a non-positive amount', async () => {
    await expect(recordVehicleExpense({ date: '2026-11-01', category: 'Test', amount: 0 })).rejects.toThrow(/supérieur à zéro/i)
  })
})

describe('createRental', () => {
  it('computes the total from the vehicle rate and marks the vehicle rented', async () => {
    const vehicle = await makeVehicle('A')
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Test', startDate: '2026-11-01', days: 3 })
    rentalIds.push(rental.id)

    expect(rental.totalAmount).toBe(30000)
    expect(rental.paymentStatus).toBe('unpaid')

    const [updated] = await db.select().from(vehicles).where(eq(vehicles.id, vehicle.id))
    expect(updated.status).toBe('rented')
  })

  it('rejects a rental for a vehicle that is already rented', async () => {
    const vehicle = await makeVehicle('B')
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Premier client', startDate: '2026-11-01', days: 1 })
    rentalIds.push(rental.id)

    await expect(createRental({ vehicleId: vehicle.id, clientName: 'Deuxième client', startDate: '2026-11-01', days: 1 })).rejects.toThrow(/disponible/i)
  })
})

describe('recordRentalPayment', () => {
  it('moves payment status from unpaid to partial to paid', async () => {
    const vehicle = await makeVehicle('C')
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Paiement', startDate: '2026-11-01', days: 2 })
    rentalIds.push(rental.id)

    const afterPartial = await recordRentalPayment(rental.id, 10000)
    expect(afterPartial.paymentStatus).toBe('partial')

    const afterFull = await recordRentalPayment(rental.id, 10000)
    expect(afterFull.paymentStatus).toBe('paid')
  })
})

describe('renewRental', () => {
  it('pushes the planned end date back and adds to the total', async () => {
    const vehicle = await makeVehicle('E', 10000)
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Renouvellement', startDate: '2026-11-01', days: 2 })
    rentalIds.push(rental.id)
    expect(rental.plannedEndDate).toBe('2026-11-03')
    expect(rental.totalAmount).toBe(20000)

    const renewed = await renewRental(rental.id, 3)
    expect(renewed.plannedEndDate).toBe('2026-11-06')
    expect(renewed.totalAmount).toBe(50000)
  })

  it('reverts a "paid" rental back to "partial" once the extension adds unpaid balance', async () => {
    const vehicle = await makeVehicle('F', 10000)
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Paid Renew', startDate: '2026-11-01', days: 1 })
    rentalIds.push(rental.id)
    await recordRentalPayment(rental.id, 10000)

    const renewed = await renewRental(rental.id, 2)
    expect(renewed.paymentStatus).toBe('partial')
  })
})

describe('createRental with a rental client dossier', () => {
  it('creates a new rental client when given a name, and links the rental to it', async () => {
    const vehicle = await makeVehicle('K')
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Nouveau Client', clientPhone: '622222222', startDate: '2026-11-01', days: 1 })
    rentalIds.push(rental.id)

    const [client] = await db.select().from(rentalClients).where(eq(rentalClients.id, rental.clientId))
    expect(client.name).toBe('Nouveau Client')
    expect(client.phone).toBe('622222222')
  })

  it('reuses an existing rental client (no duplicate created) and links every rental into one history', async () => {
    const client = await createRentalClient({ name: 'Client Récurrent', phone: '633333333' })
    explicitClientIds.push(client.id)

    const vehicleA = await makeVehicle('L1')
    const rentalA = await createRental({ vehicleId: vehicleA.id, clientId: client.id, startDate: '2026-11-01', days: 1 })
    rentalIds.push(rentalA.id)
    expect(rentalA.clientName).toBe('Client Récurrent')
    await closeRental(rentalA.id, { endDate: '2026-11-02' })

    const vehicleB = await makeVehicle('L2')
    const rentalB = await createRental({ vehicleId: vehicleB.id, clientId: client.id, startDate: '2026-12-01', days: 1 })
    rentalIds.push(rentalB.id)

    const clientRows = await db.select().from(rentalClients).where(eq(rentalClients.id, client.id))
    expect(clientRows).toHaveLength(1)

    const detail = await getRentalClientDetail(client.id)
    expect(detail?.rentals.map((r) => r.id).sort()).toEqual([rentalA.id, rentalB.id].sort())
  })

  it('rejects a rental with neither clientId nor clientName', async () => {
    const vehicle = await makeVehicle('M')
    await expect(createRental({ vehicleId: vehicle.id, startDate: '2026-11-01', days: 1 })).rejects.toThrow(/nom du client/i)
  })
})

describe('closeRental', () => {
  it('marks the rental completed and frees the vehicle', async () => {
    const vehicle = await makeVehicle('D', 5000)
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Clôture', startDate: '2026-11-01', days: 1 })
    rentalIds.push(rental.id)

    const closed = await closeRental(rental.id, { endDate: '2026-11-02' })
    expect(closed.status).toBe('completed')

    const [updatedVehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicle.id))
    expect(updatedVehicle.status).toBe('available')
  })
})
