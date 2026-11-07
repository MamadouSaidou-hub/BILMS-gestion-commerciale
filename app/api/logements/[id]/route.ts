import { NextResponse } from 'next/server'
import { updateUnitRent } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const unitId = Number(id)
  const body = await request.json()
  const monthlyRent = Number(body.monthlyRent)

  if (!Number.isFinite(unitId) || !Number.isFinite(monthlyRent) || monthlyRent <= 0) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  try {
    const unit = await updateUnitRent(unitId, monthlyRent)
    return NextResponse.json({ unit })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
