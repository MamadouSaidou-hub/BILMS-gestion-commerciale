import { NextRequest, NextResponse } from 'next/server'
import { getStockOverview, getStoreOptions } from '@/lib/db/queries'
import { recordStockReception } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { isValidDateString } from '@/lib/dates'
import { effectiveStoreParam, getSessionContext, isAdmin, scopedStoreList } from '@/lib/session'
import { csvResponse } from '@/lib/csv'

export async function GET(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const store = effectiveStoreParam(ctx, request.nextUrl.searchParams.get('store'))
  const [data, storeOptions] = await Promise.all([getStockOverview(store), getStoreOptions()])

  if (request.nextUrl.searchParams.get('format') === 'csv') {
    return csvResponse(
      data.items,
      [
        { key: 'name', label: 'Produit' },
        { key: 'sku', label: 'SKU' },
        { key: 'category', label: 'Catégorie' },
        { key: 'store', label: 'Magasin' },
        { key: 'quantity', label: 'Quantité' },
        { key: 'threshold', label: 'Seuil' },
        { key: 'unitPrice', label: 'Prix unitaire' },
        { key: 'status', label: 'Statut' },
      ],
      'stock.csv',
    )
  }

  return NextResponse.json({
    ...data,
    stores: scopedStoreList(ctx, storeOptions.map((row) => row.name)),
  })
}

export async function POST(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const body = await request.json()
  const storeId = Number(body.storeId)
  const date = body.date ? String(body.date) : undefined
  const rawItems = Array.isArray(body.items) ? body.items : []
  const items = rawItems.map((item: { productId: unknown; quantity: unknown }) => ({
    productId: Number(item.productId),
    quantity: Number(item.quantity),
  }))

  if (
    !Number.isFinite(storeId) ||
    items.length === 0 ||
    items.some((item: { productId: number; quantity: number }) => !Number.isFinite(item.productId) || !Number.isFinite(item.quantity) || item.quantity <= 0)
  ) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }
  if (date !== undefined && !isValidDateString(date)) {
    return NextResponse.json({ error: 'Date invalide.' }, { status: 400 })
  }

  if (!isAdmin(ctx) && ctx.storeId !== storeId) {
    return NextResponse.json({ error: 'Ce magasin n’est pas le vôtre.' }, { status: 403 })
  }

  try {
    await recordStockReception({ storeId, items, reference: body.reference ? String(body.reference) : undefined, date })
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
