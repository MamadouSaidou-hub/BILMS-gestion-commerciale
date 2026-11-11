import { NextResponse } from 'next/server'
import { getTenantDetail } from '@/lib/db/queries'
import { updateTenant } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const tenantId = Number(id)
  if (!Number.isFinite(tenantId)) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 })
  }

  const body = await request.json()

  try {
    const tenant = await updateTenant(tenantId, {
      phone: body.phone !== undefined ? (body.phone ? String(body.phone) : null) : undefined,
      email: body.email !== undefined ? (body.email ? String(body.email) : null) : undefined,
      profession: body.profession !== undefined ? (body.profession ? String(body.profession) : null) : undefined,
      birthDate: body.birthDate !== undefined ? (body.birthDate ? String(body.birthDate) : null) : undefined,
      birthPlace: body.birthPlace !== undefined ? (body.birthPlace ? String(body.birthPlace) : null) : undefined,
      nationality: body.nationality !== undefined ? (body.nationality ? String(body.nationality) : null) : undefined,
      cin: body.cin !== undefined ? (body.cin ? String(body.cin) : null) : undefined,
      cinValidUntil: body.cinValidUntil !== undefined ? (body.cinValidUntil ? String(body.cinValidUntil) : null) : undefined,
    })
    return NextResponse.json({ tenant })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
