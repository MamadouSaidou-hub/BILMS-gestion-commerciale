import { NextResponse } from 'next/server'
import { recordRentPayment } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const leaseId = Number(id)
  const body = await request.json()

  const period = String(body.period ?? '').trim()
  const status = body.status as 'paid' | 'late' | 'unpaid'

  if (!Number.isFinite(leaseId) || !/^\d{4}-\d{2}$/.test(period) || !['paid', 'late', 'unpaid'].includes(status)) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  try {
    const payment = await recordRentPayment({ leaseId, period, status })
    return NextResponse.json({ payment })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
