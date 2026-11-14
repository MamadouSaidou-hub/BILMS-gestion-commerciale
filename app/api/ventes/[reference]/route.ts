import { NextRequest, NextResponse } from 'next/server'
import { getSaleForEdit } from '@/lib/db/queries'
import { updateSale } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { reference } = await params
  const sale = await getSaleForEdit(reference)
  if (!sale) return NextResponse.json({ error: 'Vente introuvable.' }, { status: 404 })
  return NextResponse.json({ sale })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { reference } = await params
  const body = await request.json()
  const storeId = Number(body.storeId)
  const paymentStatus = body.paymentStatus as 'paid' | 'partial' | 'credit'
  const items = Array.isArray(body.items) ? body.items : []

  if (!Number.isFinite(storeId) || !['paid', 'partial', 'credit'].includes(paymentStatus) || items.length === 0) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  const parsedItems = items.map((item: { productId: unknown; quantity: unknown; unitPrice: unknown }) => ({
    productId: Number(item.productId),
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
  }))

  if (
    parsedItems.some(
      (item: { productId: number; quantity: number; unitPrice: number }) =>
        !Number.isFinite(item.productId) || !Number.isFinite(item.unitPrice) || item.unitPrice < 0 || !Number.isFinite(item.quantity) || item.quantity <= 0,
    )
  ) {
    return NextResponse.json({ error: 'Lignes d’articles invalides.' }, { status: 400 })
  }

  const saleDate = typeof body.saleDate === 'string' && body.saleDate.trim() ? body.saleDate : null
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined
  const paidNow = Number(body.paidNow ?? 0)
  const dueInDays = Number(body.dueInDays ?? 15)
  const total = parsedItems.reduce((sum: number, item: { quantity: number; unitPrice: number }) => sum + item.quantity * item.unitPrice, 0)

  if (!Number.isFinite(paidNow) || paidNow < 0 || paidNow > total) {
    return NextResponse.json({ error: 'Montant payé invalide.' }, { status: 400 })
  }
  if (!Number.isFinite(dueInDays) || dueInDays < 0 || dueInDays > 365) {
    return NextResponse.json({ error: 'Échéance invalide.' }, { status: 400 })
  }

  try {
    const sale = await updateSale(
      reference,
      {
        storeId,
        clientId: body.clientId ? Number(body.clientId) : null,
        paymentStatus,
        paidNow,
        dueInDays,
        saleDate,
        items: parsedItems,
      },
      { userId: ctx.userId, userName: ctx.userName },
      reason,
    )
    return NextResponse.json({ sale })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
