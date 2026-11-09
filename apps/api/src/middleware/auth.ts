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

/** Puts the signed-in user on the context when there is one, and carries on either way (for the public Google callback). */
export function optionalUser(deps: Deps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = await deps.auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null)
    const user = result?.user as unknown as SessionUser | undefined
    if (user?.status === 'approved') c.set('user', user)
    await next()
  })
}

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('user').role !== 'admin') throw forbidden('Admins only.')
  await next()
})
