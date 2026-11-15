import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { auditLog, rentalCharges, rentalClients, rentalPayments, rentalRenewals, vehicleExpenses, vehicleRentals, vehicles } from '@/lib/db/schema'
import {
  addRentalCharge,
  createRental,
  closeRental,
  createRentalClient,
  createVehicle,
  deleteRental,
  deleteRentalPayment,
  deleteVehicleExpense,
  recordRentalPayment,
  updateRentalPayment,
  recordVehicleExpense,
  removeRentalCharge,
  renewRental,
  updateRental,
  updateVehicleExpense,
} from '@/lib/db/mutations/location-voiture'
import { getRentalClientDetail, getRentalDetail, getVehiclesOverview } from '@/lib/db/queries/location-voiture'

const actor = { userId: 'u1', userName: 'Admin Test' }

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
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'vehicle_expense'), eq(auditLog.entityId, id)))
    await db.delete(vehicleExpenses).where(eq(vehicleExpenses.id, id))
  }
  // Every createRental() call auto-creates a rental client (unless an existing clientId was
  // passed) — collect them before the rentals are gone, so none are left orphaned in the real
  // rental_clients table.
  const rentalClientIds = new Set(explicitClientIds)
  for (const id of rentalIds) {
    const [rental] = await db.select({ clientId: vehicleRentals.clientId }).from(vehicleRentals).where(eq(vehicleRentals.id, id))
    if (rental) rentalClientIds.add(rental.clientId)
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'vehicle_rental'), eq(auditLog.entityId, id)))
    await db.delete(rentalCharges).where(eq(rentalCharges.rentalId, id))
    // recordRentalPayment now writes a dated payment row per payment — clean those up too, and
    // their audit entries, before the rental they hang off disappears.
    const paymentRows = await db.select({ id: rentalPayments.id }).from(rentalPayments).where(eq(rentalPayments.rentalId, id))
    for (const payment of paymentRows) {
      await db.delete(auditLog).where(and(eq(auditLog.entityType, 'rental_payment'), eq(auditLog.entityId, payment.id)))
    }
    await db.delete(rentalPayments).where(eq(rentalPayments.rentalId, id))
    // renewRental now records each extension as a dated row — clean those up too.
    await db.delete(rentalRenewals).where(eq(rentalRenewals.rentalId, id))
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

describe('updateVehicleExpense', () => {
  it('updates the amount/category and writes an audit entry', async () => {
    const expense = await recordVehicleExpense({ date: '2026-11-01', category: 'Entretien', amount: 25000 })
    expenseIds.push(expense.id)

    const updated = await updateVehicleExpense(expense.id, { amount: 30000, category: 'Entretien majeur' }, actor, 'Facture corrigée')
    expect(updated.amount).toBe(30000)
    expect(updated.category).toBe('Entretien majeur')

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'vehicle_expense'), eq(auditLog.entityId, expense.id)))
    expect(log.action).toBe('update')
    expect(log.reason).toBe('Facture corrigée')
  })
})

describe('deleteVehicleExpense', () => {
  it('soft-deletes the expense and writes an audit entry', async () => {
    const expense = await recordVehicleExpense({ date: '2026-11-01', category: 'Assurance', amount: 100000 })
    expenseIds.push(expense.id)

    await deleteVehicleExpense(expense.id, actor, 'Doublon')

    const [row] = await db.select().from(vehicleExpenses).where(eq(vehicleExpenses.id, expense.id))
    expect(row.deletedAt).not.toBeNull()

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'vehicle_expense'), eq(auditLog.entityId, expense.id)))
    expect(log.action).toBe('delete')
    expect(log.reason).toBe('Doublon')
  })

  it('rejects deleting an expense twice', async () => {
    const expense = await recordVehicleExpense({ date: '2026-11-01', category: 'Test', amount: 1000 })
    expenseIds.push(expense.id)

    await deleteVehicleExpense(expense.id, actor)
    await expect(deleteVehicleExpense(expense.id, actor)).rejects.toThrow(/introuvable/i)
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

  it('uses a per-booking rate override instead of the vehicle rate when provided', async () => {
    const vehicle = await makeVehicle('H', 10000)
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Trajet', startDate: '2026-11-01', days: 2, dailyRateOverride: 25000 })
    rentalIds.push(rental.id)

    expect(rental.dailyRate).toBe(25000)
    expect(rental.totalAmount).toBe(50000)

    const [unchangedVehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicle.id))
    expect(unchangedVehicle.dailyRate).toBe(10000)
  })

  it('falls back to the vehicle rate when no override is given', async () => {
    const vehicle = await makeVehicle('I', 10000)
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Standard', startDate: '2026-11-01', days: 1 })
    rentalIds.push(rental.id)
    expect(rental.dailyRate).toBe(10000)
  })

  it('stores an optional departure/destination trip record', async () => {
    const vehicle = await makeVehicle('Q')
    const rental = await createRental({
      vehicleId: vehicle.id,
      clientName: 'Client Trajet Ville',
      startDate: '2026-11-01',
      days: 1,
      departureCity: 'Conakry',
      destinationCity: 'Kindia',
    })
    rentalIds.push(rental.id)
    expect(rental.departureCity).toBe('Conakry')
    expect(rental.destinationCity).toBe('Kindia')
  })

  it('inserts charge lines given at booking time, included in getRentalDetail.grandTotal', async () => {
    const vehicle = await makeVehicle('R', 10000)
    const rental = await createRental({
      vehicleId: vehicle.id,
      clientName: 'Client Frais Initiaux',
      startDate: '2026-11-01',
      days: 1,
      charges: [{ description: 'Carburant', unit: 'litres', quantity: 10, unitPrice: 12000 }],
    })
    rentalIds.push(rental.id)

    const detail = await getRentalDetail(rental.id)
    expect(detail?.charges).toHaveLength(1)
    expect(detail?.grandTotal).toBe(10000 + 10 * 12000)
  })

  it('rejects an invalid charge line given at booking time', async () => {
    const vehicle = await makeVehicle('S')
    await expect(
      createRental({
        vehicleId: vehicle.id,
        clientName: 'Client Frais Invalides',
        startDate: '2026-11-01',
        days: 1,
        charges: [{ description: 'Carburant', quantity: 0, unitPrice: 1000 }],
      }),
    ).rejects.toThrow(/supérieurs à zéro/i)
  })
})

describe('addRentalCharge / removeRentalCharge', () => {
  it('adds charge lines and reflects them in getRentalDetail.grandTotal', async () => {
    const vehicle = await makeVehicle('J', 10000)
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Frais', startDate: '2026-11-01', days: 1 })
    rentalIds.push(rental.id)

    await addRentalCharge(rental.id, { description: 'Carburant', unit: 'litres', quantity: 10, unitPrice: 12000 })
    const fuel = await addRentalCharge(rental.id, { description: 'Frais de route', quantity: 1, unitPrice: 5000 })

    const detail = await getRentalDetail(rental.id)
    expect(detail?.charges).toHaveLength(2)
    expect(detail?.grandTotal).toBe(10000 + 10 * 12000 + 5000)

    await removeRentalCharge(fuel.id)
    const afterRemoval = await getRentalDetail(rental.id)
    expect(afterRemoval?.charges).toHaveLength(1)
    expect(afterRemoval?.grandTotal).toBe(10000 + 10 * 12000)
  })

  it('rejects a non-positive quantity or unit price', async () => {
    const vehicle = await makeVehicle('K')
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Test Frais', startDate: '2026-11-01', days: 1 })
    rentalIds.push(rental.id)

    await expect(addRentalCharge(rental.id, { description: 'Carburant', quantity: 0, unitPrice: 1000 })).rejects.toThrow(/supérieurs à zéro/i)
    await expect(addRentalCharge(rental.id, { description: 'Carburant', quantity: 1, unitPrice: 0 })).rejects.toThrow(/supérieurs à zéro/i)
  })

  it('keeps the rental "partial" (not "paid") when the base rental is covered but an unpaid charge remains', async () => {
    const vehicle = await makeVehicle('T', 10000)
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Frais Impayés', startDate: '2026-11-01', days: 1 })
    rentalIds.push(rental.id)

    await addRentalCharge(rental.id, { description: 'Carburant', quantity: 1, unitPrice: 20000 })
    const paid = await recordRentalPayment(rental.id, 10000) // exactly covers the base rental, nothing on the charge
    expect(paid.paymentStatus).toBe('partial')

    const fullyPaid = await recordRentalPayment(rental.id, 20000)
    expect(fullyPaid.paymentStatus).toBe('paid')
  })

  it('reopens the rental to "partial" when a new unpaid charge is added to an already fully-paid rental', async () => {
    const vehicle = await makeVehicle('U', 10000)
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Frais Après Paiement', startDate: '2026-11-01', days: 1 })
    rentalIds.push(rental.id)

    const paid = await recordRentalPayment(rental.id, 10000)
    expect(paid.paymentStatus).toBe('paid')

    const afterCharge = await addRentalCharge(rental.id, { description: 'Carburant', quantity: 1, unitPrice: 5000 })
    const [rentalRow] = await db.select().from(vehicleRentals).where(eq(vehicleRentals.id, afterCharge.rentalId))
    expect(rentalRow.paymentStatus).toBe('partial')
  })
})

describe('renewRental records the extension as a dated operation', () => {
  it('keeps what each renewal added, and the date it was agreed on', async () => {
    const vehicle = await makeVehicle('Renew')
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Renouvellement', startDate: '2026-11-01', days: 2 })
    rentalIds.push(rental.id)

    await renewRental(rental.id, 3, { date: '2026-11-03' })

    const renewals = await db.select().from(rentalRenewals).where(eq(rentalRenewals.rentalId, rental.id))
    expect(renewals).toHaveLength(1)
    expect(renewals[0].additionalDays).toBe(3)
    expect(renewals[0].date).toBe('2026-11-03')
    // 3 extra days at the rental's own daily rate — the same amount added to the rental total.
    expect(renewals[0].addedAmount).toBe(rental.dailyRate * 3)

    const [rentalRow] = await db.select().from(vehicleRentals).where(eq(vehicleRentals.id, rental.id))
    expect(rentalRow.totalAmount).toBe(rental.totalAmount + rental.dailyRate * 3)
  })
})

describe('rental payment history', () => {
  it('records each payment as its own dated row, and keeps the rental total in sync', async () => {
    const vehicle = await makeVehicle('PayHist')
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Historique', startDate: '2026-11-01', days: 2 })
    rentalIds.push(rental.id)

    await recordRentalPayment(rental.id, 6000, { date: '2026-11-03' })
    await recordRentalPayment(rental.id, 4000, { date: '2026-11-07' })

    const detail = await getRentalDetail(rental.id)
    expect(detail!.payments).toHaveLength(2)
    expect(detail!.payments.map((p) => p.date)).toEqual(['2026-11-03', '2026-11-07'])
    expect(detail!.amountPaid).toBe(10000)
  })

  it('recomputes the rental total when a payment is corrected, and writes an audit entry', async () => {
    const vehicle = await makeVehicle('PayEdit')
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Correction', startDate: '2026-11-01', days: 2 })
    rentalIds.push(rental.id)

    await recordRentalPayment(rental.id, 10000, { date: '2026-11-02' })
    const detail = await getRentalDetail(rental.id)
    const paymentId = detail!.payments[0].id

    const updated = await updateRentalPayment(paymentId, { amount: 4000, date: '2026-11-05' }, actor, 'Montant corrigé')
    expect(updated.amount).toBe(4000)

    const [rentalRow] = await db.select().from(vehicleRentals).where(eq(vehicleRentals.id, rental.id))
    expect(rentalRow.amountPaid).toBe(4000)
    expect(rentalRow.paymentStatus).toBe('partial')

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'rental_payment'), eq(auditLog.entityId, paymentId)))
    expect(log.action).toBe('update')
    expect(log.reason).toBe('Montant corrigé')
  })

  it('removes a payment from the total and hides it from the history', async () => {
    const vehicle = await makeVehicle('PayDel')
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Suppression', startDate: '2026-11-01', days: 2 })
    rentalIds.push(rental.id)

    // 20 000 covers this rental in full (2 days × 10 000); the extra 3 000 is the mistake to undo,
    // so removing it must leave the rental fully paid rather than knocking it back to partial.
    await recordRentalPayment(rental.id, 20000, { date: '2026-11-02' })
    await recordRentalPayment(rental.id, 3000, { date: '2026-11-04' })
    const detail = await getRentalDetail(rental.id)
    expect(detail!.paymentStatus).toBe('paid')
    const toDelete = detail!.payments[1].id

    await deleteRentalPayment(toDelete, actor, 'Erreur de saisie')

    const after = await getRentalDetail(rental.id)
    expect(after!.payments).toHaveLength(1)
    expect(after!.amountPaid).toBe(20000)
    expect(after!.paymentStatus).toBe('paid')

    await expect(deleteRentalPayment(toDelete, actor)).rejects.toThrow(/introuvable/i)
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

describe('updateRental', () => {
  it('recomputes the total/payment status from new days and rate, and writes an audit entry', async () => {
    const vehicle = await makeVehicle('N', 10000)
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Correction', startDate: '2026-11-01', days: 2 })
    rentalIds.push(rental.id)
    await recordRentalPayment(rental.id, 20000) // fully paid at the original total (20,000)

    const updated = await updateRental(rental.id, { days: 4, dailyRateOverride: 10000 }, actor, 'Prolongation oubliée')
    expect(updated.totalAmount).toBe(40000)
    expect(updated.paymentStatus).toBe('partial') // 20,000 paid against a new 40,000 total
    expect(updated.plannedEndDate).toBe('2026-11-05')

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'vehicle_rental'), eq(auditLog.entityId, rental.id)))
    expect(log.action).toBe('update')
    expect(log.reason).toBe('Prolongation oubliée')
  })
})

describe('deleteRental', () => {
  it('frees an active vehicle, soft-deletes the rental, and hides it from getVehiclesOverview', async () => {
    const vehicle = await makeVehicle('O', 10000)
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Suppression', startDate: '2026-11-01', days: 1 })
    rentalIds.push(rental.id)

    await deleteRental(rental.id, actor, 'Double saisie')

    const [updatedVehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicle.id))
    expect(updatedVehicle.status).toBe('available')

    const [row] = await db.select().from(vehicleRentals).where(eq(vehicleRentals.id, rental.id))
    expect(row.deletedAt).not.toBeNull()

    const overview = await getVehiclesOverview()
    expect(overview.rentals.find((r) => r.id === rental.id)).toBeUndefined()

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'vehicle_rental'), eq(auditLog.entityId, rental.id)))
    expect(log.action).toBe('delete')
    expect(log.reason).toBe('Double saisie')
  })

  it('leaves a completed rental vehicle untouched, and rejects deleting a rental twice', async () => {
    const vehicle = await makeVehicle('P', 5000)
    const rental = await createRental({ vehicleId: vehicle.id, clientName: 'Client Clôturé', startDate: '2026-11-01', days: 1 })
    rentalIds.push(rental.id)
    await closeRental(rental.id, { endDate: '2026-11-02' })

    await deleteRental(rental.id, actor)
    const [updatedVehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicle.id))
    expect(updatedVehicle.status).toBe('available') // closeRental already freed it; delete shouldn't touch it again

    await expect(deleteRental(rental.id, actor)).rejects.toThrow(/introuvable/i)
  })
})
