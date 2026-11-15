import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../client'
import { products, stockLevels, stockMovements, supplierPaymentAllocations, supplierDeliveries, supplierPayables, suppliers } from '../schema'
import { getQuantity } from './shared'
import { checkAndGrantSupplierCycle } from './discounts'
import { writeAuditLog, type Actor } from './audit'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function createSupplier(input: { name: string; phone?: string }) {
  const [supplier] = await db.insert(suppliers).values({ name: input.name, phone: input.phone ?? null }).returning()
  return supplier
}

type DeliveryInput = {
  supplierId: number
  storeId: number
  productId: number
  sackCount: number
  tonnage?: number | null
  reference?: string | null
  paymentStatus: 'paid' | 'partial' | 'credit'
  paidNow: number
  dueInDays: number
}

type Delivery = typeof supplierDeliveries.$inferSelect

/** Bumps stock and records the payable implied by `paymentStatus` for an already-inserted delivery
 * row — shared by `recordSupplierDelivery` (fresh insert) and `updateSupplierDelivery`'s reapply
 * step (same row, corrected values), so the two never drift apart. */
async function applyDeliveryEffects(tx: Tx, delivery: Delivery, input: Pick<DeliveryInput, 'paymentStatus' | 'paidNow' | 'dueInDays' | 'supplierId'>) {
  const currentQuantity = await getQuantity(tx, delivery.productId, delivery.storeId)
  await tx
    .update(stockLevels)
    .set({ quantity: currentQuantity + delivery.sackCount })
    .where(and(eq(stockLevels.productId, delivery.productId), eq(stockLevels.storeId, delivery.storeId)))
  await tx.insert(stockMovements).values({
    type: 'reception',
    productId: delivery.productId,
    storeId: delivery.storeId,
    quantity: delivery.sackCount,
    reference: delivery.reference ?? `Livraison fournisseur #${delivery.id}`,
  })

  if (input.paymentStatus !== 'paid') {
    const remaining = delivery.totalAmount - input.paidNow
    if (remaining > 0) {
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + input.dueInDays)
      await tx.insert(supplierPayables).values({
        supplierId: input.supplierId,
        deliveryId: delivery.id,
        amount: remaining,
        dueDate: dueDate.toISOString(),
        status: 'pending',
      })
    }
  }
}

/** Undoes `applyDeliveryEffects`: restocks (logged as an `adjustment`, not a deletion of the
 * original `reception` movement, so the history stays intact) and removes the payable it created
 * — refusing if a supplier payment has already been allocated against that payable (mirrors
 * `assertNoExternalPaymentSince` in sales.ts: reversing blindly would resurrect a debt the
 * supplier was already paid down on). */
async function reverseDeliveryEffects(tx: Tx, delivery: Delivery) {
  const [payable] = await tx.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, delivery.id))
  if (payable) {
    const [allocation] = await tx.select().from(supplierPaymentAllocations).where(eq(supplierPaymentAllocations.payableId, payable.id))
    if (allocation) {
      throw new Error(
        'Cette livraison a déjà été réglée (totalement ou partiellement) via un paiement fournisseur — modification/suppression impossible.',
      )
    }
  }

  const currentQuantity = await getQuantity(tx, delivery.productId, delivery.storeId)
  if (currentQuantity < delivery.sackCount) {
    throw new Error(`Stock insuffisant pour annuler cette livraison (disponible : ${currentQuantity}, livré : ${delivery.sackCount}) — probablement déjà revendue.`)
  }

  await tx
    .update(stockLevels)
    .set({ quantity: currentQuantity - delivery.sackCount })
    .where(and(eq(stockLevels.productId, delivery.productId), eq(stockLevels.storeId, delivery.storeId)))
  await tx.insert(stockMovements).values({
    type: 'adjustment',
    productId: delivery.productId,
    storeId: delivery.storeId,
    quantity: -delivery.sackCount,
    reference: `Correction livraison #${delivery.id}`,
  })

  if (payable) {
    await tx.delete(supplierPayables).where(eq(supplierPayables.id, payable.id))
  }
}

export async function recordSupplierDelivery(input: DeliveryInput) {
  if (input.sackCount <= 0) {
    throw new Error('Le nombre de sacs doit être supérieur à zéro.')
  }

  return db
    .transaction(async (tx) => {
      const [product] = await tx.select().from(products).where(eq(products.id, input.productId))
      if (!product) {
        throw new Error('Produit introuvable.')
      }
      const totalAmount = input.sackCount * product.costPrice

      const [delivery] = await tx
        .insert(supplierDeliveries)
        .values({
          supplierId: input.supplierId,
          storeId: input.storeId,
          productId: input.productId,
          reference: input.reference ?? null,
          sackCount: input.sackCount,
          tonnage: input.tonnage ?? null,
          totalAmount,
        })
        .returning()

      await applyDeliveryEffects(tx, delivery, input)
      return delivery
    })
    .then(async (delivery) => {
      // Best-effort: check whether this delivery crosses a discount-tier threshold and, if so, grant it.
      // Done after the transaction commits (so the delivery is visible), and never allowed to fail the
      // delivery itself — a discount-check glitch shouldn't block recording a real stock reception.
      try {
        await checkAndGrantSupplierCycle(input.supplierId)
      } catch (error) {
        console.error('checkAndGrantSupplierCycle failed after recordSupplierDelivery', error)
      }
      return delivery
    })
}

export async function updateSupplierDelivery(id: number, input: DeliveryInput, actor: Actor, reason?: string) {
  if (input.sackCount <= 0) {
    throw new Error('Le nombre de sacs doit être supérieur à zéro.')
  }

  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(supplierDeliveries).where(and(eq(supplierDeliveries.id, id), isNull(supplierDeliveries.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Livraison introuvable.')
    }
    const [existingPayable] = await tx.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, existing.id))
    const beforeData = { delivery: existing, payable: existingPayable ?? null }

    await reverseDeliveryEffects(tx, existing)

    const [product] = await tx.select().from(products).where(eq(products.id, input.productId))
    if (!product) {
      throw new Error('Produit introuvable.')
    }
    const totalAmount = input.sackCount * product.costPrice

    const [updatedDelivery] = await tx
      .update(supplierDeliveries)
      .set({
        supplierId: input.supplierId,
        storeId: input.storeId,
        productId: input.productId,
        reference: input.reference ?? null,
        sackCount: input.sackCount,
        tonnage: input.tonnage ?? null,
        totalAmount,
      })
      .where(eq(supplierDeliveries.id, id))
      .returning()

    await applyDeliveryEffects(tx, updatedDelivery, input)

    const [newPayable] = await tx.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, id))

    await writeAuditLog(tx, {
      entityType: 'supplier_delivery',
      entityId: id,
      action: 'update',
      actor,
      reason,
      beforeData,
      afterData: { delivery: updatedDelivery, payable: newPayable ?? null },
    })

    return updatedDelivery
  })

  try {
    await checkAndGrantSupplierCycle(input.supplierId)
  } catch (error) {
    console.error('checkAndGrantSupplierCycle failed after updateSupplierDelivery', error)
  }

  return updated
}

export async function deleteSupplierDelivery(id: number, actor: Actor, reason?: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(supplierDeliveries).where(and(eq(supplierDeliveries.id, id), isNull(supplierDeliveries.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Livraison introuvable.')
    }
    const [existingPayable] = await tx.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, existing.id))
    const beforeData = { delivery: existing, payable: existingPayable ?? null }

    await reverseDeliveryEffects(tx, existing)

    const [deleted] = await tx
      .update(supplierDeliveries)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(supplierDeliveries.id, id))
      .returning()

    await writeAuditLog(tx, {
      entityType: 'supplier_delivery',
      entityId: id,
      action: 'delete',
      actor,
      reason,
      beforeData,
    })

    return deleted
  })
}
