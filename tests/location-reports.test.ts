import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { rentalClients, vehicleExpenses, vehicleRentals, vehicles } from '@/lib/db/schema'
import { createRental, createVehicle, recordRentalPayment } from '@/lib/db/mutations/location-voiture'
import { getLocationReportsOverview } from '@/lib/db/queries/location-voiture'

const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

const vehicleIds: number[] = []
const rentalIds: number[] = []
const expenseIds: number[] = []
const explicitClientIds: number[] = []

afterAll(async () => {
  for (const id of expenseIds) {
    await db.delete(vehicleExpenses).where(eq(vehicleExpenses.id, id))
  }
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

describe('getLocationReportsOverview', () => {
  it('includes a rental booked "today" in the today/7d/month periods, and sums its expense category', async () => {
    const vehicle = await createVehicle({ name: `Véhicule Rapport ${runId}`, plate: `RPT-${runId}`, dailyRate: 10000 })
    vehicleIds.push(vehicle.id)
    // A sky-high rate guarantees this rental's client ranks in the top 5 regardless of real data.
    const rental = await createRental({ vehicleId: vehicle.id, clientName: `Client Rapport ${runId}`, startDate: new Date().toISOString().slice(0, 10), days: 1 })
    rentalIds.push(rental.id)
    await recordRentalPayment(rental.id, 99999999)

    const expense = await db
      .insert(vehicleExpenses)
      .values({ vehicleId: vehicle.id, date: new Date().toISOString().slice(0, 10), category: `Carburant ${runId}`, amount: 150000 })
      .returning()
    expenseIds.push(expense[0].id)

    for (const period of ['today', '7d', 'month'] as const) {
      const report = await getLocationReportsOverview(period)
      expect(report.totalBooked).toBeGreaterThanOrEqual(10000)
      expect(report.totalCollectedInPeriod).toBeGreaterThanOrEqual(99999999)

      const category = report.expensesByCategory.find((row) => row.category === `Carburant ${runId}`)
      expect(category?.amount).toBe(150000)

      const topClient = report.topClients.find((row) => row.name === `Client Rapport ${runId}`)
      expect(topClient?.totalPaid).toBeGreaterThanOrEqual(99999999)
    }
  })

  it('excludes expenses dated before the selected period', async () => {
    const vehicle = await createVehicle({ name: `Véhicule Ancien ${runId}`, plate: `OLD-${runId}`, dailyRate: 5000 })
    vehicleIds.push(vehicle.id)

    const expense = await db
      .insert(vehicleExpenses)
      .values({ vehicleId: vehicle.id, date: '2020-01-01', category: `Ancien ${runId}`, amount: 10000 })
      .returning()
    expenseIds.push(expense[0].id)

    const report = await getLocationReportsOverview('today')
    const category = report.expensesByCategory.find((row) => row.category === `Ancien ${runId}`)
    expect(category).toBeUndefined()
  })
})
