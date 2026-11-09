import { createMiddleware } from 'hono/factory'
import { forbidden } from '../utils/errors.ts'
import type { AppEnv } from '../types.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Cross-site request forgery guard for everything that changes data. The login cookie is sent across sites, so a
 * request that changes something must come from one of our own apps: the website or the desktop app (by its Origin).
 * A request with no Origin at all (a script, the desktop app's main process) is only accepted with a Bearer token,
 * which a browser never attaches on its own.
 */
export function requireOwnOrigin(allowed: string[]) {
  const origins = new Set(allowed.map((o) => o.replace(/\/$/, '')))
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('Origin')
      const bearer = /^Bearer\s+\S/i.test(c.req.header('Authorization') ?? '')
      if (origin ? !origins.has(origin) : !bearer) throw forbidden('This request did not come from timedesk.')
    }
    await next()
  })
}
