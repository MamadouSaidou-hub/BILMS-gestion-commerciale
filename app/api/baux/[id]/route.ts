import { NextResponse } from 'next/server'
import { updateLeaseContractTerms } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  const leaseId = Number(id)
  if (!Number.isFinite(leaseId)) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 })
  }

  const body = await request.json()

  try {
    const lease = await updateLeaseContractTerms(leaseId, {
      noticeMonths: body.noticeMonths !== undefined && body.noticeMonths !== '' ? Number(body.noticeMonths) : undefined,
      latePenaltyPct: body.latePenaltyPct !== undefined && body.latePenaltyPct !== '' ? Number(body.latePenaltyPct) : undefined,
      guarantorName: body.guarantorName !== undefined ? (body.guarantorName ? String(body.guarantorName).trim() : null) : undefined,
      guarantorPhone: body.guarantorPhone !== undefined ? (body.guarantorPhone ? String(body.guarantorPhone).trim() : null) : undefined,
      guarantorEmail: body.guarantorEmail !== undefined ? (body.guarantorEmail ? String(body.guarantorEmail).trim() : null) : undefined,
      guarantorResidence: body.guarantorResidence !== undefined ? (body.guarantorResidence ? String(body.guarantorResidence).trim() : null) : undefined,
      guarantorNationality: body.guarantorNationality !== undefined ? (body.guarantorNationality ? String(body.guarantorNationality).trim() : null) : undefined,
      guarantorCin: body.guarantorCin !== undefined ? (body.guarantorCin ? String(body.guarantorCin).trim() : null) : undefined,
      guarantorCinValidUntil: body.guarantorCinValidUntil !== undefined ? (body.guarantorCinValidUntil ? String(body.guarantorCinValidUntil).trim() : null) : undefined,
    })
    return NextResponse.json({ lease })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}
