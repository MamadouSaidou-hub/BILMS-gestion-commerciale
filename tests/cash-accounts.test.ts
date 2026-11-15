import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import {
  auditLog,
  cashAccounts,
  cashMovements,
  clients,
  payments,
  products,
  receivables,
  saleItems,
  sales,
  stockLevels,
  stockMovements,
  stores,
  suppliers,
  supplierPaymentAllocations,
  supplierPayments,
} from '@/lib/db/schema'
import {
  createCashAccount,
  deleteCashMovement,
  recordCashMovement,
  setDefaultCashAccount,
  transferBetweenCashAccounts,
  updateCashMovement,
} from '@/lib/db/mutations/cash-accounts'
import { cancelSale, createSale, updateSale } from '@/lib/db/mutations/sales'
import { deletePayment, deleteSupplierPayment, recordPayment, recordSupplierPayment, updatePayment } from '@/lib/db/mutations/payments'

const actor = { userId: 'u1', userName: 'Admin Test' }
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let accountAId: number
let accountBId: number
let defaultAccountId: number
let storeId: number
let clientId: number
let supplierId: number
let productId: number
const saleIds: number[] = []
const paymentIds: number[] = []
const supplierPaymentIds: number[] = []

// Real, pre-existing accounts (e.g. the production "Caisse principale") snapshotted before this
// file touches anything, and force-cleared to isDefault=false for the run — recordAutoCashMovement
// always resolves to whichever row has isDefault=true, so with two "default" rows at once (one
// real, one this file's own test account) the auto-routing tests below would silently write fake
// test movements into a REAL account's balance. Restored exactly in afterAll.
let realAccountDefaults: { id: number; isDefault: boolean }[] = []

async function movementFor(description: string) {
  const [row] = await db.select().from(cashMovements).where(eq(cashMovements.description, description))
  return row
}

beforeAll(async () => {
  realAccountDefaults = await db.select({ id: cashAccounts.id, isDefault: cashAccounts.isDefault }).from(cashAccounts)
  for (const row of realAccountDefaults) {
    if (row.isDefault) await db.update(cashAccounts).set({ isDefault: false }).where(eq(cashAccounts.id, row.id))
  }

  const [a] = await db.insert(cashAccounts).values({ name: `Caisse A ${runId}`, type: 'cash', balance: 0 }).returning()
  accountAId = a.id
  const [b] = await db.insert(cashAccounts).values({ name: `Caisse B ${runId}`, type: 'bank', balance: 0 }).returning()
  accountBId = b.id
  const [def] = await db.insert(cashAccounts).values({ name: `Caisse principale ${runId}`, type: 'cash', balance: 0, isDefault: true }).returning()
  defaultAccountId = def.id

  const [store] = await db.insert(stores).values({ name: `Magasin ${runId}`, city: 'Test' }).returning()
  storeId = store.id
  const [client] = await db.insert(clients).values({ name: `Client ${runId}`, storeId }).returning()
  clientId = client.id
  const [supplier] = await db.insert(suppliers).values({ name: `Fournisseur ${runId}` }).returning()
  supplierId = supplier.id
  const [product] = await db.insert(products).values({ name: `Produit ${runId}`, sku: `SKU-CASH-${runId}`, category: 'Test', unitPrice: 1000, costPrice: 800, unit: 'sack' }).returning()
  productId = product.id
  await db.insert(stockLevels).values({ productId, storeId, quantity: 100 })
})

afterAll(async () => {
  // Restore every real account's isDefault to exactly what it was before this file ran, now that
  // this file's own test accounts (deleted below) are no longer competing for the "default" slot.
  for (const row of realAccountDefaults) {
    if (row.isDefault) await db.update(cashAccounts).set({ isDefault: true }).where(eq(cashAccounts.id, row.id))
  }

  for (const id of supplierPaymentIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'supplier_payment'), eq(auditLog.entityId, id)))
    await db.delete(supplierPaymentAllocations).where(eq(supplierPaymentAllocations.paymentId, id))
    await db.delete(supplierPayments).where(eq(supplierPayments.id, id))
  }
  for (const saleId of saleIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'sale'), eq(auditLog.entityId, saleId)))
    await db.delete(receivables).where(eq(receivables.saleId, saleId))
    await db.delete(payments).where(eq(payments.saleId, saleId))
    await db.delete(saleItems).where(eq(saleItems.saleId, saleId))
    await db.delete(sales).where(eq(sales.id, saleId))
  }
  for (const id of paymentIds) {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, 'payment'), eq(auditLog.entityId, id)))
    await db.delete(payments).where(eq(payments.id, id))
  }
  await db.delete(stockMovements).where(eq(stockMovements.storeId, storeId))
  await db.delete(stockLevels).where(eq(stockLevels.storeId, storeId))
  await db.delete(products).where(eq(products.id, productId))
  await db.delete(suppliers).where(eq(suppliers.id, supplierId))
  await db.delete(clients).where(eq(clients.id, clientId))
  await db.delete(stores).where(eq(stores.id, storeId))

  await db.delete(cashMovements).where(eq(cashMovements.cashAccountId, accountAId))
  await db.delete(cashMovements).where(eq(cashMovements.cashAccountId, accountBId))
  await db.delete(cashMovements).where(eq(cashMovements.cashAccountId, defaultAccountId))
  await db.delete(cashAccounts).where(eq(cashAccounts.id, accountAId))
  await db.delete(cashAccounts).where(eq(cashAccounts.id, accountBId))
  await db.delete(cashAccounts).where(eq(cashAccounts.id, defaultAccountId))
})

describe('createCashAccount / recordCashMovement', () => {
  it('creates an account with the given initial balance', async () => {
    const account = await createCashAccount({ name: `Caisse test ${runId}`, type: 'mobile_money', initialBalance: 5000 })
    expect(account.balance).toBe(5000)
    await db.delete(cashAccounts).where(eq(cashAccounts.id, account.id))
  })

  it('a deposit increases the account balance, an expense decreases it', async () => {
    await recordCashMovement({ cashAccountId: accountAId, type: 'deposit', category: 'Apport', amount: 10000 })
    let [account] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, accountAId))
    expect(account.balance).toBe(10000)

    await recordCashMovement({ cashAccountId: accountAId, type: 'expense', category: 'Transport', amount: 4000 })
    ;[account] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, accountAId))
    expect(account.balance).toBe(6000)
  })
})

describe('updateCashMovement / deleteCashMovement', () => {
  it('corrects the account balance to reflect the new amount, and writes an audit entry', async () => {
    const movement = await recordCashMovement({ cashAccountId: accountAId, type: 'expense', category: 'Loyer', amount: 1000 })
    let [account] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, accountAId))
    const before = account.balance

    const updated = await updateCashMovement(movement.id, { category: 'Loyer', amount: 1500, type: 'expense' }, actor, 'Montant corrigé')
    expect(updated.amount).toBe(1500)
    ;[account] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, accountAId))
    expect(account.balance).toBe(before - 500)

    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'cash_movement'), eq(auditLog.entityId, movement.id)))
    expect(log.action).toBe('update')
    expect(log.reason).toBe('Montant corrigé')
  })

  it('reverses the balance effect and soft-deletes the movement', async () => {
    const movement = await recordCashMovement({ cashAccountId: accountAId, type: 'deposit', category: 'Apport', amount: 2000 })
    let [account] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, accountAId))
    const before = account.balance

    await deleteCashMovement(movement.id, actor, 'Doublon')
    ;[account] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, accountAId))
    expect(account.balance).toBe(before - 2000)

    const [row] = await db.select().from(cashMovements).where(eq(cashMovements.id, movement.id))
    expect(row.deletedAt).not.toBeNull()
  })
})

describe('transferBetweenCashAccounts', () => {
  it('moves the amount from one account to the other', async () => {
    const [before1] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, accountAId))
    const [before2] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, accountBId))

    await transferBetweenCashAccounts({ fromId: accountAId, toId: accountBId, amount: 1000 })

    const [after1] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, accountAId))
    const [after2] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, accountBId))
    expect(after1.balance).toBe(before1.balance - 1000)
    expect(after2.balance).toBe(before2.balance + 1000)
  })

  it('rejects a transfer to the same account', async () => {
    await expect(transferBetweenCashAccounts({ fromId: accountAId, toId: accountAId, amount: 100 })).rejects.toThrow(/différentes/i)
  })
})

describe('setDefaultCashAccount', () => {
  it('flips isDefault exclusively onto the chosen account', async () => {
    await setDefaultCashAccount(accountAId)
    const rows = await db.select().from(cashAccounts).where(eq(cashAccounts.id, accountAId))
    expect(rows[0].isDefault).toBe(true)

    const [other] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, defaultAccountId))
    expect(other.isDefault).toBe(false)

    // Restore for the auto-routing tests below, which assume `defaultAccountId` is the default
    // (the real accounts, snapshotted in beforeAll, stay forced false until this file's afterAll).
    await setDefaultCashAccount(defaultAccountId)
  })
})

describe('Boutique sales auto-route into the caisse', () => {
  it('records an "in" movement for a sale paid in full, and reverses it on cancellation', async () => {
    const sale = await createSale({ storeId, clientId: null, paymentStatus: 'paid', paidNow: 0, dueInDays: 30, items: [{ productId, quantity: 2, unitPrice: 1000 }] })
    saleIds.push(sale.id)

    const movement = await movementFor(`Vente #${sale.reference}`)
    expect(movement).toBeTruthy()
    expect(movement.type).toBe('deposit')
    expect(movement.amount).toBe(2000)

    await cancelSale(sale.reference, actor)
    const reversal = await movementFor(`Annulation vente #${sale.reference}`)
    expect(reversal).toBeTruthy()
    expect(reversal.type).toBe('expense')
    expect(reversal.amount).toBe(2000)
  })

  it('records nothing for a pure credit sale, but records the correction pair on edit', async () => {
    const sale = await createSale({ storeId, clientId, paymentStatus: 'credit', paidNow: 0, dueInDays: 30, items: [{ productId, quantity: 1, unitPrice: 1000 }] })
    saleIds.push(sale.id)

    expect(await movementFor(`Vente #${sale.reference}`)).toBeUndefined()

    const updated = await updateSale(sale.reference, { storeId, clientId, paymentStatus: 'paid', paidNow: 0, dueInDays: 30, items: [{ productId, quantity: 1, unitPrice: 1000 }] }, actor)

    const outLeg = await movementFor(`Correction vente #${updated.reference} (ancien montant)`)
    expect(outLeg).toBeUndefined() // nothing was received at creation (pure credit), so no reversal leg

    const inLeg = await movementFor(`Correction vente #${updated.reference} (nouveau montant)`)
    expect(inLeg).toBeTruthy()
    expect(inLeg.type).toBe('deposit')
    expect(inLeg.amount).toBe(1000)
  })
})

describe('Client/supplier payments auto-route into the caisse', () => {
  it('a client payment records an "in" movement, reversed on delete', async () => {
    const payment = await recordPayment({ clientId, amount: 3000, method: 'cash', storeId })
    paymentIds.push(payment.id)

    const movement = await movementFor(`Paiement #${payment.id}`)
    expect(movement).toBeTruthy()
    expect(movement.type).toBe('deposit')
    expect(movement.amount).toBe(3000)

    await deletePayment(payment.id, actor, 'Erreur')
    const reversal = await movementFor(`Annulation paiement #${payment.id}`)
    expect(reversal).toBeTruthy()
    expect(reversal.type).toBe('expense')
    expect(reversal.amount).toBe(3000)
  })

  it('editing a client payment records the correction pair', async () => {
    const payment = await recordPayment({ clientId, amount: 1000, method: 'cash', storeId })
    paymentIds.push(payment.id)

    await updatePayment(payment.id, { amount: 2500, method: 'cash', storeId }, actor, 'Montant corrigé')

    const outLeg = await movementFor(`Correction paiement #${payment.id} (ancien montant)`)
    expect(outLeg).toBeTruthy()
    expect(outLeg.amount).toBe(1000)

    const inLeg = await movementFor(`Correction paiement #${payment.id} (nouveau montant)`)
    expect(inLeg).toBeTruthy()
    expect(inLeg.amount).toBe(2500)
  })

  it('a supplier payment records an "out" movement, reversed on delete', async () => {
    const payment = await recordSupplierPayment({ supplierId, amount: 1500, method: 'cash' })
    supplierPaymentIds.push(payment.id)

    const movement = await movementFor(`Paiement fournisseur #${payment.id}`)
    expect(movement).toBeTruthy()
    expect(movement.type).toBe('expense')
    expect(movement.amount).toBe(1500)

    await deleteSupplierPayment(payment.id, actor, 'Erreur')
    const reversal = await movementFor(`Annulation paiement fournisseur #${payment.id}`)
    expect(reversal).toBeTruthy()
    expect(reversal.type).toBe('deposit')
    expect(reversal.amount).toBe(1500)
  })
})
