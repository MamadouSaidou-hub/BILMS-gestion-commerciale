import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { clients } from '@/lib/db/schema'
import { createClient, updateClient } from '@/lib/db/mutations/clients'

const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const clientIds: number[] = []

afterAll(async () => {
  for (const id of clientIds) {
    await db.delete(clients).where(eq(clients.id, id))
  }
})

describe('createClient', () => {
  it('stores zone and reference when provided', async () => {
    const client = await createClient({ name: `Client ${runId}`, zone: 'Madina', reference: 'CL-01' })
    clientIds.push(client.id)
    expect(client.zone).toBe('Madina')
    expect(client.reference).toBe('CL-01')
  })

  it('defaults zone and reference to null when omitted', async () => {
    const client = await createClient({ name: `Client sans zone ${runId}` })
    clientIds.push(client.id)
    expect(client.zone).toBeNull()
    expect(client.reference).toBeNull()
  })
})

describe('updateClient', () => {
  it('updates zone and reference on an existing client', async () => {
    const client = await createClient({ name: `Client à corriger ${runId}`, zone: 'Madina' })
    clientIds.push(client.id)

    const updated = await updateClient(client.id, { zone: 'Matam', reference: 'CL-02' })
    expect(updated.zone).toBe('Matam')
    expect(updated.reference).toBe('CL-02')
  })
})
