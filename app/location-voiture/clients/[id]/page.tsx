import { notFound } from 'next/navigation'
import { getSessionContext, isAdmin } from '@/lib/session'
import { RentalClientDetailView } from '@/components/rental-client-detail-view'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx || !isAdmin(ctx)) notFound()

  const { id } = await params
  const clientId = Number(id)
  if (!Number.isFinite(clientId)) notFound()

  return <RentalClientDetailView clientId={clientId} />
}
