import { NextRequest, NextResponse } from 'next/server'
import { getRentalClientsOverview } from '@/lib/db/queries'
import { createRentalClient } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'
import { csvResponse } from '@/lib/csv'

export async function GET(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const data = await getRentalClientsOverview()

  if (request.nextUrl.searchParams.get('format') === 'csv') {
    return csvResponse(
      data.clients,
      [
        { key: 'name', label: 'Client' },
        { key: 'phone', label: 'Téléphone' },
        { key: 'rentalsCount', label: 'Nombre de locations' },
        { key: 'totalPaid', label: 'Encaissé au total' },
      ],
      'clients-location.csv',
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
    return NextResponse.json({ error: 'Le nom du client est requis.' }, { status: 400 })
  }

  try {
    const client = await createRentalClient({ name, phone: body.phone ? String(body.phone).trim() : undefined })
    return NextResponse.json({ client }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
