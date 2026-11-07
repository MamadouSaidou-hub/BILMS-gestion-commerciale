import { notFound } from 'next/navigation'
import { getSessionContext, isAdmin } from '@/lib/session'
import { ImmoView } from '@/components/immo-view'

export default async function Page() {
  const ctx = await getSessionContext()
  if (!ctx || !isAdmin(ctx)) notFound()
  return <ImmoView />
}
