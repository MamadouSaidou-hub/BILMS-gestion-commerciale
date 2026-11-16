import { NextRequest, NextResponse } from 'next/server'
import { deleteStockReception, updateStockReception } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { isValidDateString } from '@/lib/dates'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const receptionId = Number(id)
  if (!Number.isFinite(receptionId)) return NextResponse.json({ error: 'Réception invalide.' }, { status: 400 })

  const body = await request.json()
  const storeId = Number(body.storeId)
  const date = body.date ? String(body.date) : undefined
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined
  const rawItems = Array.isArray(body.items) ? body.items : []
  const items = rawItems.map((item: { productId: unknown; quantity: unknown }) => ({
    productId: Number(item.productId),
    quantity: Number(item.quantity),
  }))

  if (
    !Number.isFinite(storeId) ||
    items.length === 0 ||
    items.some((item: { productId: number; quantity: number }) => !Number.isFinite(item.productId) || !Number.isFinite(item.quantity) || item.quantity <= 0)
  ) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }
  if (date !== undefined && !isValidDateString(date)) {
    return NextResponse.json({ error: 'Date invalide.' }, { status: 400 })
  }

  try {
    const reception = await updateStockReception(
      receptionId,
      { storeId, items, reference: body.reference ? String(body.reference) : undefined, date },
      { userId: ctx.userId, userName: ctx.userName },
      reason,
    )
    return NextResponse.json({ reception })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const receptionId = Number(id)
  if (!Number.isFinite(receptionId)) return NextResponse.json({ error: 'Réception invalide.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  try {
    const reception = await deleteStockReception(receptionId, { userId: ctx.userId, userName: ctx.userName }, reason)
    return NextResponse.json({ reception })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
