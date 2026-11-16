import { NextResponse } from 'next/server'
import { recordSupplierDelivery } from '@/lib/db/mutations'
import { getSupplierDeliveryHistory } from '@/lib/db/queries'
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

  const deliveries = await getSupplierDeliveryHistory(supplierId)
  return NextResponse.json({ deliveries })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const supplierId = Number(id)
  const body = await request.json()

  const storeId = Number(body.storeId)
  const paymentStatus = body.paymentStatus as 'paid' | 'partial' | 'credit'
  const date = body.date ? String(body.date) : undefined
  const rawItems = Array.isArray(body.items) ? body.items : []
  const items = rawItems.map((item: { productId: unknown; sackCount: unknown; tonnage?: unknown }) => ({
    productId: Number(item.productId),
    sackCount: Number(item.sackCount),
    tonnage: item.tonnage ? Number(item.tonnage) : null,
  }))
  const rawCharges = Array.isArray(body.charges) ? body.charges : []
  const charges = rawCharges.map((charge: { description: unknown; quantity: unknown; unitPrice: unknown }) => ({
    description: String(charge.description ?? '').trim(),
    quantity: Number(charge.quantity ?? 1),
    unitPrice: Number(charge.unitPrice),
  }))

  if (
    !Number.isFinite(supplierId) ||
    !Number.isFinite(storeId) ||
    items.length === 0 ||
    items.some((item: { productId: number; sackCount: number }) => !Number.isFinite(item.productId) || !Number.isFinite(item.sackCount) || item.sackCount <= 0) ||
    charges.some((charge: { description: string; unitPrice: number }) => !charge.description || !Number.isFinite(charge.unitPrice) || charge.unitPrice <= 0) ||
    !['paid', 'partial', 'credit'].includes(paymentStatus)
  ) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }
  if (date !== undefined && !isValidDateString(date)) {
    return NextResponse.json({ error: 'Date invalide.' }, { status: 400 })
  }

  try {
    const delivery = await recordSupplierDelivery({
      supplierId,
      storeId,
      items,
      charges,
      reference: body.reference ? String(body.reference) : undefined,
      date,
      paymentStatus,
      paidNow: Number(body.paidNow ?? 0),
      dueInDays: Number(body.dueInDays ?? 30),
    })
    return NextResponse.json({ delivery }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
