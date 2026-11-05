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
  /** These emails are made admin and approved automatically on registration. */
  adminEmails: string[]
  /** Send the login cookie across sites (SameSite=None; Secure). Needs https. */
  crossSiteCookies?: boolean
}

/**
 * Login with email, username and password. Every new account starts as "pending" and cannot
 * sign in until an admin approves it. The emails in ADMIN_EMAILS bootstrap the admins.
 */
export function createAuth(cfg: AuthConfig) {
  const admins = new Set(cfg.adminEmails.map((e) => e.toLowerCase()))
  const isAdminEmail = (email: string) => admins.has(email.toLowerCase())

  return betterAuth({
    database: drizzleAdapter(cfg.db, { provider: 'pg', schema }),
    secret: cfg.secret,
    baseURL: cfg.baseURL,
    basePath: '/api/auth',
    trustedOrigins: [cfg.webOrigin],
    advanced: cfg.crossSiteCookies ? { defaultCookieAttributes: { sameSite: 'none', secure: true } } : undefined,
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
