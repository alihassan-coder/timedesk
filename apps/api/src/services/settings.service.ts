import { eq } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'

const s = schema.userSettings

/**
 * Per-user preferences as one JSON document (appearance, assistant choices). Updating merges the
 * given top-level keys into what is stored, so two devices changing different things do not erase each other.
 */
export function createSettingsService(db: Db) {
  return {
    async get(userId: string) {
      const [row] = await db.select().from(s).where(eq(s.userId, userId))
      return { data: row?.data ?? {}, updatedAt: row?.updatedAt ?? null }
    },

    async merge(userId: string, patch: Record<string, unknown>) {
      const current = (await this.get(userId)).data
      const data = { ...current, ...patch }
      const now = new Date()
      await db
        .insert(s)
        .values({ userId, data, updatedAt: now })
        .onConflictDoUpdate({ target: s.userId, set: { data, updatedAt: now } })
      return { data, updatedAt: now }
    },
  }
}

export type SettingsService = ReturnType<typeof createSettingsService>
