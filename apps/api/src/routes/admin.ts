import { zValidator } from '@hono/zod-validator'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { schema } from '@timedesk/db'
import { requireAdmin } from '../middleware.ts'
import type { AppEnv, Deps } from '../types.ts'

const statusQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending') })

/** Admin: review registrations. New accounts are pending until approved here. */
export function adminRoutes({ db }: Deps) {
  const app = new Hono<AppEnv>()
  app.use('*', requireAdmin)

  app.get('/users', zValidator('query', statusQuery), async (c) => {
    const { status } = c.req.valid('query')
    const rows = await db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        username: schema.user.username,
        role: schema.user.role,
        status: schema.user.status,
        createdAt: schema.user.createdAt,
      })
      .from(schema.user)
      .where(status === 'all' ? undefined : eq(schema.user.status, status))
    return c.json({ users: rows })
  })

  const decide = (status: 'approved' | 'rejected') => async (c: import('hono').Context<AppEnv>) => {
    const id = c.req.param('id') ?? ''
    if (id === c.get('user').id) return c.json({ error: 'You cannot change your own status.' }, 400)
    const [row] = await db
      .update(schema.user)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(schema.user.id, id)))
      .returning({ id: schema.user.id, status: schema.user.status })
    if (!row) return c.json({ error: 'No such user.' }, 404)
    return c.json({ user: row })
  }

  app.post('/users/:id/approve', decide('approved'))
  app.post('/users/:id/reject', decide('rejected'))
  return app
}
