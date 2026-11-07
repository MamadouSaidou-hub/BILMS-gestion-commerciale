import { notFound } from 'next/navigation'
import { getSessionContext, isAdmin } from '@/lib/session'
import { LocationReportsView } from '@/components/location-reports-view'

export default async function Page() {
  const ctx = await getSessionContext()
  if (!ctx || !isAdmin(ctx)) notFound()
  return <LocationReportsView />
}
