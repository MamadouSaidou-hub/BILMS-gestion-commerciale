import { NextResponse } from 'next/server'
import { endLease } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const leaseId = Number(id)
  if (!Number.isFinite(leaseId)) {
    return NextResponse.json({ error: 'Bail invalide.' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const depositReturnedAmount = body.depositReturnedAmount !== undefined && body.depositReturnedAmount !== '' ? Number(body.depositReturnedAmount) : undefined

  try {
    const lease = await endLease(leaseId, {
      depositReturnedAmount,
      depositNotes: body.depositNotes ? String(body.depositNotes).trim() : undefined,
    })
    return NextResponse.json({ lease })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
