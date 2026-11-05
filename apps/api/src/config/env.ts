import { z } from 'zod'

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
  KEY_ENCRYPTION_SECRET: z.string().min(32, 'KEY_ENCRYPTION_SECRET must be at least 32 characters'),
})

export type Env = z.infer<typeof schema>

/** Validates process.env once at startup so a missing secret fails loudly, not at the first request. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')
    throw new Error(`Invalid environment:\n  ${problems}`)
  }
  return parsed.data
}
