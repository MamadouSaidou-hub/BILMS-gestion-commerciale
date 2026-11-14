import { db } from '../client'
import { auditLog } from '../schema'

type Insertable = Pick<typeof db, 'insert'>

export type Actor = { userId: string; userName: string }

/** Shared audit-trail writer for every entity that supports admin edit/delete — see
 * schema.ts's `auditLog` table comment for why this is one generic table instead of a
 * bespoke log per entity. */
export async function writeAuditLog(
  tx: Insertable,
  input: {
    entityType: string
    entityId: number
    action: 'update' | 'delete'
    actor: Actor
    reason?: string
    beforeData: unknown
    afterData?: unknown
  },
) {
  await tx.insert(auditLog).values({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorId: input.actor.userId,
    actorName: input.actor.userName,
    reason: input.reason ?? null,
    beforeData: input.beforeData,
    afterData: input.afterData ?? null,
  })
}
