import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { cashAccounts, cashMovements } from '@/lib/db/schema'

/**
 * Deletes test-created cash movements matched by exact description, AND reverses the balance
 * delta they applied to whichever real caisse they landed in. Deleting a `cash_movements` row
 * directly does not undo its effect on `cash_accounts.balance` (that's a running total, not
 * recomputed from the ledger) — without this, every test file that triggers recordAutoCashMovement
 * (via createSale/recordPayment/recordSupplierPayment etc.) would leave the real "Caisse
 * principale" balance permanently off by whatever test money it recorded.
 */
export async function cleanupCashMovements(descriptions: string[]) {
  if (descriptions.length === 0) return

  const rows = await db.select().from(cashMovements).where(inArray(cashMovements.description, descriptions))
  if (rows.length === 0) return

  await db.delete(cashMovements).where(inArray(cashMovements.description, descriptions))

  const deltaByAccount = new Map<number, number>()
  for (const row of rows) {
    const applied = row.type === 'deposit' ? row.amount : -row.amount
    deltaByAccount.set(row.cashAccountId, (deltaByAccount.get(row.cashAccountId) ?? 0) + applied)
  }
  for (const [accountId, delta] of deltaByAccount) {
    await db
      .update(cashAccounts)
      .set({ balance: sql`${cashAccounts.balance} - ${delta}` })
      .where(eq(cashAccounts.id, accountId))
  }
}
