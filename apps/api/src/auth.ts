import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { username } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'

export interface AuthConfig {
  db: Db
  secret: string
  baseURL: string
  webOrigin: string
  /** This email is made admin and approved automatically on registration. */
  adminEmail?: string
}

/**
 * Login with email, username and password. Every new account starts as "pending" and cannot
 * sign in until an admin approves it. The one exception is ADMIN_EMAIL, which bootstraps the first admin.
 */
export function createAuth(cfg: AuthConfig) {
  const isAdminEmail = (email: string) => !!cfg.adminEmail && email.toLowerCase() === cfg.adminEmail.toLowerCase()

  return betterAuth({
    database: drizzleAdapter(cfg.db, { provider: 'pg', schema }),
    secret: cfg.secret,
    baseURL: cfg.baseURL,
    basePath: '/api/auth',
    trustedOrigins: [cfg.webOrigin],
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: false },
    plugins: [username()],
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'member', input: false },
        status: { type: 'string', required: false, defaultValue: 'pending', input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              role: isAdminEmail(user.email) ? 'admin' : 'member',
              status: isAdminEmail(user.email) ? 'approved' : 'pending',
            },
          }),
        },
      },
      session: {
        create: {
          before: async (session) => {
            const [u] = await cfg.db.select({ status: schema.user.status }).from(schema.user).where(eq(schema.user.id, session.userId))
            if (u?.status === 'pending') throw new APIError('FORBIDDEN', { message: 'Your account is waiting for admin approval.' })
            if (u?.status === 'rejected') throw new APIError('FORBIDDEN', { message: 'Your account request was declined.' })
          },
        },
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
