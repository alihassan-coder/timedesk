import { and, eq, isNull } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'
import { notFound } from '../utils/errors.ts'
import type { SessionUser } from '../types.ts'
import type { CreateTask, UpdateTask } from '../validators/index.ts'

const t = schema.tasks

export function createTaskService(db: Db) {
  const owned = (userId: string, id: string) => and(eq(t.id, id), eq(t.userId, userId), isNull(t.deletedAt))

  return {
    list: (userId: string, status?: string) =>
      db.select().from(t).where(and(eq(t.userId, userId), isNull(t.deletedAt), status ? eq(t.status, status) : undefined)),

    async create(user: SessionUser, input: CreateTask) {
      const [row] = await db
        .insert(t)
        .values({ ...input, id: input.id ?? crypto.randomUUID(), userId: user.id, workspaceId: user.id })
        .returning()
      return row
    },

    async update(userId: string, id: string, patch: UpdateTask) {
      const [row] = await db.update(t).set({ ...patch, updatedAt: new Date() }).where(owned(userId, id)).returning()
      if (!row) throw notFound('Task')
      return row
    },

    async remove(userId: string, id: string) {
      const now = new Date()
      const [row] = await db.update(t).set({ deletedAt: now, updatedAt: now }).where(owned(userId, id)).returning({ id: t.id })
      if (!row) throw notFound('Task')
    },
  }
}

export type TaskService = ReturnType<typeof createTaskService>
