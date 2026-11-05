import { zValidator } from '@hono/zod-validator'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { schema } from '@timedesk/db'
import { decryptSecret, encryptSecret } from '../crypto.ts'
import type { AppEnv, Deps } from '../types.ts'

const providers = ['openai', 'anthropic', 'google', 'groq', 'xai'] as const
const providerParam = z.object({ provider: z.enum(providers) })
const body = z.object({ key: z.string().trim().min(8).max(500) })

/**
 * AI provider keys. They are encrypted before storage and the API never returns a stored key,
 * only the last 4 characters. The agent decrypts them server-side when it calls a model.
 */
export function aiKeyRoutes({ db, env }: Deps) {
  const app = new Hono<AppEnv>()
  const k = schema.aiProviderKeys

  app.get('/', async (c) => {
    const rows = await db.select().from(k).where(eq(k.userId, c.get('user').id))
    return c.json({
      keys: rows.map((r) => ({ provider: r.provider, last4: decryptSecret(r.encryptedKey, env.KEY_ENCRYPTION_SECRET).slice(-4), updatedAt: r.updatedAt })),
    })
  })

  app.put('/:provider', zValidator('param', providerParam), zValidator('json', body), async (c) => {
    const { provider } = c.req.valid('param')
    const encryptedKey = encryptSecret(c.req.valid('json').key, env.KEY_ENCRYPTION_SECRET)
    const userId = c.get('user').id
    await db
      .insert(k)
      .values({ id: crypto.randomUUID(), userId, provider, encryptedKey })
      .onConflictDoUpdate({ target: [k.userId, k.provider], set: { encryptedKey, updatedAt: new Date() } })
    return c.json({ provider, saved: true })
  })

  app.delete('/:provider', zValidator('param', providerParam), async (c) => {
    const { provider } = c.req.valid('param')
    await db.delete(k).where(and(eq(k.userId, c.get('user').id), eq(k.provider, provider)))
    return c.body(null, 204)
  })

  return app
}
