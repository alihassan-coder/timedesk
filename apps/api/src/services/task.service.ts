import { and, eq, isNull, ne } from 'drizzle-orm'
import { nextDue } from '@timedesk/shared'
import { schema, type Db } from '@timedesk/db'
import { conflict, notFound, unprocessable } from '../utils/errors.ts'
import type { SessionUser } from '../types.ts'
import type { CreateTask, UpdateTask } from '../validators/index.ts'

const t = schema.tasks
const p = schema.projects
type Task = typeof schema.tasks.$inferSelect

/** Called after a task changes, so something else (Google Calendar) can follow. Failures there must never fail the task. */
export interface TaskHooks {
  changed(userId: string, task: Task): Promise<void>
  removed(userId: string, taskId: string): Promise<void>
}

/**
 * How long a task save waits for its hooks. Mirroring to Google can take many seconds when Google is slow; the task is
 * saved already, so after this the answer goes back and the mirror finishes on its own (or the next "Sync now" catches
 * up). There is no waitUntil on this platform setup, so the hook is still awaited, just never for long.
 */
const HOOK_WAIT_MS = 5_000

const settle = async (work: Promise<void> | undefined) => {
  if (!work) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, HOOK_WAIT_MS)
  })
  try {
    await Promise.race([work.catch(() => {}), late])
  } finally {
    clearTimeout(timer)
  }
}

export function createTaskService(db: Db, hooks?: TaskHooks) {
  const owned = (userId: string, id: string) => and(eq(t.id, id), eq(t.userId, userId), isNull(t.deletedAt))

  /** A task may only point at one of this person's own projects that still exists. */
  const projectIsLive = async (userId: string, projectId: string) =>
    (await db.select({ id: p.id }).from(p).where(and(eq(p.id, projectId), eq(p.userId, userId), isNull(p.deletedAt)))).length > 0
  const requireProject = async (userId: string, projectId: string) => {
    if (!(await projectIsLive(userId, projectId))) throw unprocessable('That project does not exist.', [{ path: 'projectId', message: 'Unknown project.' }])
  }

  return {
    list: (userId: string, status?: string) =>
      db.select().from(t).where(and(eq(t.userId, userId), isNull(t.deletedAt), status ? eq(t.status, status) : undefined)),

    /** Safe to send twice (an app that was offline retries): the same id returns the task that is already there. */
    async create(user: SessionUser, input: CreateTask) {
      const id = input.id ?? crypto.randomUUID()
      if (input.projectId && !(await projectIsLive(user.id, input.projectId))) {
        // A retry of a task saved before its project was deleted still gets that task back.
        const [existing] = input.id ? await db.select().from(t).where(and(eq(t.id, id), eq(t.userId, user.id))) : []
        if (existing) return existing
        await requireProject(user.id, input.projectId)
      }
      const [row] = await db
        .insert(t)
        .values({ ...input, id, userId: user.id, workspaceId: user.id, completedAt: input.status === 'done' ? new Date() : null })
        .onConflictDoNothing()
        .returning()
      if (!row) {
        const [existing] = await db.select().from(t).where(eq(t.id, id))
        if (existing?.userId !== user.id) throw conflict('That id is already used.')
        return existing
      }
      await settle(hooks?.changed(user.id, row))
      return row
    },

    /**
     * Completing a recurring task with a due date schedules the next occurrence, exactly once: only the request that
     * really moves the task from open to done (a conditional update) does it, so a double click or two devices
     * completing it together never make two next occurrences.
     */
    async update(userId: string, id: string, patch: UpdateTask) {
      if (patch.projectId) await requireProject(userId, patch.projectId)
      const now = new Date()
      let row: Task | undefined
      let completedNow = false
      if (patch.status === 'done') {
        // Remember when it was finished (for summaries and reviews).
        ;[row] = await db
          .update(t)
          .set({ ...patch, completedAt: now, updatedAt: now })
          .where(and(owned(userId, id), ne(t.status, 'done')))
          .returning()
        completedNow = row !== undefined
      }
      if (!row) {
        // Already done (keep when it was finished), or not about completing: reopening forgets when it was finished.
        const completedAt = patch.status === undefined || patch.status === 'done' ? {} : { completedAt: null }
        ;[row] = await db
          .update(t)
          .set({ ...patch, ...completedAt, updatedAt: now })
          .where(owned(userId, id))
          .returning()
      }
      if (!row) throw notFound('Task') // deleted meanwhile, or never this person's

      await settle(hooks?.changed(userId, row))

      if (completedNow && row.recurrence && row.due) {
        const [next] = await db
          .insert(t)
          .values({
            id: crypto.randomUUID(),
            userId,
            workspaceId: row.workspaceId,
            projectId: row.projectId,
            title: row.title,
            priority: row.priority,
            status: 'todo',
            due: nextDue(row.due, row.recurrence),
            recurrence: row.recurrence,
          })
          .returning()
        await settle(hooks?.changed(userId, next))
      }
      return row
    },

    async remove(userId: string, id: string) {
      const now = new Date()
      const [row] = await db.update(t).set({ deletedAt: now, updatedAt: now }).where(owned(userId, id)).returning({ id: t.id })
      if (!row) throw notFound('Task')
      await settle(hooks?.removed(userId, id))
    },
  }
}

export type TaskService = ReturnType<typeof createTaskService>
