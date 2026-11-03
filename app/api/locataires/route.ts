import { NextRequest, NextResponse } from 'next/server'
import { getTenantsOverview } from '@/lib/db/queries'
import { createTenant } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'
import { csvResponse } from '@/lib/csv'

export async function GET(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const data = await getTenantsOverview()

  if (request.nextUrl.searchParams.get('format') === 'csv') {
    return csvResponse(
      data.tenants,
      [
        { key: 'name', label: 'Locataire' },
        { key: 'phone', label: 'Téléphone' },
        { key: 'leasesCount', label: 'Nombre de baux' },
        { key: 'totalPaid', label: 'Encaissé au total' },
      ],
      'locataires.csv',
    )
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const body = await request.json()
  const name = String(body.name ?? '').trim()

  if (!name) {
    return NextResponse.json({ error: 'Le nom du locataire est requis.' }, { status: 400 })
  }

  try {
    const tenant = await createTenant({ name, phone: body.phone ? String(body.phone).trim() : undefined })
    return NextResponse.json({ tenant }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
