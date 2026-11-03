import { NextResponse } from 'next/server'
import { getRentalClientDetail } from '@/lib/db/queries'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const clientId = Number(id)
  if (!Number.isFinite(clientId)) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 })
  }

  const client = await getRentalClientDetail(clientId)
  if (!client) {
    return NextResponse.json({ error: 'Client introuvable.' }, { status: 404 })
  }

  return NextResponse.json({ client })
}
