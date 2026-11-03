import { notFound } from 'next/navigation'
import { TenantDetailView } from '@/components/tenant-detail-view'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tenantId = Number(id)
  if (!Number.isFinite(tenantId)) notFound()

  return <TenantDetailView tenantId={tenantId} />
}
