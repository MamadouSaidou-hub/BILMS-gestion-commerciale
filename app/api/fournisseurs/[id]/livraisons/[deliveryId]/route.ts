import { NextResponse } from 'next/server'
import { deleteSupplierDelivery, updateSupplierDelivery } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; deliveryId: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id, deliveryId } = await params
  const supplierId = Number(id)
  const deliveryIdNum = Number(deliveryId)
  const body = await request.json()

  const storeId = Number(body.storeId)
  const productId = Number(body.productId)
  const sackCount = Number(body.sackCount)
  const paymentStatus = body.paymentStatus as 'paid' | 'partial' | 'credit'
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  if (
    !Number.isFinite(supplierId) ||
    !Number.isFinite(deliveryIdNum) ||
    !Number.isFinite(storeId) ||
    !Number.isFinite(productId) ||
    !Number.isFinite(sackCount) ||
    sackCount <= 0 ||
    !['paid', 'partial', 'credit'].includes(paymentStatus)
  ) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  try {
    const delivery = await updateSupplierDelivery(
      deliveryIdNum,
      {
        supplierId,
        storeId,
        productId,
        sackCount,
        tonnage: body.tonnage ? Number(body.tonnage) : null,
        reference: body.reference ? String(body.reference) : null,
        paymentStatus,
        paidNow: Number(body.paidNow ?? 0),
        dueInDays: Number(body.dueInDays ?? 30),
      },
      { userId: ctx.userId, userName: ctx.userName },
      reason,
    )
    return NextResponse.json({ delivery })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; deliveryId: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { deliveryId } = await params
  const deliveryIdNum = Number(deliveryId)
  if (!Number.isFinite(deliveryIdNum)) return NextResponse.json({ error: 'Livraison invalide.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  try {
    const delivery = await deleteSupplierDelivery(deliveryIdNum, { userId: ctx.userId, userName: ctx.userName }, reason)
    return NextResponse.json({ delivery })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
