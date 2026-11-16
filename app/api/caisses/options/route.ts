import { NextResponse } from 'next/server'
import { getCashAccountOptions } from '@/lib/db/queries'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function GET() {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const accounts = await getCashAccountOptions()
  return NextResponse.json({ accounts })
}
