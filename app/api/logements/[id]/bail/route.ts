import { NextResponse } from 'next/server'
import { createLease } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const unitId = Number(id)
  const body = await request.json()

  const tenantId = body.tenantId !== undefined && body.tenantId !== null && body.tenantId !== '' ? Number(body.tenantId) : undefined
  const tenantName = body.tenantName ? String(body.tenantName).trim() : undefined
  const startDate = String(body.startDate ?? '').trim()
  const months = Number(body.months)
  const depositAmount = body.depositAmount !== undefined && body.depositAmount !== '' ? Number(body.depositAmount) : undefined

  if (!Number.isFinite(unitId) || (!tenantId && !tenantName) || !startDate || !Number.isFinite(months) || months <= 0) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }
  if (depositAmount !== undefined && (!Number.isFinite(depositAmount) || depositAmount < 0)) {
    return NextResponse.json({ error: 'Caution invalide.' }, { status: 400 })
  }

  const noticeMonths = body.noticeMonths !== undefined && body.noticeMonths !== '' ? Number(body.noticeMonths) : undefined
  const latePenaltyPct = body.latePenaltyPct !== undefined && body.latePenaltyPct !== '' ? Number(body.latePenaltyPct) : undefined

  try {
    const lease = await createLease({
      unitId,
      tenantId,
      tenantName,
      tenantPhone: body.tenantPhone ? String(body.tenantPhone).trim() : undefined,
      startDate,
      months,
      depositAmount,
      noticeMonths,
      latePenaltyPct,
      guarantorName: body.guarantorName ? String(body.guarantorName).trim() : undefined,
      guarantorPhone: body.guarantorPhone ? String(body.guarantorPhone).trim() : undefined,
      guarantorEmail: body.guarantorEmail ? String(body.guarantorEmail).trim() : undefined,
      guarantorResidence: body.guarantorResidence ? String(body.guarantorResidence).trim() : undefined,
      guarantorNationality: body.guarantorNationality ? String(body.guarantorNationality).trim() : undefined,
      guarantorCin: body.guarantorCin ? String(body.guarantorCin).trim() : undefined,
      guarantorCinValidUntil: body.guarantorCinValidUntil ? String(body.guarantorCinValidUntil).trim() : undefined,
    })
    return NextResponse.json({ lease }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
