import { z } from 'zod'

/** An empty line like `GOOGLE_REDIRECT_URI=` (as in .env.example) means "not set", not an invalid value. */
const blankIsUnset = <T extends z.ZodTypeAny>(inner: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), inner)

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3001'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  /** Comma-separated list. These emails are made admin and approved automatically on registration. */
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  /** Set to "true" only if the web app and API are on different sites (for example two *.vercel.app addresses). Prefer subdomains of one domain. */
  CROSS_SITE_COOKIES: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  /** Origin of the bundled desktop app. It uses token login, so this rarely needs changing. */
  DESKTOP_ORIGIN: z.string().default('app://timedesk'),
  KEY_ENCRYPTION_SECRET: z.string().min(32, 'KEY_ENCRYPTION_SECRET must be at least 32 characters'),
  /** Google Calendar. All optional: without the client id and secret the feature is switched off. */
  GOOGLE_CLIENT_ID: blankIsUnset(z.string().optional()),
  GOOGLE_CLIENT_SECRET: blankIsUnset(z.string().optional()),
  /** Defaults to <BETTER_AUTH_URL>/v1/integrations/google/callback. Must match the address in the Google Cloud console. */
  GOOGLE_REDIRECT_URI: blankIsUnset(z.string().url().optional()),
})

export type Env = z.infer<typeof schema>

/** The Google redirect address: the configured one, or the API's own callback route. */
export const googleRedirectUri = (env: Pick<Env, 'BETTER_AUTH_URL' | 'GOOGLE_REDIRECT_URI'>) =>
  env.GOOGLE_REDIRECT_URI ?? `${env.BETTER_AUTH_URL.replace(/\/$/, '')}/v1/integrations/google/callback`

/** Validates process.env once at startup so a missing secret fails loudly, not at the first request. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')
    throw new Error(`Invalid environment:\n  ${problems}`)
  }
  return parsed.data
}
