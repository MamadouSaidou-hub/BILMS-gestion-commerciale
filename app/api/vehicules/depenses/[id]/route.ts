import { NextResponse } from 'next/server'
import { deleteVehicleExpense, updateVehicleExpense } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const expenseId = Number(id)
  if (!Number.isFinite(expenseId)) return NextResponse.json({ error: 'Dépense invalide.' }, { status: 400 })

  const body = await request.json()
  const date = typeof body.date === 'string' && body.date.trim() ? body.date.trim() : undefined
  const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : undefined
  const amount = body.amount !== undefined && body.amount !== null && body.amount !== '' ? Number(body.amount) : undefined
  const vehicleId = body.vehicleId !== undefined ? (body.vehicleId ? Number(body.vehicleId) : null) : undefined
  const notes = body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : undefined
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
    return NextResponse.json({ error: 'Montant invalide.' }, { status: 400 })
  }

  try {
    const expense = await updateVehicleExpense(expenseId, { vehicleId, date, category, amount, notes }, { userId: ctx.userId, userName: ctx.userName }, reason)
    return NextResponse.json({ expense })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const expenseId = Number(id)
  if (!Number.isFinite(expenseId)) return NextResponse.json({ error: 'Dépense invalide.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  try {
    const expense = await deleteVehicleExpense(expenseId, { userId: ctx.userId, userName: ctx.userName }, reason)
    return NextResponse.json({ expense })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
