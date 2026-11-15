import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../client'
import { stockCounts, stockLevels, stockMovements, stockReceptions } from '../schema'
import { getQuantity } from './shared'
import { writeAuditLog, type Actor } from './audit'

export async function recordStockCount(input: { storeId: number; productId: number; countedQty: number; countedBy: string; date?: string | null }) {
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
        date: input.date ?? null,
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
export async function updateStockCount(id: number, input: { countedQty: number; date?: string | null }, actor: Actor, reason?: string) {
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
      .set({ countedQty: input.countedQty, variance: newVariance, date: input.date ?? null })
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

export async function recordStockReception(input: { productId: number; storeId: number; quantity: number; reference?: string; date?: string }) {
  if (input.quantity <= 0) {
    throw new Error('La quantité doit être supérieure à zéro.')
  }

  return db.transaction(async (tx) => {
    const [reception] = await tx
      .insert(stockReceptions)
      .values({
        productId: input.productId,
        storeId: input.storeId,
        quantity: input.quantity,
        reference: input.reference ?? null,
        date: input.date ?? null,
      })
      .returning()

    const currentQuantity = await getQuantity(tx, input.productId, input.storeId)
    await tx
      .update(stockLevels)
      .set({ quantity: currentQuantity + input.quantity })
      .where(and(eq(stockLevels.productId, input.productId), eq(stockLevels.storeId, input.storeId)))

    await tx.insert(stockMovements).values({
      type: 'reception',
      productId: input.productId,
      storeId: input.storeId,
      quantity: input.quantity,
      reference: input.reference ?? null,
    })

    return reception
  })
}

/** Reverses a stock reception's effect on `stockLevels` — logged as an `adjustment` movement
 * (not a deletion of the original `reception` movement, so the history stays intact) — shared by
 * `updateStockReception` (reverse, then reapply with corrected values) and `deleteStockReception`
 * (reverse, then soft-delete). Refuses if the stock has since dropped below what this reception
 * contributed (already resold), same guard as `updateSupplierDelivery`/`deleteSupplierDelivery`. */
async function reverseStockReceptionEffects(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], reception: typeof stockReceptions.$inferSelect) {
  const currentQuantity = await getQuantity(tx, reception.productId, reception.storeId)
  if (currentQuantity < reception.quantity) {
    throw new Error(`Stock insuffisant pour annuler cette réception (disponible : ${currentQuantity}, reçu : ${reception.quantity}) — probablement déjà revendue.`)
  }

  await tx
    .update(stockLevels)
    .set({ quantity: currentQuantity - reception.quantity })
    .where(and(eq(stockLevels.productId, reception.productId), eq(stockLevels.storeId, reception.storeId)))
  await tx.insert(stockMovements).values({
    type: 'adjustment',
    productId: reception.productId,
    storeId: reception.storeId,
    quantity: -reception.quantity,
    reference: `Correction réception #${reception.id}`,
  })
}

export async function updateStockReception(
  id: number,
  input: { productId: number; storeId: number; quantity: number; reference?: string; date?: string },
  actor: Actor,
  reason?: string,
) {
  if (input.quantity <= 0) {
    throw new Error('La quantité doit être supérieure à zéro.')
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(stockReceptions).where(and(eq(stockReceptions.id, id), isNull(stockReceptions.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Réception introuvable.')
    }

    await reverseStockReceptionEffects(tx, existing)

    const [updated] = await tx
      .update(stockReceptions)
      .set({
        productId: input.productId,
        storeId: input.storeId,
        quantity: input.quantity,
        reference: input.reference ?? null,
        date: input.date ?? null,
      })
      .where(eq(stockReceptions.id, id))
      .returning()

    const currentQuantity = await getQuantity(tx, updated.productId, updated.storeId)
    await tx
      .update(stockLevels)
      .set({ quantity: currentQuantity + updated.quantity })
      .where(and(eq(stockLevels.productId, updated.productId), eq(stockLevels.storeId, updated.storeId)))
    await tx.insert(stockMovements).values({
      type: 'reception',
      productId: updated.productId,
      storeId: updated.storeId,
      quantity: updated.quantity,
      reference: updated.reference ?? `Correction réception #${id}`,
    })

    await writeAuditLog(tx, {
      entityType: 'stock_reception',
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

export async function deleteStockReception(id: number, actor: Actor, reason?: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(stockReceptions).where(and(eq(stockReceptions.id, id), isNull(stockReceptions.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Réception introuvable.')
    }

    await reverseStockReceptionEffects(tx, existing)

    const [deleted] = await tx
      .update(stockReceptions)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(stockReceptions.id, id))
      .returning()

    await writeAuditLog(tx, {
      entityType: 'stock_reception',
      entityId: id,
      action: 'delete',
      actor,
      reason,
      beforeData: existing,
    })

    return deleted
  })
}
