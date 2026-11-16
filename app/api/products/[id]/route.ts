import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { updateProduct } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const id = Number((await params).id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 })

  const [product] = await db
    .select({ id: products.id, name: products.name, sku: products.sku, unitPrice: products.unitPrice, costPrice: products.costPrice })
    .from(products)
    .where(eq(products.id, id))
  if (!product) return NextResponse.json({ error: 'Article introuvable.' }, { status: 404 })

  return NextResponse.json({ product })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const id = Number((await params).id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 })

  const body = await request.json()
  const unitPrice = body.unitPrice !== undefined && body.unitPrice !== null && body.unitPrice !== '' ? Number(body.unitPrice) : undefined
  const costPrice = body.costPrice !== undefined && body.costPrice !== null && body.costPrice !== '' ? Number(body.costPrice) : undefined

  if ((unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice <= 0)) || (costPrice !== undefined && (!Number.isFinite(costPrice) || costPrice < 0))) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  try {
    const product = await updateProduct(id, { unitPrice, costPrice })
    if (!product) return NextResponse.json({ error: 'Article introuvable.' }, { status: 404 })
    return NextResponse.json({ product })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
