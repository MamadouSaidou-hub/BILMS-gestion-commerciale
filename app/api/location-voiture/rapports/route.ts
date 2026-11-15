import { NextRequest, NextResponse } from 'next/server'
import { getLocationReportsOverview } from '@/lib/db/queries'
import { parsePeriodLabel } from '@/lib/period'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function GET(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const period = parsePeriodLabel(request.nextUrl.searchParams.get('period'), 'month')
  const from = request.nextUrl.searchParams.get('from')
  const to = request.nextUrl.searchParams.get('to')
  const custom = period === 'custom' && from && to ? { from, to } : undefined
  const data = await getLocationReportsOverview(period, custom)
  return NextResponse.json(data)
}
