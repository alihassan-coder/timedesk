import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { createControllers } from './controllers/index.ts'
import { optionalUser, requireUser } from './middleware/auth.ts'
import { requireOwnOrigin } from './middleware/origin.ts'
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

  // The website (cookie login) and the bundled desktop app (token login) may call the API. Nobody else.
  const origins = [deps.env.WEB_ORIGIN, deps.env.DESKTOP_ORIGIN ?? 'app://timedesk']
  app.use('*', cors({ origin: origins, credentials: true, allowHeaders: ['Content-Type', 'Authorization'], exposeHeaders: ['set-auth-token'] }))

  app.get('/health', (c) => c.json({ ok: true }))

  // Login, registration, sessions: handled by Better Auth.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw))

  // Everything under /v1 needs an approved account.
  const controllers = createControllers(createServices(deps))

  // Google sends the browser back here after the person agrees. Public: the signed, one-time state says who started it,
  // and in the browser the login cookie that comes along must belong to that same person.
  app.get('/v1/integrations/google/callback', optionalUser(deps), controllers.google.callback)

  const v1 = new Hono<AppEnv>()
  v1.use('*', requireUser(deps))
  // Changes must come from our own website or desktop app, never from another site riding on the login cookie.
  v1.use('*', requireOwnOrigin(origins))
  v1.route('/', createRoutes(controllers))
  app.route('/v1', v1)

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.message, details: err.details }, err.status)
    // Database refusals are the client's mistake or a race, not a crash. The SQL itself is never sent back.
    const db = databaseError(err)
    if (db) return c.json({ error: db.message }, db.status)
    console.error(err)
    return c.json({ error: 'Something went wrong on our side.' }, 500)
  })
  app.notFound((c) => c.json({ error: 'Not found.' }, 404))

  return app
}

/** Postgres error codes (on the error, or on its cause when Drizzle wraps it) mapped to a calm answer. */
function databaseError(err: unknown): { status: 409 | 422; message: string } | null {
  const code = pgCode(err) ?? pgCode((err as { cause?: unknown } | null)?.cause)
  switch (code) {
    case '23505':
      return { status: 409, message: 'That already exists. Reload and try again.' }
    case '23503':
      return { status: 422, message: 'That refers to something that does not exist (any more).' }
    case '22P02':
    case '22007':
    case '22008':
    case '22001':
      return { status: 422, message: 'Some fields are invalid.' }
    default:
      return null
  }
}

const pgCode = (e: unknown) => {
  const code = (e as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined
}
