import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { schema, type Db } from '@timedesk/db'
import type { MemoryProvider } from '../lib/memory.ts'
import { AppError } from '../utils/errors.ts'
import type { AiKeyService } from './ai-key.service.ts'
import type { GoogleCalendarService } from './google-calendar.service.ts'

interface Parts {
  db: Db
  aiKeys: AiKeyService
  memory: MemoryProvider
  calendar: GoogleCalendarService
  /** Checks the signed-in person's password (Better Auth). */
  verifyPassword: (headers: Headers, password: string) => Promise<boolean>
}

/** Bumped when the shape of the export changes, so a reader can tell versions apart. */
export const EXPORT_FORMAT = 1

/** Your data, all of it: download a copy, or delete the account and everything in it. */
export function createAccountService(p: Parts) {
  const { db } = p
  const live = (t: { userId: AnyPgColumn; deletedAt: AnyPgColumn }, userId: string) => and(eq(t.userId, userId), isNull(t.deletedAt))

  return {
    /**
     * Everything stored for this person, as one JSON document. Secrets are left out: AI keys and Google tokens
     * are listed by name only. Items you deleted are left out too.
     */
    async export(userId: string) {
      const [user] = await db
        .select({ id: schema.user.id, name: schema.user.name, username: schema.user.username, email: schema.user.email, role: schema.user.role, createdAt: schema.user.createdAt })
        .from(schema.user)
        .where(eq(schema.user.id, userId))

      const [projects, tasks, timeEntries, reviews, settings, chats, activity, keys, google, focus] = await Promise.all([
        db.select().from(schema.projects).where(live(schema.projects, userId)).orderBy(asc(schema.projects.createdAt)),
        db.select().from(schema.tasks).where(live(schema.tasks, userId)).orderBy(asc(schema.tasks.createdAt)),
        db.select().from(schema.timeEntries).where(live(schema.timeEntries, userId)).orderBy(asc(schema.timeEntries.startedAt)),
        db.select().from(schema.weeklyReviews).where(eq(schema.weeklyReviews.userId, userId)).orderBy(asc(schema.weeklyReviews.weekStart)),
        db.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId)),
        db.select().from(schema.chats).where(live(schema.chats, userId)).orderBy(asc(schema.chats.createdAt)),
        db.select().from(schema.activitySamples).where(eq(schema.activitySamples.userId, userId)).orderBy(asc(schema.activitySamples.startedAt)),
        p.aiKeys.list(userId),
        db.select().from(schema.googleConnections).where(eq(schema.googleConnections.userId, userId)),
        db.select().from(schema.focusSessions).where(eq(schema.focusSessions.userId, userId)).orderBy(asc(schema.focusSessions.startedAt)),
      ])

      const chatIds = chats.map((c) => c.id)
      const messages = chatIds.length
        ? await db.select().from(schema.chatMessages).where(inArray(schema.chatMessages.chatId, chatIds)).orderBy(asc(schema.chatMessages.position))
        : []

      // Memories live with the AI provider setup; reading them needs the saved keys. Leave them out if that fails.
      let memories: { id: string; text: string }[] = []
      try {
        memories = await p.memory.list(userId, await p.aiKeys.allPlain(userId))
      } catch {
        memories = []
      }

      const strip = <T extends { userId?: string; workspaceId?: string; deletedAt?: Date | null }>(row: T) => {
        const { userId: _u, workspaceId: _w, deletedAt: _d, ...rest } = row
        return rest
      }

      return {
        format: EXPORT_FORMAT,
        app: 'timedesk',
        exportedAt: new Date().toISOString(),
        user,
        settings: settings[0]?.data ?? {},
        projects: projects.map(strip),
        tasks: tasks.map(strip),
        timeEntries: timeEntries.map(strip),
        weeklyReviews: reviews.map(({ userId: _u, ...rest }) => rest),
        chats: chats.map((c) => ({
          ...strip(c),
          messages: messages.filter((m) => m.chatId === c.id).map(({ chatId: _c, ...m }) => m),
        })),
        assistantMemories: memories,
        /** What the desktop app saw in the foreground. */
        activity: activity.map(({ userId: _u, ...a }) => a),
        /** Focus guard sessions: focused and distracted time, and which listed apps or sites took it. */
        focusSessions: focus.map(({ userId: _u, ...s }) => s),
        aiKeysSaved: keys.map((k) => k.provider),
        googleCalendar: google[0]
          ? { connected: true, email: google[0].email, calendarId: google[0].calendarId, pushTasks: google[0].pushTasks }
          : { connected: false },
      }
    },

    /**
     * Deletes the account for good after checking the password. Assistant memories and the Google connection
     * are cleaned up first (they need the keys and tokens that are about to go), then the user row goes, and the
     * database removes everything that belongs to it.
     */
    async remove(userId: string, headers: Headers, password: string) {
      if (!(await p.verifyPassword(headers, password))) throw new AppError(403, 'That password is not right.')

      try {
        await p.memory.forgetAll(userId, await p.aiKeys.allPlain(userId))
      } catch {
        // Memory is best effort: the provider may be unreachable. The rest still goes.
      }
      try {
        await p.calendar.disconnect(userId)
      } catch {
        // Revoking at Google is best effort; the stored tokens go with the account below.
      }

      const gone = await db.delete(schema.user).where(eq(schema.user.id, userId)).returning({ id: schema.user.id })
      if (gone.length === 0) throw new AppError(404, 'Account not found.')
    },
  }
}

export type AccountService = ReturnType<typeof createAccountService>
