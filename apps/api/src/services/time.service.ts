import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'
import { conflict } from '../utils/errors.ts'
import type { SessionUser } from '../types.ts'
import type { StartTimer } from '../validators/index.ts'

const e = schema.timeEntries

/** A user has at most one running timer; starting a new one stops the old one first. */
export function createTimeService(db: Db) {
  const running = (userId: string) => and(eq(e.userId, userId), isNull(e.endedAt), isNull(e.deletedAt))

  return {
    list: (userId: string, range: { from?: Date; to?: Date }) =>
      db
        .select()
        .from(e)
        .where(and(eq(e.userId, userId), isNull(e.deletedAt), range.from ? gte(e.startedAt, range.from) : undefined, range.to ? lt(e.startedAt, range.to) : undefined))
        .orderBy(desc(e.startedAt)),

    async running(userId: string) {
      const [row] = await db.select().from(e).where(running(userId))
      return row ?? null
    },

    async start(user: SessionUser, input: StartTimer) {
      const now = new Date()
      await db.update(e).set({ endedAt: now, updatedAt: now }).where(running(user.id))
      const [row] = await db
        .insert(e)
        .values({ id: crypto.randomUUID(), userId: user.id, workspaceId: user.id, taskId: input.taskId, projectId: input.projectId, startedAt: now })
        .returning()
      return row
    },

    async stop(userId: string) {
      const now = new Date()
      const [row] = await db.update(e).set({ endedAt: now, updatedAt: now }).where(running(userId)).returning()
      if (!row) throw conflict('No timer is running.')
      return row
    },
  }
}

export type TimeService = ReturnType<typeof createTimeService>
