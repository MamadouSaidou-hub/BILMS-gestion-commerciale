import { notFound } from 'next/navigation'
import { RentalClientDetailView } from '@/components/rental-client-detail-view'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const clientId = Number(id)
  if (!Number.isFinite(clientId)) notFound()

  return <RentalClientDetailView clientId={clientId} />
}
