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

  const clientId = body.clientId !== undefined && body.clientId !== null && body.clientId !== '' ? Number(body.clientId) : undefined
  const clientName = body.clientName ? String(body.clientName).trim() : undefined
  const startDate = String(body.startDate ?? '').trim()
  const days = Number(body.days)
  const dailyRateOverride =
    body.dailyRateOverride !== undefined && body.dailyRateOverride !== null && body.dailyRateOverride !== '' ? Number(body.dailyRateOverride) : undefined
  const departureCity = body.departureCity ? String(body.departureCity).trim() : null
  const destinationCity = body.destinationCity ? String(body.destinationCity).trim() : null
  const charges = Array.isArray(body.charges)
    ? body.charges.map((charge: { description: unknown; unit: unknown; quantity: unknown; unitPrice: unknown }) => ({
        description: String(charge.description ?? '').trim(),
        unit: charge.unit ? String(charge.unit).trim() : null,
        quantity: Number(charge.quantity),
        unitPrice: Number(charge.unitPrice),
      }))
    : []

  if (
    charges.some(
      (charge: { description: string; quantity: number; unitPrice: number }) =>
        !charge.description || !Number.isFinite(charge.quantity) || charge.quantity <= 0 || !Number.isFinite(charge.unitPrice) || charge.unitPrice <= 0,
    )
  ) {
    return NextResponse.json({ error: 'Lignes de frais invalides.' }, { status: 400 })
  }

  if (
    !Number.isFinite(vehicleId) ||
    (!clientId && !clientName) ||
    !startDate ||
    !Number.isFinite(days) ||
    days <= 0 ||
    (dailyRateOverride !== undefined && (!Number.isFinite(dailyRateOverride) || dailyRateOverride <= 0))
  ) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  try {
    const rental = await createRental({
      vehicleId,
      clientId,
      clientName,
      clientPhone: body.clientPhone ? String(body.clientPhone).trim() : undefined,
      startDate,
      days,
      dailyRateOverride,
      departureCity,
      destinationCity,
      charges,
    })
    return NextResponse.json({ rental }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
