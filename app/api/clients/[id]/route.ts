import { NextRequest, NextResponse } from 'next/server'
import { updateClient } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const clientId = Number(id)
  if (!Number.isFinite(clientId)) return NextResponse.json({ error: 'Client invalide.' }, { status: 400 })

  const body = await request.json()
  try {
    const client = await updateClient(clientId, {
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      phone: body.phone !== undefined ? (body.phone ? String(body.phone).trim() : null) : undefined,
      zone: body.zone !== undefined ? (body.zone ? String(body.zone).trim() : null) : undefined,
      reference: body.reference !== undefined ? (body.reference ? String(body.reference).trim() : null) : undefined,
    })
    return NextResponse.json({ client })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
