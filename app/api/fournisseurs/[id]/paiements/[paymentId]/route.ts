import { NextResponse } from 'next/server'
import { deleteSupplierPayment, updateSupplierPayment } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { isValidDateString } from '@/lib/dates'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function PATCH(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { paymentId } = await params
  const id = Number(paymentId)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Paiement invalide.' }, { status: 400 })

  const body = await request.json()
  const amount = Number(body.amount)
  const method = body.method as 'cash' | 'mobile_money' | 'bank_transfer' | 'check'
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  const date = body.date ? String(body.date) : null

  if (!Number.isFinite(amount) || amount <= 0 || !['cash', 'mobile_money', 'bank_transfer', 'check'].includes(method)) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }
  if (date !== null && !isValidDateString(date)) {
    return NextResponse.json({ error: 'Date invalide.' }, { status: 400 })
  }

  try {
    const payment = await updateSupplierPayment(id, { amount, method, date }, { userId: ctx.userId, userName: ctx.userName }, reason)
    return NextResponse.json({ payment })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { paymentId } = await params
  const id = Number(paymentId)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Paiement invalide.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  try {
    const payment = await deleteSupplierPayment(id, { userId: ctx.userId, userName: ctx.userName }, reason)
    return NextResponse.json({ payment })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
