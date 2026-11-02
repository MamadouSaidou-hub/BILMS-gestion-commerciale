import { NextResponse } from 'next/server'
import { createUnit } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const buildingId = Number(id)
  const body = await request.json()

  const label = String(body.label ?? '').trim()
  const floor = Number(body.floor)
  const monthlyRent = Number(body.monthlyRent)

  if (!Number.isFinite(buildingId) || !label || !Number.isFinite(floor) || !Number.isFinite(monthlyRent) || monthlyRent <= 0) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  try {
    const unit = await createUnit({ buildingId, label, floor, monthlyRent })
    return NextResponse.json({ unit }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
