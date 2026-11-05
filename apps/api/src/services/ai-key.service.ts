import { and, eq } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'
import { decryptSecret, encryptSecret } from '../utils/crypto.ts'
import type { AiProvider } from '../validators/index.ts'

const k = schema.aiProviderKeys

/**
 * AI provider keys. Encrypted before storage. Nothing here ever returns a stored key:
 * `list` gives the last 4 characters, and `getPlain` is for server-side model calls only.
 */
export function createAiKeyService(db: Db, secret: string) {
  return {
    async list(userId: string) {
      const rows = await db.select().from(k).where(eq(k.userId, userId))
      return rows.map((r) => ({ provider: r.provider, last4: decryptSecret(r.encryptedKey, secret).slice(-4), updatedAt: r.updatedAt }))
    },

    async save(userId: string, provider: AiProvider, key: string) {
      const encryptedKey = encryptSecret(key, secret)
      await db
        .insert(k)
        .values({ id: crypto.randomUUID(), userId, provider, encryptedKey })
        .onConflictDoUpdate({ target: [k.userId, k.provider], set: { encryptedKey, updatedAt: new Date() } })
    },

    async remove(userId: string, provider: AiProvider) {
      await db.delete(k).where(and(eq(k.userId, userId), eq(k.provider, provider)))
    },

    async getPlain(userId: string, provider: AiProvider) {
      const [row] = await db.select().from(k).where(and(eq(k.userId, userId), eq(k.provider, provider)))
      return row ? decryptSecret(row.encryptedKey, secret) : null
    },
  }
}

export type AiKeyService = ReturnType<typeof createAiKeyService>
