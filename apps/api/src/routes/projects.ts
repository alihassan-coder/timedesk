import { zValidator } from '@hono/zod-validator'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { schema } from '@timedesk/db'
import type { AppEnv, Deps } from '../types.ts'

const create = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(''),
  color: z.number().int().min(1).max(5).default(1),
})
const update = create.omit({ id: true }).partial()

export function projectRoutes({ db }: Deps) {
  const app = new Hono<AppEnv>()
  const mine = (userId: string, id: string) => and(eq(schema.projects.id, id), eq(schema.projects.userId, userId), isNull(schema.projects.deletedAt))

  app.get('/', async (c) => {
    const rows = await db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.userId, c.get('user').id), isNull(schema.projects.deletedAt)))
    return c.json({ projects: rows })
  })

  app.post('/', zValidator('json', create), async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    const [row] = await db
      .insert(schema.projects)
      .values({ ...body, id: body.id ?? crypto.randomUUID(), userId: user.id, workspaceId: user.id })
      .returning()
    return c.json({ project: row }, 201)
  })

  app.patch('/:id', zValidator('json', update), async (c) => {
    const [row] = await db
      .update(schema.projects)
      .set({ ...c.req.valid('json'), updatedAt: new Date() })
      .where(mine(c.get('user').id, c.req.param('id')))
      .returning()
    return row ? c.json({ project: row }) : c.json({ error: 'Project not found.' }, 404)
  })

  app.delete('/:id', async (c) => {
    const [row] = await db
      .update(schema.projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(mine(c.get('user').id, c.req.param('id')))
      .returning({ id: schema.projects.id })
    return row ? c.body(null, 204) : c.json({ error: 'Project not found.' }, 404)
  })

  return app
}
