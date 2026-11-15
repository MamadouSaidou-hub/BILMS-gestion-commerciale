import { NextRequest, NextResponse } from 'next/server'
import { deleteStockCount, updateStockCount } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { isValidDateString } from '@/lib/dates'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const countId = Number(id)
  if (!Number.isFinite(countId)) return NextResponse.json({ error: 'Comptage invalide.' }, { status: 400 })

  const body = await request.json()
  const countedQty = Number(body.countedQty)
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  const date = body.date ? String(body.date) : null

  if (!Number.isFinite(countedQty) || countedQty < 0) {
    return NextResponse.json({ error: 'Quantité invalide.' }, { status: 400 })
  }
  if (date !== null && !isValidDateString(date)) {
    return NextResponse.json({ error: 'Date invalide.' }, { status: 400 })
  }

  try {
    const count = await updateStockCount(countId, { countedQty, date }, { userId: ctx.userId, userName: ctx.userName }, reason)
    return NextResponse.json({ count })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const countId = Number(id)
  if (!Number.isFinite(countId)) return NextResponse.json({ error: 'Comptage invalide.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  try {
    const count = await deleteStockCount(countId, { userId: ctx.userId, userName: ctx.userName }, reason)
    return NextResponse.json({ count })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
