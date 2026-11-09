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
  /**
   * A stored key that cannot be decrypted (the server secret changed, or the row is damaged) is null, never an error:
   * one broken key must not break the settings page, the export, the model list or the chat.
   */
  const open = (r: { provider: string; encryptedKey: string }) => {
    try {
      return decryptSecret(r.encryptedKey, secret)
    } catch {
      console.error(`AI key for ${r.provider} could not be decrypted; it needs to be saved again.`)
      return null
    }
  }

  return {
    /** Saved keys by provider. One that can no longer be read is listed as invalid, so the person can save it again. */
    async list(userId: string) {
      const rows = await db.select().from(k).where(eq(k.userId, userId))
      return rows.map((r) => {
        const plain = open(r)
        return plain === null
          ? { provider: r.provider, last4: '????', invalid: true, updatedAt: r.updatedAt }
          : { provider: r.provider, last4: plain.slice(-4), updatedAt: r.updatedAt }
      })
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

    /** Every key this user saved, decrypted. Server-side use only (model calls and memory). */
    async allPlain(userId: string) {
      const rows = await db.select().from(k).where(eq(k.userId, userId))
      const keys: Partial<Record<AiProvider, string>> = {}
      for (const r of rows) {
        const plain = open(r)
        if (plain !== null) keys[r.provider as AiProvider] = plain // an unreadable key counts as not saved
      }
      return keys
    },

    async getPlain(userId: string, provider: AiProvider) {
      const [row] = await db.select().from(k).where(and(eq(k.userId, userId), eq(k.provider, provider)))
      return row ? open(row) : null
    },
  }
}

export type AiKeyService = ReturnType<typeof createAiKeyService>
