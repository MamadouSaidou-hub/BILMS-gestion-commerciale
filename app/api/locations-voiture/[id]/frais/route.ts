import { NextResponse } from 'next/server'
import { addRentalCharge } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const rentalId = Number(id)
  const body = await request.json()

  const description = String(body.description ?? '').trim()
  const unit = body.unit ? String(body.unit).trim() : null
  const quantity = Number(body.quantity ?? 1)
  const unitPrice = Number(body.unitPrice)

  if (!Number.isFinite(rentalId) || !description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  try {
    const charge = await addRentalCharge(rentalId, { description, unit, quantity, unitPrice })
    return NextResponse.json({ charge }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
