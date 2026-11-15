import { NextRequest, NextResponse } from 'next/server'
import { getStoreOptions, getTreasuryOverview } from '@/lib/db/queries'
import { recordPayment } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { isValidDateString } from '@/lib/dates'
import { parsePeriodLabel } from '@/lib/period'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function GET(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const searchParams = request.nextUrl.searchParams
  const period = parsePeriodLabel(searchParams.get('period'), '7d')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const custom = period === 'custom' && from && to ? { from, to } : undefined
  const store = searchParams.get('store')

  const [data, storeOptions] = await Promise.all([getTreasuryOverview(period, store, custom), getStoreOptions()])

  return NextResponse.json({
    ...data,
    stores: ['Tous les magasins', ...storeOptions.map((row) => row.name)],
  })
}

export async function POST(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const body = await request.json()
  const clientId = Number(body.clientId)
  const amount = Number(body.amount)
  const storeId = Number(body.storeId)
  const method = body.method as 'cash' | 'mobile_money' | 'bank_transfer' | 'check'
  const date = body.date ? String(body.date) : undefined

  if (!Number.isFinite(clientId) || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(storeId) || !['cash', 'mobile_money', 'bank_transfer', 'check'].includes(method)) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }
  if (date !== undefined && !isValidDateString(date)) {
    return NextResponse.json({ error: 'Date invalide.' }, { status: 400 })
  }

  if (!isAdmin(ctx) && ctx.storeId !== storeId) {
    return NextResponse.json({ error: 'Ce magasin n’est pas le vôtre.' }, { status: 403 })
  }

  try {
    await recordPayment({ clientId, amount, method, storeId, date })
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
