import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { vehicleRentals, vehicles } from '@/lib/db/schema'
import { createRental, closeRental, createVehicle, recordRentalPayment } from '@/lib/db/mutations/location-voiture'

const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const vehicleIds: number[] = []
const rentalIds: number[] = []

async function makeVehicle(suffix: string, dailyRate = 10000) {
  const vehicle = await createVehicle({ name: `Véhicule ${suffix} ${runId}`, plate: `TEST-${suffix}-${runId}`, dailyRate })
  vehicleIds.push(vehicle.id)
  return vehicle
}

afterAll(async () => {
  for (const id of rentalIds) {
    await db.delete(vehicleRentals).where(eq(vehicleRentals.id, id))
  }
  for (const id of vehicleIds) {
    await db.delete(vehicles).where(eq(vehicles.id, id))
  }
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
