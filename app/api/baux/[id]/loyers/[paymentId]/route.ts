import { NextResponse } from 'next/server'
import { deleteRentPayment, updateRentPayment } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id: leaseIdParam, paymentId } = await params
  const id = Number(paymentId)
  const leaseId = Number(leaseIdParam)
  if (!Number.isFinite(id) || !Number.isFinite(leaseId)) return NextResponse.json({ error: 'Paiement invalide.' }, { status: 400 })

  const body = await request.json()
  const amount = body.amount !== undefined && body.amount !== null && body.amount !== '' ? Number(body.amount) : undefined
  if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
    return NextResponse.json({ error: 'Montant invalide.' }, { status: 400 })
  }
  const status = ['paid', 'late', 'unpaid'].includes(body.status) ? (body.status as 'paid' | 'late' | 'unpaid') : undefined
  const paidDate = typeof body.paidDate === 'string' ? (body.paidDate.trim() || null) : undefined
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  try {
    const payment = await updateRentPayment(id, leaseId, { amount, status, paidDate }, { userId: ctx.userId, userName: ctx.userName }, reason)
    return NextResponse.json({ payment })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id: leaseIdParam, paymentId } = await params
  const id = Number(paymentId)
  const leaseId = Number(leaseIdParam)
  if (!Number.isFinite(id) || !Number.isFinite(leaseId)) return NextResponse.json({ error: 'Paiement invalide.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  try {
    const payment = await deleteRentPayment(id, leaseId, { userId: ctx.userId, userName: ctx.userName }, reason)
    return NextResponse.json({ payment })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
