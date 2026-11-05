import { createMiddleware } from 'hono/factory'
import { forbidden, unauthorized } from '../utils/errors.ts'
import type { AppEnv, Deps, SessionUser } from '../types.ts'

/** Requires a valid session of an approved account. Puts the user on the request context. */
export function requireUser(deps: Deps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = await deps.auth.api.getSession({ headers: c.req.raw.headers })
    if (!result) throw unauthorized()
    const user = result.user as unknown as SessionUser
    if (user.status !== 'approved') throw forbidden('Your account is not approved yet.')
    c.set('user', user)
    await next()
  })
}

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('user').role !== 'admin') throw forbidden('Admins only.')
  await next()
})
