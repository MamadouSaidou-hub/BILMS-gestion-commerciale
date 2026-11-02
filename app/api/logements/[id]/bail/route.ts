import { NextResponse } from 'next/server'
import { createLease } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const unitId = Number(id)
  const body = await request.json()

  const tenantName = String(body.tenantName ?? '').trim()
  const startDate = String(body.startDate ?? '').trim()
  const months = Number(body.months)

  if (!Number.isFinite(unitId) || !tenantName || !startDate || !Number.isFinite(months) || months <= 0) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  try {
    const lease = await createLease({
      unitId,
      tenantName,
      tenantPhone: body.tenantPhone ? String(body.tenantPhone).trim() : undefined,
      startDate,
      months,
    })
    return NextResponse.json({ lease }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
