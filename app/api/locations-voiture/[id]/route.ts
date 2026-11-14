import { NextResponse } from 'next/server'
import { deleteRental, updateRental } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const rentalId = Number(id)
  if (!Number.isFinite(rentalId)) return NextResponse.json({ error: 'Location invalide.' }, { status: 400 })

  const body = await request.json()
  const startDate = typeof body.startDate === 'string' && body.startDate.trim() ? body.startDate.trim() : undefined
  const days = body.days !== undefined && body.days !== null && body.days !== '' ? Number(body.days) : undefined
  const dailyRateOverride =
    body.dailyRateOverride !== undefined && body.dailyRateOverride !== null && body.dailyRateOverride !== '' ? Number(body.dailyRateOverride) : undefined
  const notes = body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : undefined
  const departureCity = body.departureCity !== undefined ? (body.departureCity ? String(body.departureCity).trim() : null) : undefined
  const destinationCity = body.destinationCity !== undefined ? (body.destinationCity ? String(body.destinationCity).trim() : null) : undefined
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  if ((days !== undefined && !Number.isFinite(days)) || (dailyRateOverride !== undefined && !Number.isFinite(dailyRateOverride))) {
    return NextResponse.json({ error: 'Champs invalides.' }, { status: 400 })
  }

  try {
    const rental = await updateRental(
      rentalId,
      { startDate, days, dailyRateOverride, notes, departureCity, destinationCity },
      { userId: ctx.userId, userName: ctx.userName },
      reason,
    )
    return NextResponse.json({ rental })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const rentalId = Number(id)
  if (!Number.isFinite(rentalId)) return NextResponse.json({ error: 'Location invalide.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  try {
    const rental = await deleteRental(rentalId, { userId: ctx.userId, userName: ctx.userName }, reason)
    return NextResponse.json({ rental })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
