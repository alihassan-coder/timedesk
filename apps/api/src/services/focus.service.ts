import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { summarizeFocus } from '@timedesk/shared'
import { schema, type Db } from '@timedesk/db'
import type { FocusBatch } from '../validators/index.ts'

const f = schema.focusSessions

/** Focus guard sessions, uploaded by the desktop app. Private to the person they belong to. */
export function createFocusService(db: Db) {
  const mine = (userId: string, range: { from?: Date; to?: Date }) =>
    and(eq(f.userId, userId), range.from ? gte(f.startedAt, range.from) : undefined, range.to ? lt(f.startedAt, range.to) : undefined)

  const list = (userId: string, range: { from?: Date; to?: Date }, limit = 500) =>
    db
      .select({
        id: f.id,
        startedAt: f.startedAt,
        endedAt: f.endedAt,
        label: f.label,
        focusedSeconds: f.focusedSeconds,
        distractedSeconds: f.distractedSeconds,
        awaySeconds: f.awaySeconds,
        interruptions: f.interruptions,
        distractions: f.distractions,
      })
      .from(f)
      .where(mine(userId, range))
      .orderBy(desc(f.startedAt))
      .limit(limit)

  return {
    /** Stores a batch. Sessions already stored (same id) are skipped, so a retried upload is safe. */
    async ingest(userId: string, batch: FocusBatch) {
      const rows = batch.sessions.map((s) => ({ ...s, userId }))
      const inserted = await db.insert(f).values(rows).onConflictDoNothing().returning({ id: f.id })
      return { received: rows.length, stored: inserted.length }
    },

    list,

    /** Totals, the score and the top distractions for a range (sessions that started in it). */
    async summary(userId: string, range: { from?: Date; to?: Date }) {
      return summarizeFocus(await list(userId, range, 5000))
    },

    /** Privacy control: forget every focus session. */
    async clear(userId: string) {
      const gone = await db.delete(f).where(eq(f.userId, userId)).returning({ id: f.id })
      return { deleted: gone.length }
    },
  }
}

export type FocusService = ReturnType<typeof createFocusService>
