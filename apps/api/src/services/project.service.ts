import { and, eq, isNull } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'
import { notFound } from '../utils/errors.ts'
import type { SessionUser } from '../types.ts'
import type { CreateProject, UpdateProject } from '../validators/index.ts'

const p = schema.projects
const tasksTable = schema.tasks
const entriesTable = schema.timeEntries

export function createProjectService(db: Db) {
  const owned = (userId: string, id: string) => and(eq(p.id, id), eq(p.userId, userId), isNull(p.deletedAt))

  return {
    list: (userId: string) => db.select().from(p).where(and(eq(p.userId, userId), isNull(p.deletedAt))),

    async create(user: SessionUser, input: CreateProject) {
      const [row] = await db
        .insert(p)
        .values({ ...input, id: input.id ?? crypto.randomUUID(), userId: user.id, workspaceId: user.id })
        .returning()
      return row
    },

    async update(userId: string, id: string, patch: UpdateProject) {
      const [row] = await db.update(p).set({ ...patch, updatedAt: new Date() }).where(owned(userId, id)).returning()
      if (!row) throw notFound('Project')
      return row
    },

    /** Deleting a project keeps its tasks and tracked time: they simply become "no project". */
    async remove(userId: string, id: string) {
      const now = new Date()
      const [row] = await db.update(p).set({ deletedAt: now, updatedAt: now }).where(owned(userId, id)).returning({ id: p.id })
      if (!row) throw notFound('Project')
      await db.update(tasksTable).set({ projectId: null, updatedAt: now }).where(and(eq(tasksTable.userId, userId), eq(tasksTable.projectId, id)))
      await db.update(entriesTable).set({ projectId: null, updatedAt: now }).where(and(eq(entriesTable.userId, userId), eq(entriesTable.projectId, id)))
    },
  }
}

export type ProjectService = ReturnType<typeof createProjectService>
