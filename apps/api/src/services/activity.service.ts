import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'
import type { ActivityBatch } from '../validators/index.ts'

const a = schema.activitySamples

/**
 * Which programs the desktop app saw in the foreground. Everything is private to the person it
 * belongs to: there is deliberately no team-wide view of window titles.
 */
export function createActivityService(db: Db) {
  const mine = (userId: string, range: { from?: Date; to?: Date }) =>
    and(eq(a.userId, userId), range.from ? gte(a.startedAt, range.from) : undefined, range.to ? lt(a.startedAt, range.to) : undefined)

  return {
    /** Stores a batch. Samples already stored (same id) are skipped, so a retried upload is safe. */
    async ingest(userId: string, batch: ActivityBatch) {
      const rows = batch.samples.map((s) => ({
        id: s.id,
        userId,
        app: s.app,
        title: s.title,
        startedAt: s.startedAt,
        seconds: s.seconds,
      }))
      const inserted = await db.insert(a).values(rows).onConflictDoNothing().returning({ id: a.id })
      return { received: rows.length, stored: inserted.length }
    },

    async summary(userId: string, range: { from?: Date; to?: Date }) {
      const byApp = await db
        .select({ app: a.app, seconds: sql<number>`sum(${a.seconds})::int` })
        .from(a)
        .where(mine(userId, range))
        .groupBy(a.app)
        .orderBy(desc(sql`sum(${a.seconds})`))
      const recent = await db
        .select({ app: a.app, title: a.title, startedAt: a.startedAt, seconds: a.seconds })
        .from(a)
        .where(mine(userId, range))
        .orderBy(desc(a.startedAt))
        .limit(30)
      return { totalSeconds: byApp.reduce((s, r) => s + r.seconds, 0), byApp, recent }
    },

    /** Privacy control: forget everything the desktop app recorded for this person. */
    async clear(userId: string) {
      const gone = await db.delete(a).where(eq(a.userId, userId)).returning({ id: a.id })
      return { deleted: gone.length }
    },
  }
}

export type ActivityService = ReturnType<typeof createActivityService>
