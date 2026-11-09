import { eq, sql } from 'drizzle-orm'
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

    /**
     * Merges the given groups into what is stored, in one statement (jsonb ||), so two changes arriving together
     * cannot erase each other the way read, merge, write could. A group that is sent replaces that whole group.
     */
    async merge(userId: string, patch: Record<string, unknown>) {
      const now = new Date()
      const [row] = await db
        .insert(s)
        .values({ userId, data: patch, updatedAt: now })
        .onConflictDoUpdate({ target: s.userId, set: { data: sql`${s.data} || excluded.data`, updatedAt: now } })
        .returning({ data: s.data, updatedAt: s.updatedAt })
      return { data: row.data, updatedAt: row.updatedAt }
    },
  }
}

export type SettingsService = ReturnType<typeof createSettingsService>
