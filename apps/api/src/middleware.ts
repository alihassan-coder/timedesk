import { createMiddleware } from 'hono/factory'
import type { Deps, AppEnv, SessionUser } from './types.ts'

/** Requires a valid session of an approved account. Puts the user on the request context. */
export function requireUser(deps: Deps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = await deps.auth.api.getSession({ headers: c.req.raw.headers })
    if (!result) return c.json({ error: 'Sign in required.' }, 401)
    const user = result.user as unknown as SessionUser
    if (user.status !== 'approved') return c.json({ error: 'Your account is not approved yet.' }, 403)
    c.set('user', user)
    await next()
  })
}

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'Admins only.' }, 403)
  await next()
})
