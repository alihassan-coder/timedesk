import { and, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'
import { AppError, conflict, notFound } from '../utils/errors.ts'
import type { SessionUser } from '../types.ts'
import type { CreateEntry, StartTimer } from '../validators/index.ts'

const e = schema.timeEntries

/** How far back an app that was offline may start a timer. Older than this is almost certainly a wrong clock. */
const MAX_BACKDATE_MS = 30 * 86_400_000
/** Clocks on different devices are never exactly the same; a little time in the future is the device's clock, not an error. */
const CLOCK_SLACK_MS = 5 * 60_000

/**
 * Timers. Several may run at once (multitasking). Starting one normally stops the others ("switching"); with
 * `parallel` they keep going. Start and stop are safe to send twice, and accept the time the person really pressed
 * the button, so an app that was offline can send them later.
 */
export function createTimeService(db: Db) {
  const running = (userId: string) => and(eq(e.userId, userId), isNull(e.endedAt), isNull(e.deletedAt))

  /** A time from a device clock, kept within sensible limits instead of being refused (a refused stop would leave a timer running forever). */
  const fromDevice = (at: Date | undefined, now: Date) => {
    if (!at) return now
    if (at.getTime() < now.getTime() - MAX_BACKDATE_MS) throw new AppError(422, 'That time is more than 30 days ago.')
    return at.getTime() > now.getTime() ? now : at
  }

  /** This person's own (not deleted) task and project, so an entry never points at someone else's. */
  async function owned(userId: string, taskId: string | null, projectId: string | null) {
    const ownTask = taskId
      ? (await db.select({ id: schema.tasks.id, projectId: schema.tasks.projectId }).from(schema.tasks).where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId), isNull(schema.tasks.deletedAt))))[0]
      : undefined
    const ownProject = projectId
      ? (await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId), isNull(schema.projects.deletedAt))))[0]
      : undefined
    // A task's time counts for its project when no project is named.
    return { taskId: ownTask?.id ?? null, projectId: ownProject?.id ?? ownTask?.projectId ?? null }
  }

  return {
    list: (userId: string, range: { from?: Date; to?: Date }) =>
      db
        .select()
        .from(e)
        .where(and(eq(e.userId, userId), isNull(e.deletedAt), range.from ? gte(e.startedAt, range.from) : undefined, range.to ? lt(e.startedAt, range.to) : undefined))
        .orderBy(desc(e.startedAt)),

    /** The most recently started running timer, or null. */
    async running(userId: string) {
      const [row] = await db.select().from(e).where(running(userId)).orderBy(desc(e.startedAt)).limit(1)
      return row ?? null
    },

    /** Every running timer, newest first. */
    runningAll: (userId: string) => db.select().from(e).where(running(userId)).orderBy(desc(e.startedAt)),

    async start(user: SessionUser, input: StartTimer) {
      const now = new Date()
      if (input.id) {
        const [same] = await db.select().from(e).where(eq(e.id, input.id))
        if (same) {
          if (same.userId !== user.id) throw conflict('That id is already used.')
          return same // sent twice: it already started
        }
      }
      const startedAt = fromDevice(input.startedAt, now)
      // A timer on a task counts for that task's project when no project is named (Tempo and scripts often name only the task).
      // Only this person's own (not deleted) task and project. Something else, or something deleted on another device
      // while this one was offline, is left out rather than refused, so the tracked time is never lost.
      const own = await owned(user.id, input.taskId, input.projectId)
      if (!input.parallel) {
        // Switching: the timers that were running before this one stop at the moment it started. A timer started
        // later on another device keeps running (both then share that time).
        await db
          .update(e)
          .set({ endedAt: sql`greatest(${e.startedAt}, ${startedAt.toISOString()}::timestamptz)`, updatedAt: now })
          .where(and(running(user.id), lte(e.startedAt, startedAt)))
      }
      const [row] = await db
        .insert(e)
        .values({ id: input.id ?? crypto.randomUUID(), userId: user.id, workspaceId: user.id, ...own, startedAt })
        .returning()
      return row
    },

    /**
     * Adds time afterwards, with its start and end (filling a gap in the day). Safe to send twice: the same id returns
     * the entry already there. It may overlap other time; overlapping time is shared in totals, never counted twice.
     */
    async add(user: SessionUser, input: CreateEntry) {
      const now = new Date()
      const [same] = await db.select().from(e).where(eq(e.id, input.id))
      if (same) {
        if (same.userId !== user.id) throw conflict('That id is already used.')
        return same
      }
      const startedAt = fromDevice(input.startedAt, now)
      const endedAt = fromDevice(input.endedAt, now)
      if (endedAt <= startedAt) throw new AppError(422, 'The end must be after the start.')
      const own = await owned(user.id, input.taskId, input.projectId)
      const [row] = await db.insert(e).values({ id: input.id, userId: user.id, workspaceId: user.id, ...own, startedAt, endedAt }).returning()
      return row
    },

    /**
     * With an id: stops that timer (if it already stopped, nothing changes). Without: stops every running timer and
     * returns the most recent. The end is `endedAt` (never before the timer started, never in the future) or now.
     */
    async stop(userId: string, input: { id?: string; endedAt?: Date } = {}) {
      const now = new Date()
      if (input.id) {
        const [row] = await db.select().from(e).where(and(eq(e.id, input.id), eq(e.userId, userId), isNull(e.deletedAt)))
        if (!row) throw notFound('Timer')
        if (row.endedAt) return row
        const end = new Date(Math.max(row.startedAt.getTime(), fromDevice(input.endedAt, now).getTime()))
        const [done] = await db.update(e).set({ endedAt: end, updatedAt: now }).where(and(eq(e.id, row.id), isNull(e.endedAt))).returning()
        return done ?? (await db.select().from(e).where(eq(e.id, row.id)))[0]
      }

      const current = await db.select().from(e).where(running(userId)).orderBy(desc(e.startedAt))
      if (current.length === 0) throw conflict('No timer is running.')
      const end = input.endedAt ?? now
      if (end.getTime() > now.getTime() + CLOCK_SLACK_MS) throw new AppError(422, 'The end time is in the future.')
      if (end < current[current.length - 1].startedAt && end < current[0].startedAt) throw new AppError(422, 'The end time is before the timer started.')
      const rows = await db
        .update(e)
        .set({ endedAt: sql`greatest(${e.startedAt}, ${end.toISOString()}::timestamptz)`, updatedAt: now })
        .where(running(userId))
        .returning()
      if (rows.length === 0) throw conflict('No timer is running.')
      return rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]
    },
  }
}

export type TimeService = ReturnType<typeof createTimeService>
