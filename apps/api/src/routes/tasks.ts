import { zValidator } from '@hono/zod-validator'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { schema } from '@timedesk/db'
import type { AppEnv, Deps } from '../types.ts'

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const recurrence = z.object({ freq: z.enum(['daily', 'weekly', 'monthly', 'custom']), every: z.number().int().min(1).max(365).optional() })

const create = z.object({
  id: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(300),
  projectId: z.string().nullable().default(null),
  status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  due: dateKey.nullable().default(null),
  recurrence: recurrence.nullable().default(null),
})
const update = create.omit({ id: true }).partial()

export function taskRoutes({ db }: Deps) {
  const app = new Hono<AppEnv>()
  const mine = (userId: string, id: string) => and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId), isNull(schema.tasks.deletedAt))

  app.get('/', async (c) => {
    const status = c.req.query('status')
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.userId, c.get('user').id), isNull(schema.tasks.deletedAt), status ? eq(schema.tasks.status, status) : undefined))
    return c.json({ tasks: rows })
  })

  app.post('/', zValidator('json', create), async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    const [row] = await db
      .insert(schema.tasks)
      .values({ ...body, id: body.id ?? crypto.randomUUID(), userId: user.id, workspaceId: user.id })
      .returning()
    return c.json({ task: row }, 201)
  })

  app.patch('/:id', zValidator('json', update), async (c) => {
    const [row] = await db
      .update(schema.tasks)
      .set({ ...c.req.valid('json'), updatedAt: new Date() })
      .where(mine(c.get('user').id, c.req.param('id')))
      .returning()
    return row ? c.json({ task: row }) : c.json({ error: 'Task not found.' }, 404)
  })

  app.delete('/:id', async (c) => {
    const [row] = await db
      .update(schema.tasks)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(mine(c.get('user').id, c.req.param('id')))
      .returning({ id: schema.tasks.id })
    return row ? c.body(null, 204) : c.json({ error: 'Task not found.' }, 404)
  })

  return app
}
