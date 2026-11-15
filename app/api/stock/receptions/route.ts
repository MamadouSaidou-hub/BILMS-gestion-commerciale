import { NextRequest, NextResponse } from 'next/server'
import { getStockReceptionHistory } from '@/lib/db/queries'
import { effectiveStoreParam, getSessionContext } from '@/lib/session'

export async function GET(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const store = effectiveStoreParam(ctx, request.nextUrl.searchParams.get('store'))
  const receptions = await getStockReceptionHistory(store)
  return NextResponse.json({ receptions })
}
