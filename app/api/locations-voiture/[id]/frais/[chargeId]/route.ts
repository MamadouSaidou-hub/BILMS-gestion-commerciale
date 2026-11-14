import { NextResponse } from 'next/server'
import { removeRentalCharge } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; chargeId: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { chargeId } = await params
  const id = Number(chargeId)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Ligne invalide.' }, { status: 400 })

  try {
    await removeRentalCharge(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
