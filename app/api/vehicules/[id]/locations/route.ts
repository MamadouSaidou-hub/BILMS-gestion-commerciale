import { NextResponse } from 'next/server'
import { createRental } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const vehicleId = Number(id)
  const body = await request.json()

  const clientName = String(body.clientName ?? '').trim()
  const startDate = String(body.startDate ?? '').trim()
  const days = Number(body.days)

  if (!Number.isFinite(vehicleId) || !clientName || !startDate || !Number.isFinite(days) || days <= 0) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  try {
    const rental = await createRental({
      vehicleId,
      clientName,
      clientPhone: body.clientPhone ? String(body.clientPhone).trim() : undefined,
      startDate,
      days,
    })
    return NextResponse.json({ rental }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
