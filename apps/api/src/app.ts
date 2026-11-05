import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { createControllers } from './controllers/index.ts'
import { requireUser } from './middleware/auth.ts'
import { createRoutes } from './routes/index.ts'
import { createServices } from './services/index.ts'
import type { AppEnv, Deps } from './types.ts'
import { AppError } from './utils/errors.ts'

/** Builds the whole HTTP API from its dependencies, so tests can plug in an in-memory database. */
export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>()

  // Browser protections on every response (no sniffing, no framing, strict referrer, and so on).
  app.use('*', secureHeaders({ crossOriginResourcePolicy: false }))
  // Nothing legitimate here is bigger than a couple of megabytes; refuse the rest before reading it.
  app.use('/v1/*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: 'That request is too large.' }, 413) }))

  app.use('*', cors({ origin: deps.env.WEB_ORIGIN, credentials: true, allowHeaders: ['Content-Type', 'Authorization'] }))

  app.get('/health', (c) => c.json({ ok: true }))

  // Login, registration, sessions: handled by Better Auth.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw))

  // Everything under /v1 needs an approved account.
  const v1 = new Hono<AppEnv>()
  v1.use('*', requireUser(deps))
  v1.route('/', createRoutes(createControllers(createServices(deps))))
  app.route('/v1', v1)

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.message, details: err.details }, err.status)
    console.error(err)
    return c.json({ error: 'Something went wrong on our side.' }, 500)
  })
  app.notFound((c) => c.json({ error: 'Not found.' }, 404))

  return app
}
