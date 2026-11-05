import { zValidator } from '@hono/zod-validator'
import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { schema } from '@timedesk/db'
import type { AppEnv, Deps } from '../types.ts'

const start = z.object({ taskId: z.string().nullable().default(null), projectId: z.string().nullable().default(null) })
const range = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })

/** Time tracking. A user has at most one running timer; starting a new one stops the old one. */
export function timeRoutes({ db }: Deps) {
  const app = new Hono<AppEnv>()
  const e = schema.timeEntries

  app.get('/', zValidator('query', range), async (c) => {
    const { from, to } = c.req.valid('query')
    const rows = await db
      .select()
      .from(e)
      .where(and(eq(e.userId, c.get('user').id), isNull(e.deletedAt), from ? gte(e.startedAt, from) : undefined, to ? lt(e.startedAt, to) : undefined))
      .orderBy(desc(e.startedAt))
    return c.json({ entries: rows })
  })

  app.get('/running', async (c) => {
    const [row] = await db.select().from(e).where(and(eq(e.userId, c.get('user').id), isNull(e.endedAt), isNull(e.deletedAt)))
    return c.json({ entry: row ?? null })
  })

  app.post('/start', zValidator('json', start), async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    const now = new Date()
    await db.update(e).set({ endedAt: now, updatedAt: now }).where(and(eq(e.userId, user.id), isNull(e.endedAt), isNull(e.deletedAt)))
    const [row] = await db
      .insert(e)
      .values({ id: crypto.randomUUID(), userId: user.id, workspaceId: user.id, taskId: body.taskId, projectId: body.projectId, startedAt: now })
      .returning()
    return c.json({ entry: row }, 201)
  })

  app.post('/stop', async (c) => {
    const now = new Date()
    const [row] = await db
      .update(e)
      .set({ endedAt: now, updatedAt: now })
      .where(and(eq(e.userId, c.get('user').id), isNull(e.endedAt), isNull(e.deletedAt)))
      .returning()
    return row ? c.json({ entry: row }) : c.json({ error: 'No timer is running.' }, 409)
  })

  return app
}
