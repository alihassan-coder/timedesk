import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requireUser } from './middleware.ts'
import { adminRoutes } from './routes/admin.ts'
import { aiKeyRoutes } from './routes/ai-keys.ts'
import { projectRoutes } from './routes/projects.ts'
import { taskRoutes } from './routes/tasks.ts'
import { timeRoutes } from './routes/time.ts'
import type { AppEnv, Deps } from './types.ts'

/** Builds the whole HTTP API from its dependencies, so tests can plug in an in-memory database. */
export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>()

  app.use('*', cors({ origin: deps.env.WEB_ORIGIN, credentials: true, allowHeaders: ['Content-Type', 'Authorization'] }))

  app.get('/health', (c) => c.json({ ok: true }))

  // Login, registration, sessions: handled by Better Auth.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw))

  // Everything below needs an approved account.
  const authed = new Hono<AppEnv>()
  authed.use('*', requireUser(deps))
  authed.get('/me', (c) => c.json({ user: c.get('user') }))
  authed.route('/admin', adminRoutes(deps))
  authed.route('/projects', projectRoutes(deps))
  authed.route('/tasks', taskRoutes(deps))
  authed.route('/time-entries', timeRoutes(deps))
  authed.route('/ai/keys', aiKeyRoutes(deps))
  app.route('/v1', authed)

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Something went wrong on our side.' }, 500)
  })
  app.notFound((c) => c.json({ error: 'Not found.' }, 404))

  return app
}
