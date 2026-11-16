import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../client'
import {
  products,
  stockLevels,
  stockMovements,
  supplierDeliveries,
  supplierDeliveryCharges,
  supplierDeliveryItems,
  supplierPayables,
  supplierPaymentAllocations,
  suppliers,
} from '../schema'
import { getQuantity } from './shared'
import { checkAndGrantSupplierCycle } from './discounts'
import { writeAuditLog, type Actor } from './audit'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Queryable = Pick<typeof db, 'select'>

export async function createSupplier(input: { name: string; phone?: string }) {
  const [supplier] = await db.insert(suppliers).values({ name: input.name, phone: input.phone ?? null }).returning()
  return supplier
}

type DeliveryItemInput = { productId: number; sackCount: number; tonnage?: number | null }
type DeliveryChargeInput = { description: string; quantity: number; unitPrice: number }

type DeliveryInput = {
  supplierId: number
  storeId: number
  reference?: string | null
  date?: string | null
  items: DeliveryItemInput[]
  charges?: DeliveryChargeInput[]
  paymentStatus: 'paid' | 'partial' | 'credit'
  paidNow: number
  dueInDays: number
}

type Delivery = typeof supplierDeliveries.$inferSelect
type ResolvedItem = DeliveryItemInput & { unitCost: number; lineTotal: number }

/** Prices every item from the product catalog (never trusting client-supplied cost, same reasoning
 * as sales' resolveAndCheckStock) and checks stock sufficiency isn't relevant here — a delivery
 * only ever adds to stock, never removes it. */
async function resolveItems(tx: Queryable, items: DeliveryItemInput[]) {
  const productRows = await tx.select().from(products)
  const productMap = new Map(productRows.map((product) => [product.id, product]))

  const resolved: ResolvedItem[] = items.map((item) => {
    const product = productMap.get(item.productId)
    if (!product) {
      throw new Error('Produit introuvable.')
    }
    return { ...item, unitCost: product.costPrice, lineTotal: item.sackCount * product.costPrice }
  })

  const itemsTotal = resolved.reduce((sum, item) => sum + item.lineTotal, 0)
  return { items: resolved, itemsTotal }
}

/** Bumps stock for every item line and records the payable implied by `paymentStatus` for an
 * already-inserted delivery row — shared by `recordSupplierDelivery` (fresh insert) and
 * `updateSupplierDelivery`'s reapply step, so the two never drift apart. */
async function applyDeliveryEffects(
  tx: Tx,
  delivery: Delivery,
  items: ResolvedItem[],
  charges: DeliveryChargeInput[],
  input: Pick<DeliveryInput, 'paymentStatus' | 'paidNow' | 'dueInDays' | 'supplierId'>,
) {
  await tx.insert(supplierDeliveryItems).values(
    items.map((item) => ({
      deliveryId: delivery.id,
      productId: item.productId,
      sackCount: item.sackCount,
      tonnage: item.tonnage ?? null,
      unitCost: item.unitCost,
    })),
  )
  if (charges.length > 0) {
    await tx.insert(supplierDeliveryCharges).values(
      charges.map((charge) => ({ deliveryId: delivery.id, description: charge.description, quantity: charge.quantity, unitPrice: charge.unitPrice })),
    )
  }

  for (const item of items) {
    const currentQuantity = await getQuantity(tx, item.productId, delivery.storeId)
    await tx
      .update(stockLevels)
      .set({ quantity: currentQuantity + item.sackCount })
      .where(and(eq(stockLevels.productId, item.productId), eq(stockLevels.storeId, delivery.storeId)))
    await tx.insert(stockMovements).values({
      type: 'reception',
      productId: item.productId,
      storeId: delivery.storeId,
      quantity: item.sackCount,
      reference: delivery.reference ?? `Livraison fournisseur #${delivery.id}`,
    })
  }

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

/** Undoes `applyDeliveryEffects`: restocks every item line (logged as an `adjustment`, not a
 * deletion of the original `reception` movements, so the history stays intact), removes the item/
 * charge rows and the payable it created — refusing if a supplier payment has already been
 * allocated against that payable (mirrors `assertNoExternalPaymentSince` in sales.ts: reversing
 * blindly would resurrect a debt the supplier was already paid down on). */
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

  const items = await tx.select().from(supplierDeliveryItems).where(eq(supplierDeliveryItems.deliveryId, delivery.id))
  for (const item of items) {
    const currentQuantity = await getQuantity(tx, item.productId, delivery.storeId)
    if (currentQuantity < item.sackCount) {
      const [product] = await tx.select().from(products).where(eq(products.id, item.productId))
      throw new Error(
        `Stock insuffisant pour annuler cette livraison (${product?.name ?? 'article'} : disponible ${currentQuantity}, livré ${item.sackCount}) — probablement déjà revendue.`,
      )
    }
  }

  for (const item of items) {
    const currentQuantity = await getQuantity(tx, item.productId, delivery.storeId)
    await tx
      .update(stockLevels)
      .set({ quantity: currentQuantity - item.sackCount })
      .where(and(eq(stockLevels.productId, item.productId), eq(stockLevels.storeId, delivery.storeId)))
    await tx.insert(stockMovements).values({
      type: 'adjustment',
      productId: item.productId,
      storeId: delivery.storeId,
      quantity: -item.sackCount,
      reference: `Correction livraison #${delivery.id}`,
    })
  }

  await tx.delete(supplierDeliveryItems).where(eq(supplierDeliveryItems.deliveryId, delivery.id))
  await tx.delete(supplierDeliveryCharges).where(eq(supplierDeliveryCharges.deliveryId, delivery.id))

  if (payable) {
    await tx.delete(supplierPayables).where(eq(supplierPayables.id, payable.id))
  }
}

export async function recordSupplierDelivery(input: DeliveryInput) {
  if (input.items.length === 0) {
    throw new Error('Une livraison doit contenir au moins un article.')
  }
  if (input.items.some((item) => item.sackCount <= 0)) {
    throw new Error('Le nombre de sacs doit être supérieur à zéro pour chaque article.')
  }
  const charges = input.charges ?? []

  return db
    .transaction(async (tx) => {
      const { items, itemsTotal } = await resolveItems(tx, input.items)
      const chargesTotal = charges.reduce((sum, charge) => sum + charge.quantity * charge.unitPrice, 0)
      const totalAmount = itemsTotal + chargesTotal

      const [delivery] = await tx
        .insert(supplierDeliveries)
        .values({
          supplierId: input.supplierId,
          storeId: input.storeId,
          reference: input.reference ?? null,
          totalAmount,
          date: input.date ?? null,
        })
        .returning()

      await applyDeliveryEffects(tx, delivery, items, charges, input)
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
  if (input.items.length === 0) {
    throw new Error('Une livraison doit contenir au moins un article.')
  }
  if (input.items.some((item) => item.sackCount <= 0)) {
    throw new Error('Le nombre de sacs doit être supérieur à zéro pour chaque article.')
  }
  const charges = input.charges ?? []

  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(supplierDeliveries).where(and(eq(supplierDeliveries.id, id), isNull(supplierDeliveries.deletedAt))).for('update')
    if (!existing) {
      throw new Error('Livraison introuvable.')
    }
    const existingItems = await tx.select().from(supplierDeliveryItems).where(eq(supplierDeliveryItems.deliveryId, id))
    const existingCharges = await tx.select().from(supplierDeliveryCharges).where(eq(supplierDeliveryCharges.deliveryId, id))
    const [existingPayable] = await tx.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, id))
    const beforeData = { delivery: existing, items: existingItems, charges: existingCharges, payable: existingPayable ?? null }

    await reverseDeliveryEffects(tx, existing)

    const { items, itemsTotal } = await resolveItems(tx, input.items)
    const chargesTotal = charges.reduce((sum, charge) => sum + charge.quantity * charge.unitPrice, 0)
    const totalAmount = itemsTotal + chargesTotal

    const [updatedDelivery] = await tx
      .update(supplierDeliveries)
      .set({
        supplierId: input.supplierId,
        storeId: input.storeId,
        reference: input.reference ?? null,
        totalAmount,
        date: input.date ?? null,
      })
      .where(eq(supplierDeliveries.id, id))
      .returning()

    await applyDeliveryEffects(tx, updatedDelivery, items, charges, input)

    const newItems = await tx.select().from(supplierDeliveryItems).where(eq(supplierDeliveryItems.deliveryId, id))
    const newCharges = await tx.select().from(supplierDeliveryCharges).where(eq(supplierDeliveryCharges.deliveryId, id))
    const [newPayable] = await tx.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, id))

    await writeAuditLog(tx, {
      entityType: 'supplier_delivery',
      entityId: id,
      action: 'update',
      actor,
      reason,
      beforeData,
      afterData: { delivery: updatedDelivery, items: newItems, charges: newCharges, payable: newPayable ?? null },
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
    const existingItems = await tx.select().from(supplierDeliveryItems).where(eq(supplierDeliveryItems.deliveryId, id))
    const existingCharges = await tx.select().from(supplierDeliveryCharges).where(eq(supplierDeliveryCharges.deliveryId, id))
    const [existingPayable] = await tx.select().from(supplierPayables).where(eq(supplierPayables.deliveryId, existing.id))
    const beforeData = { delivery: existing, items: existingItems, charges: existingCharges, payable: existingPayable ?? null }

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
