import { NextResponse } from 'next/server'
import { getVehiclesOverview } from '@/lib/db/queries'
import { createVehicle } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function GET() {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const data = await getVehiclesOverview()
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const body = await request.json()
  const name = String(body.name ?? '').trim()
  const plate = String(body.plate ?? '').trim()
  const dailyRate = Number(body.dailyRate)

  if (!name || !plate || !Number.isFinite(dailyRate) || dailyRate <= 0) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  try {
    const vehicle = await createVehicle({ name, plate, dailyRate, notes: body.notes ? String(body.notes).trim() : undefined })
    return NextResponse.json({ vehicle }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
