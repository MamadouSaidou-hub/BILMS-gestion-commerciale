import { NextResponse } from 'next/server'
import { recordVehicleExpense } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function POST(request: Request) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const body = await request.json()
  const date = String(body.date ?? '').trim()
  const category = String(body.category ?? '').trim()
  const amount = Number(body.amount)
  const vehicleId = body.vehicleId ? Number(body.vehicleId) : null

  if (!date || !category || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  try {
    const expense = await recordVehicleExpense({ vehicleId, date, category, amount, notes: body.notes ? String(body.notes).trim() : undefined })
    return NextResponse.json({ expense }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
