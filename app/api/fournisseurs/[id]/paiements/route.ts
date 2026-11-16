import { NextResponse } from 'next/server'
import { recordSupplierPayment } from '@/lib/db/mutations'
import { getSupplierPaymentHistory } from '@/lib/db/queries'
import { toApiErrorMessage } from '@/lib/api-error'
import { isValidDateString } from '@/lib/dates'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const supplierId = Number(id)
  if (!Number.isFinite(supplierId)) return NextResponse.json({ error: 'Fournisseur invalide.' }, { status: 400 })

  const payments = await getSupplierPaymentHistory(supplierId)
  return NextResponse.json({ payments })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const supplierId = Number(id)
  const body = await request.json()
  const amount = Number(body.amount)
  const method = body.method as 'cash' | 'mobile_money' | 'bank_transfer' | 'check'
  const date = body.date ? String(body.date) : undefined
  const cashAccountId = body.cashAccountId !== undefined && body.cashAccountId !== null && body.cashAccountId !== '' ? Number(body.cashAccountId) : undefined

  if (!Number.isFinite(supplierId) || !Number.isFinite(amount) || amount <= 0 || !['cash', 'mobile_money', 'bank_transfer', 'check'].includes(method)) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }
  if (cashAccountId !== undefined && !Number.isFinite(cashAccountId)) {
    return NextResponse.json({ error: 'Caisse invalide.' }, { status: 400 })
  }
  if (date !== undefined && !isValidDateString(date)) {
    return NextResponse.json({ error: 'Date invalide.' }, { status: 400 })
  }

  try {
    await recordSupplierPayment({ supplierId, amount, method, date, cashAccountId })
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
