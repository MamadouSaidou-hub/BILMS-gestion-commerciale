import { eq } from 'drizzle-orm'
import { db } from '../client'
import { clients } from '../schema'

export async function createClient(input: { name: string; phone?: string; storeId?: number | null; zone?: string | null; reference?: string | null }) {
  const [client] = await db
    .insert(clients)
    .values({
      name: input.name,
      phone: input.phone ?? null,
      storeId: input.storeId ?? null,
      zone: input.zone ?? null,
      reference: input.reference ?? null,
    })
    .returning()
  return client
}

export async function updateClient(id: number, input: { name?: string; phone?: string | null; zone?: string | null; reference?: string | null }) {
  const [client] = await db
    .update(clients)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.zone !== undefined ? { zone: input.zone } : {}),
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
    })
    .where(eq(clients.id, id))
    .returning()
  return client
}
