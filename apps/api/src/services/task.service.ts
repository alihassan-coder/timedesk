import { and, eq, isNull } from 'drizzle-orm'
import { nextDue } from '@timedesk/shared'
import { schema, type Db } from '@timedesk/db'
import { notFound } from '../utils/errors.ts'
import type { SessionUser } from '../types.ts'
import type { CreateTask, UpdateTask } from '../validators/index.ts'

const t = schema.tasks

/** Called after a task changes, so something else (Google Calendar) can follow. Failures there must never fail the task. */
export interface TaskHooks {
  changed(userId: string, task: typeof schema.tasks.$inferSelect): Promise<void>
  removed(userId: string, taskId: string): Promise<void>
}

export function createTaskService(db: Db, hooks?: TaskHooks) {
  const owned = (userId: string, id: string) => and(eq(t.id, id), eq(t.userId, userId), isNull(t.deletedAt))

  return {
    list: (userId: string, status?: string) =>
      db.select().from(t).where(and(eq(t.userId, userId), isNull(t.deletedAt), status ? eq(t.status, status) : undefined)),

    async create(user: SessionUser, input: CreateTask) {
      const [row] = await db
        .insert(t)
        .values({ ...input, id: input.id ?? crypto.randomUUID(), userId: user.id, workspaceId: user.id })
        .returning()
      await hooks?.changed(user.id, row)
      return row
    },

    /** Completing a recurring task with a due date schedules the next occurrence. */
    async update(userId: string, id: string, patch: UpdateTask) {
      const [before] = await db.select().from(t).where(owned(userId, id))
      if (!before) throw notFound('Task')
      const [row] = await db.update(t).set({ ...patch, updatedAt: new Date() }).where(owned(userId, id)).returning()

      await hooks?.changed(userId, row)

      if (patch.status === 'done' && before.status !== 'done' && before.recurrence && before.due) {
        const [next] = await db.insert(t).values({
          id: crypto.randomUUID(),
          userId,
          workspaceId: before.workspaceId,
          projectId: before.projectId,
          title: before.title,
          priority: before.priority,
          status: 'todo',
          due: nextDue(before.due, before.recurrence),
          recurrence: before.recurrence,
        }).returning()
        await hooks?.changed(userId, next)
      }
      return row
    },

    async remove(userId: string, id: string) {
      const now = new Date()
      const [row] = await db.update(t).set({ deletedAt: now, updatedAt: now }).where(owned(userId, id)).returning({ id: t.id })
      if (!row) throw notFound('Task')
      await hooks?.removed(userId, id)
    },
  }
}

export type TaskService = ReturnType<typeof createTaskService>
