import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../client'
import { stockCounts, stockLevels, stockMovements } from '../schema'
import { getQuantity } from './shared'
import { writeAuditLog, type Actor } from './audit'

export async function recordStockCount(input: { storeId: number; productId: number; countedQty: number; countedBy: string }) {
  if (input.countedQty < 0) {
    throw new Error('La quantité comptée ne peut pas être négative.')
  }

  return db.transaction(async (tx) => {
    const theoreticalQty = await getQuantity(tx, input.productId, input.storeId)
    const variance = input.countedQty - theoreticalQty

    const [count] = await tx
      .insert(stockCounts)
      .values({
        storeId: input.storeId,
        productId: input.productId,
        theoreticalQty,
        countedQty: input.countedQty,
        variance,
        countedBy: input.countedBy,
      })
      .returning()

    await tx
      .update(stockLevels)
      .set({ quantity: input.countedQty })
      .where(and(eq(stockLevels.productId, input.productId), eq(stockLevels.storeId, input.storeId)))

    if (variance !== 0) {
      await tx.insert(stockMovements).values({
        type: 'adjustment',
        productId: input.productId,
        storeId: input.storeId,
        quantity: variance,
        note: 'Comptage physique',
      })
    }

    return count
  })
}

/** A stock count's real effect on stock is `variance` (countedQty was simply theoreticalQty +
 * variance at the time) — editing/deleting it applies the *change* in variance on top of whatever
 * the current quantity is now, rather than resetting to an absolute value, so later movements
 * (a sale, another count...) aren't silently undone. */
export async function updateStockCount(id: number, input: { countedQty: number }, actor: Actor, reason?: string) {
  if (input.countedQty < 0) {
    throw new Error('La quantité comptée ne peut pas être négative.')
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(stockCounts).where(and(eq(stockCounts.id, id), isNull(stockCounts.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Comptage introuvable.')
    }

    const newVariance = input.countedQty - existing.theoreticalQty
    const delta = newVariance - existing.variance
    const currentQuantity = await getQuantity(tx, existing.productId, existing.storeId)
    const newQuantity = currentQuantity + delta
    if (newQuantity < 0) {
      throw new Error('Cette correction ferait passer le stock sous zéro — vérifiez les mouvements effectués depuis.')
    }

    const [updated] = await tx
      .update(stockCounts)
      .set({ countedQty: input.countedQty, variance: newVariance })
      .where(eq(stockCounts.id, id))
      .returning()

    await tx
      .update(stockLevels)
      .set({ quantity: newQuantity })
      .where(and(eq(stockLevels.productId, existing.productId), eq(stockLevels.storeId, existing.storeId)))

    if (delta !== 0) {
      await tx.insert(stockMovements).values({
        type: 'adjustment',
        productId: existing.productId,
        storeId: existing.storeId,
        quantity: delta,
        note: 'Correction de comptage',
      })
    }

    await writeAuditLog(tx, {
      entityType: 'stock_count',
      entityId: id,
      action: 'update',
      actor,
      reason,
      beforeData: existing,
      afterData: updated,
    })

    return updated
  })
}

export async function deleteStockCount(id: number, actor: Actor, reason?: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(stockCounts).where(and(eq(stockCounts.id, id), isNull(stockCounts.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Comptage introuvable.')
    }

    const currentQuantity = await getQuantity(tx, existing.productId, existing.storeId)
    const newQuantity = currentQuantity - existing.variance
    if (newQuantity < 0) {
      throw new Error('Supprimer ce comptage ferait passer le stock sous zéro — vérifiez les mouvements effectués depuis.')
    }

    const [deleted] = await tx
      .update(stockCounts)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(stockCounts.id, id))
      .returning()

    await tx
      .update(stockLevels)
      .set({ quantity: newQuantity })
      .where(and(eq(stockLevels.productId, existing.productId), eq(stockLevels.storeId, existing.storeId)))

    if (existing.variance !== 0) {
      await tx.insert(stockMovements).values({
        type: 'adjustment',
        productId: existing.productId,
        storeId: existing.storeId,
        quantity: -existing.variance,
        note: 'Annulation de comptage',
      })
    }

    await writeAuditLog(tx, {
      entityType: 'stock_count',
      entityId: id,
      action: 'delete',
      actor,
      reason,
      beforeData: existing,
    })

    return deleted
  })
}
