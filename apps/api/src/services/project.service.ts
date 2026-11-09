import { and, eq, isNull } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'
import { batch } from '../utils/batch.ts'
import { conflict, notFound } from '../utils/errors.ts'
import type { SessionUser } from '../types.ts'
import type { CreateProject, UpdateProject } from '../validators/index.ts'

const p = schema.projects
const tasksTable = schema.tasks
const entriesTable = schema.timeEntries

export function createProjectService(db: Db) {
  const owned = (userId: string, id: string) => and(eq(p.id, id), eq(p.userId, userId), isNull(p.deletedAt))

  return {
    list: (userId: string) => db.select().from(p).where(and(eq(p.userId, userId), isNull(p.deletedAt))),

    /** Safe to send twice (an app that was offline retries): the same id returns the project that is already there. */
    async create(user: SessionUser, input: CreateProject) {
      const id = input.id ?? crypto.randomUUID()
      const [row] = await db
        .insert(p)
        .values({ ...input, id, userId: user.id, workspaceId: user.id })
        .onConflictDoNothing()
        .returning()
      if (row) return row
      const [existing] = await db.select().from(p).where(eq(p.id, id))
      if (existing?.userId !== user.id) throw conflict('That id is already used.')
      return existing
    },

    async update(userId: string, id: string, patch: UpdateProject) {
      const [row] = await db.update(p).set({ ...patch, updatedAt: new Date() }).where(owned(userId, id)).returning()
      if (!row) throw notFound('Project')
      return row
    },

    /** Deleting a project keeps its tasks and tracked time: they simply become "no project". All three changes happen together. */
    async remove(userId: string, id: string) {
      const now = new Date()
      const [removed] = await batch(db, [
        db.update(p).set({ deletedAt: now, updatedAt: now }).where(owned(userId, id)).returning({ id: p.id }),
        db.update(tasksTable).set({ projectId: null, updatedAt: now }).where(and(eq(tasksTable.userId, userId), eq(tasksTable.projectId, id))),
        db.update(entriesTable).set({ projectId: null, updatedAt: now }).where(and(eq(entriesTable.userId, userId), eq(entriesTable.projectId, id))),
      ])
      // Only this person's own rows were touched above, so a project that is not theirs changed nothing of anyone else's.
      if (removed.length === 0) throw notFound('Project')
    },
  }
}

export type ProjectService = ReturnType<typeof createProjectService>
