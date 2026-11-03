import { NextResponse } from 'next/server'
import { getTenantDetail } from '@/lib/db/queries'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const tenantId = Number(id)
  if (!Number.isFinite(tenantId)) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 })
  }

  const tenant = await getTenantDetail(tenantId)
  if (!tenant) {
    return NextResponse.json({ error: 'Locataire introuvable.' }, { status: 404 })
  }

  return NextResponse.json({ tenant })
}
