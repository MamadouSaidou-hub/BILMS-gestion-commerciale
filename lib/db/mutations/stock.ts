import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../client'
import { products, stockCounts, stockLevels, stockMovements, stockReceptions, stockReceptionItems } from '../schema'
import { getQuantity } from './shared'
import { writeAuditLog, type Actor } from './audit'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

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

type ReceptionItemInput = { productId: number; quantity: number }
type Reception = typeof stockReceptions.$inferSelect

export async function recordStockReception(input: { storeId: number; items: ReceptionItemInput[]; reference?: string; date?: string }) {
  if (input.items.length === 0) {
    throw new Error('Une réception doit contenir au moins un article.')
  }
  if (input.items.some((item) => item.quantity <= 0)) {
    throw new Error('La quantité doit être supérieure à zéro pour chaque article.')
  }

  return db.transaction(async (tx) => {
    const [reception] = await tx
      .insert(stockReceptions)
      .values({ storeId: input.storeId, reference: input.reference ?? null, date: input.date ?? null })
      .returning()

    await applyReceptionEffects(tx, reception, input.items)

    return reception
  })
}

async function applyReceptionEffects(tx: Tx, reception: Reception, items: ReceptionItemInput[]) {
  await tx.insert(stockReceptionItems).values(items.map((item) => ({ receptionId: reception.id, productId: item.productId, quantity: item.quantity })))

  for (const item of items) {
    const currentQuantity = await getQuantity(tx, item.productId, reception.storeId)
    await tx
      .update(stockLevels)
      .set({ quantity: currentQuantity + item.quantity })
      .where(and(eq(stockLevels.productId, item.productId), eq(stockLevels.storeId, reception.storeId)))
    await tx.insert(stockMovements).values({
      type: 'reception',
      productId: item.productId,
      storeId: reception.storeId,
      quantity: item.quantity,
      reference: reception.reference ?? `Réception #${reception.id}`,
    })
  }
}

/** Reverses a reception's effect on `stockLevels` for every item line — logged as `adjustment`
 * movements (not a deletion of the original `reception` movements, so the history stays intact) —
 * shared by `updateStockReception` (reverse, then reapply with corrected lines) and
 * `deleteStockReception` (reverse, then soft-delete). Refuses if the stock has since dropped below
 * what this reception contributed (already resold), same guard as `updateSupplierDelivery`/
 * `deleteSupplierDelivery`. */
async function reverseReceptionEffects(tx: Tx, reception: Reception) {
  const items = await tx.select().from(stockReceptionItems).where(eq(stockReceptionItems.receptionId, reception.id))

  for (const item of items) {
    const currentQuantity = await getQuantity(tx, item.productId, reception.storeId)
    if (currentQuantity < item.quantity) {
      const [product] = await tx.select().from(products).where(eq(products.id, item.productId))
      throw new Error(
        `Stock insuffisant pour annuler cette réception (${product?.name ?? 'article'} : disponible ${currentQuantity}, reçu ${item.quantity}) — probablement déjà revendue.`,
      )
    }
  }

  for (const item of items) {
    const currentQuantity = await getQuantity(tx, item.productId, reception.storeId)
    await tx
      .update(stockLevels)
      .set({ quantity: currentQuantity - item.quantity })
      .where(and(eq(stockLevels.productId, item.productId), eq(stockLevels.storeId, reception.storeId)))
    await tx.insert(stockMovements).values({
      type: 'adjustment',
      productId: item.productId,
      storeId: reception.storeId,
      quantity: -item.quantity,
      reference: `Correction réception #${reception.id}`,
    })
  }

  await tx.delete(stockReceptionItems).where(eq(stockReceptionItems.receptionId, reception.id))
}

export async function updateStockReception(
  id: number,
  input: { storeId: number; items: ReceptionItemInput[]; reference?: string; date?: string },
  actor: Actor,
  reason?: string,
) {
  if (input.items.length === 0) {
    throw new Error('Une réception doit contenir au moins un article.')
  }
  if (input.items.some((item) => item.quantity <= 0)) {
    throw new Error('La quantité doit être supérieure à zéro pour chaque article.')
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(stockReceptions).where(and(eq(stockReceptions.id, id), isNull(stockReceptions.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Réception introuvable.')
    }
    const existingItems = await tx.select().from(stockReceptionItems).where(eq(stockReceptionItems.receptionId, id))
    const beforeData = { reception: existing, items: existingItems }

    await reverseReceptionEffects(tx, existing)

    const [updated] = await tx
      .update(stockReceptions)
      .set({ storeId: input.storeId, reference: input.reference ?? null, date: input.date ?? null })
      .where(eq(stockReceptions.id, id))
      .returning()

    await applyReceptionEffects(tx, updated, input.items)

    const newItems = await tx.select().from(stockReceptionItems).where(eq(stockReceptionItems.receptionId, id))

    await writeAuditLog(tx, {
      entityType: 'stock_reception',
      entityId: id,
      action: 'update',
      actor,
      reason,
      beforeData,
      afterData: { reception: updated, items: newItems },
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
    const existingItems = await tx.select().from(stockReceptionItems).where(eq(stockReceptionItems.receptionId, id))
    const beforeData = { reception: existing, items: existingItems }

    await reverseReceptionEffects(tx, existing)

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
      beforeData,
    })

    return deleted
  })
}
