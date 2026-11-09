import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, isNull, like, lt, ne } from 'drizzle-orm'
import { addDays, type CalendarEvent, type GoogleStatus, type GoogleSyncResult } from '@timedesk/shared'
import { schema, type Db } from '@timedesk/db'
import {
  GoogleApiError,
  GoogleAuthError,
  GoogleUnauthorizedError,
  GoogleUnreachableError,
  type GoogleClient,
  type GoogleConfig,
  type GoogleEvent,
  type GoogleEventInput,
} from '../lib/google.ts'
import { decryptSecret, encryptSecret } from '../utils/crypto.ts'
import { badGateway, badRequest, conflict, gatewayTimeout, notFound, unavailable, unprocessable } from '../utils/errors.ts'
import type { CreateCalendarEvent, UpdateCalendarEvent } from '../validators/index.ts'

const conns = schema.googleConnections
const verification = schema.verification
const links = schema.googleTaskLinks
const tasks = schema.tasks

type Task = typeof tasks.$inferSelect
type Connection = typeof conns.$inferSelect

const STATE_TTL_MS = 10 * 60 * 1000
const DONE_MARK = '✓ ' // a check mark in front of the title of a finished task
/** Tasks mirrored per request. Each is a call to Google, and a request must finish well within the function time limit. */
const MAX_TASKS_PER_PUSH = 25
/** One-time connect tickets live in Better Auth's verification table (no table of our own needed) under this prefix. */
const TICKET_PREFIX = 'google-connect:'
/**
 * When a mirrored event is deleted in Google, the link is kept with this id instead of being removed, so
 * "Sync now" does not put the event back. The next change to the task makes a fresh event.
 */
const deletedMarker = (taskId: string) => `deleted:${taskId}`
const isDeleted = (link: { googleEventId: string }) => link.googleEventId.startsWith('deleted:')
const dayOnly = /^\d{4}-\d{2}-\d{2}$/

/**
 * A failure talking to Google, as an answer the app can show: unreachable 502, too slow 504, a request Google
 * refused 422, rate limited or forbidden 503, anything else 502. Other errors (ours, or bugs) pass through untouched.
 */
function googleFailure(e: unknown): unknown {
  if (e instanceof GoogleUnreachableError) {
    return e.timeout ? gatewayTimeout('Google Calendar took too long to answer. Try again in a moment.') : badGateway('Could not reach Google Calendar. Try again in a moment.')
  }
  if (e instanceof GoogleApiError) {
    console.error('Google Calendar:', e.message)
    if (e.status === 400) return unprocessable('Google Calendar did not accept that. Check the dates, time zone and title.')
    if (e.status === 403 || e.status === 429) return unavailable('Google Calendar is limiting requests right now. Try again in a few minutes.')
    return badGateway('Google Calendar did not answer. Try again in a moment.')
  }
  if (e instanceof GoogleUnauthorizedError) return badGateway('Google Calendar did not answer. Try again in a moment.')
  return e
}

/** The person has to connect again: Google no longer accepts the saved permission. */
export const RECONNECT_MESSAGE = 'Google no longer allows timedesk to use your calendar. Connect Google Calendar again in Settings.'

/**
 * Google Calendar for one person at a time: connecting, reading and editing events, and keeping
 * tasks and events in step both ways. Every method takes the signed-in user's id and only ever
 * touches that user's own connection, which is the only way to reach their calendar.
 */
export function createGoogleCalendarService(db: Db, secret: string, webOrigin: string, google?: GoogleConfig, now: () => Date = () => new Date()) {
  const configured = () => google !== undefined
  const need = () => {
    if (!google) throw badRequest('Google Calendar is not set up on this server.')
    return google
  }

  // ---- signed state for the OAuth round trip ----
  const stateKey = () => createHmac('sha256', secret).update('google-oauth-state').digest()
  const sign = (payload: string) => createHmac('sha256', stateKey()).update(payload).digest('base64url')
  /**
   * The state names the person and expires in 10 minutes, and is signed so it cannot be forged. Its nonce is also stored
   * as a one-time ticket, so the same state cannot be used twice.
   */
  async function makeState(userId: string, desktop: boolean): Promise<string> {
    const nonce = randomBytes(16).toString('hex')
    const expiresAt = new Date(now().getTime() + STATE_TTL_MS)
    await db.delete(verification).where(and(like(verification.identifier, `${TICKET_PREFIX}%`), lt(verification.expiresAt, now())))
    await db.insert(verification).values({ id: crypto.randomUUID(), identifier: TICKET_PREFIX + nonce, value: userId, expiresAt })
    const payload = Buffer.from(JSON.stringify({ u: userId, d: desktop, e: expiresAt.getTime(), n: nonce })).toString('base64url')
    return `${payload}.${sign(payload)}`
  }
  /** Uses up the ticket of a state. True only the first time, for the person it was made for, before it expires. */
  async function redeem(nonce: string, userId: string): Promise<boolean> {
    const used = await db
      .delete(verification)
      .where(and(eq(verification.identifier, TICKET_PREFIX + nonce), eq(verification.value, userId), gt(verification.expiresAt, now())))
      .returning({ id: verification.id })
    return used.length > 0
  }
  function readState(state: string | undefined): { userId: string; desktop: boolean; nonce: string } | null {
    if (!state) return null
    const [payload, mac] = state.split('.')
    if (!payload || !mac) return null
    const expected = Buffer.from(sign(payload))
    const given = Buffer.from(mac)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
    try {
      const v = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: string; d?: boolean; e?: number; n?: string }
      if (!v.u || !v.n || typeof v.e !== 'number' || v.e < now().getTime()) return null
      return { userId: v.u, desktop: v.d === true, nonce: v.n }
    } catch {
      return null
    }
  }

  const connectionOf = async (userId: string): Promise<Connection | undefined> => (await db.select().from(conns).where(eq(conns.userId, userId)))[0]

  async function dropConnection(userId: string) {
    await db.delete(links).where(eq(links.userId, userId))
    await db.delete(conns).where(eq(conns.userId, userId))
  }

  /**
   * Runs `fn` with a working access token. Refreshes it when needed, once more if Google rejects it,
   * and forgets the connection if Google says the permission is gone.
   */
  async function withGoogle<T>(userId: string, fn: (token: string, conn: Connection) => Promise<T>): Promise<T> {
    const g = need()
    const conn = await connectionOf(userId)
    if (!conn) throw conflict('Google Calendar is not connected.', { code: 'google_not_connected' })

    const refresh = async (): Promise<string> => {
      try {
        const fresh = await g.client.refresh(decryptSecret(conn.encryptedRefreshToken, secret))
        await db
          .update(conns)
          .set({ encryptedAccessToken: encryptSecret(fresh.accessToken, secret), accessExpiresAt: fresh.expiresAt, updatedAt: now() })
          .where(eq(conns.userId, userId))
        return fresh.accessToken
      } catch (e) {
        if (e instanceof GoogleAuthError) {
          await dropConnection(userId)
          throw conflict(RECONNECT_MESSAGE, { code: 'google_reconnect' })
        }
        throw e
      }
    }

    try {
      let token: string
      if (conn.encryptedAccessToken && conn.accessExpiresAt && conn.accessExpiresAt.getTime() > now().getTime() + 60_000) {
        token = decryptSecret(conn.encryptedAccessToken, secret)
      } else {
        token = await refresh()
      }
      try {
        return await fn(token, conn)
      } catch (e) {
        if (!(e instanceof GoogleUnauthorizedError)) throw e
        return await fn(await refresh(), conn) // the token was cut short: one fresh one, one retry
      }
    } catch (e) {
      throw googleFailure(e)
    }
  }

  // ---- mapping ----
  function toEvent(e: GoogleEvent): CalendarEvent | null {
    const start = e.start?.date ?? e.start?.dateTime
    if (!start || e.status === 'cancelled') return null
    const taskId = e.extendedProperties?.private?.timedeskTaskId
    return {
      id: e.id,
      title: e.summary?.trim() || '(no title)',
      start,
      end: e.end?.date ?? e.end?.dateTime ?? start,
      allDay: Boolean(e.start?.date),
      description: e.description ?? '',
      link: e.htmlLink ?? null,
      ...(taskId ? { timedeskTaskId: taskId } : {}),
    }
  }

  function whenInput(v: { start: string; end?: string; allDay?: boolean; timeZone?: string }): Pick<GoogleEventInput, 'start' | 'end'> {
    const allDay = v.allDay ?? dayOnly.test(v.start)
    if (allDay) {
      return { start: { date: v.start, dateTime: null }, end: { date: v.end ?? addDays(v.start, 1), dateTime: null } }
    }
    const end = v.end ?? new Date(Date.parse(v.start) + 3_600_000).toISOString()
    return {
      start: { dateTime: v.start, date: null, ...(v.timeZone ? { timeZone: v.timeZone } : {}) },
      end: { dateTime: end, date: null, ...(v.timeZone ? { timeZone: v.timeZone } : {}) },
    }
  }

  const taskEvent = (t: Task): GoogleEventInput => ({
    summary: `${t.status === 'done' ? DONE_MARK : ''}${t.title}`,
    description: 'A task from timedesk. Move it or rename it here and the task follows.',
    start: { date: t.due!, dateTime: null },
    end: { date: addDays(t.due!, 1), dateTime: null },
    extendedProperties: { private: { timedeskTaskId: t.id, timedeskManaged: '1' } },
    transparency: 'transparent',
  })

  // ---- task mirroring ----
  const linkOf = async (taskId: string) => (await db.select().from(links).where(eq(links.taskId, taskId)))[0]

  async function mirrorTaskNow(userId: string, task: Task) {
    const conn = await connectionOf(userId)
    if (!conn || !conn.pushTasks || !google) return
    const link = await linkOf(task.id)

    if (task.deletedAt || !task.due) {
      if (link) await removeMirror(userId, link.taskId)
      return
    }
    if (!link && task.status === 'done') return // finished tasks are not newly added to the calendar

    await withGoogle(userId, async (token, c) => {
      const body = taskEvent(task)
      if (link && !isDeleted(link)) {
        try {
          const updated = await google.client.patchEvent(token, c.calendarId, link.googleEventId, body)
          await db.update(links).set({ etag: updated.etag ?? null, updatedAt: now() }).where(eq(links.taskId, task.id))
          return
        } catch (e) {
          if (!(e instanceof GoogleApiError && e.status === 404)) throw e
          // The event was removed in Google: make a fresh one below.
        }
      }
      const created = await google.client.insertEvent(token, c.calendarId, body)
      if (link) await db.update(links).set({ googleEventId: created.id, etag: created.etag ?? null, updatedAt: now() }).where(eq(links.taskId, task.id))
      else await db.insert(links).values({ id: crypto.randomUUID(), userId, taskId: task.id, googleEventId: created.id, etag: created.etag ?? null })
    })
  }

  async function removeMirror(userId: string, taskId: string) {
    const link = await linkOf(taskId)
    if (!link) return
    if (!isDeleted(link)) await withGoogle(userId, (token, c) => google!.client.deleteEvent(token, c.calendarId, link.googleEventId))
    await db.delete(links).where(eq(links.taskId, taskId))
  }

  /** Never lets a Google problem break saving a task. True when it worked. */
  const safely = async (what: string, fn: () => Promise<void>): Promise<boolean> => {
    try {
      await fn()
      return true
    } catch (e) {
      console.error(`Google Calendar: could not ${what}:`, e instanceof Error ? e.message : 'unknown error')
      return false
    }
  }

  /**
   * Mirrors open tasks that have no event yet, a few per request. One task Google refuses is logged and skipped; it
   * does not stop the others. `remaining` says how many are left for the next sync.
   */
  async function pushMissing(userId: string): Promise<{ pushed: number; remaining: number }> {
    const linked = new Set((await db.select({ taskId: links.taskId }).from(links).where(eq(links.userId, userId))).map((l) => l.taskId))
    const open = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt), ne(tasks.status, 'done')))
    const missing = open.filter((t) => t.due && !linked.has(t.id))
    const thisTime = missing.slice(0, MAX_TASKS_PER_PUSH)
    let pushed = 0
    for (const t of thisTime) if (await safely('mirror a task', () => mirrorTaskNow(userId, t))) pushed++
    return { pushed, remaining: missing.length - pushed }
  }

  return {
    configured,

    async status(userId: string): Promise<GoogleStatus> {
      const conn = google ? await connectionOf(userId) : undefined
      return {
        configured: configured(),
        connected: Boolean(conn),
        email: conn?.email ?? null,
        pushTasks: conn?.pushTasks ?? true,
        lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null,
      }
    },

    /** The Google sign-in address for this person. The state ties the round trip to them, works once and expires in 10 minutes. */
    async connectUrl(userId: string, desktop: boolean): Promise<{ url: string }> {
      const g = need()
      return { url: g.client.authUrl({ redirectUri: g.redirectUri, state: await makeState(userId, desktop) }) }
    },

    /**
     * Google sends the browser back here. The signed state says who started the flow, and it works only once.
     *
     * So that nobody can start a flow on their own account and trick someone else into finishing it (which would attach
     * the victim's Google Calendar to the attacker's account), the browser flow also needs the login cookie of that same
     * person on this request. The desktop app signs in with a token, which the system browser does not have, so there
     * only a different signed-in person is refused. What that leaves open: someone who is NOT signed in to timedesk in
     * their browser and is tricked into finishing another person's desktop link would attach their calendar to that
     * person. Closing it needs a confirmation step (or a desktop loopback redirect), not just the state.
     */
    async finishConnect(input: { code?: string; state?: string; error?: string; sessionUserId?: string }): Promise<{ ok: boolean; desktop: boolean; redirect: string }> {
      const state = readState(input.state)
      const back = (ok: boolean) => `${webOrigin}/settings?tab=calendar&google=${ok ? 'connected' : 'error'}`
      if (!state) return { ok: false, desktop: false, redirect: back(false) }
      const fail = { ok: false, desktop: state.desktop, redirect: back(false) }
      if (input.error || !input.code || !google) return fail
      const samePerson = state.desktop ? !input.sessionUserId || input.sessionUserId === state.userId : input.sessionUserId === state.userId
      if (!samePerson) return fail
      if (!(await redeem(state.nonce, state.userId))) return fail // used already, or expired
      try {
        const t = await google.client.exchangeCode({ code: input.code, redirectUri: google.redirectUri })
        const existing = await connectionOf(state.userId)
        const refresh = t.refreshToken ?? (existing ? decryptSecret(existing.encryptedRefreshToken, secret) : null)
        if (!refresh) return { ok: false, desktop: state.desktop, redirect: back(false) }
        const values = {
          email: t.email,
          encryptedRefreshToken: encryptSecret(refresh, secret),
          encryptedAccessToken: encryptSecret(t.accessToken, secret),
          accessExpiresAt: t.expiresAt,
          updatedAt: now(),
        }
        await db
          .insert(conns)
          .values({ userId: state.userId, ...values })
          .onConflictDoUpdate({ target: conns.userId, set: values })
        return { ok: true, desktop: state.desktop, redirect: back(true) }
      } catch {
        return { ok: false, desktop: state.desktop, redirect: back(false) }
      }
    },

    /** Forgets the connection here, and asks Google to cancel the permission (best effort). */
    async disconnect(userId: string) {
      const conn = await connectionOf(userId)
      if (conn && google) {
        try {
          await google.client.revoke(decryptSecret(conn.encryptedRefreshToken, secret))
        } catch {
          // The tokens are removed below either way.
        }
      }
      await dropConnection(userId)
    },

    async setPushTasks(userId: string, pushTasks: boolean) {
      const conn = await connectionOf(userId)
      if (!conn) throw conflict('Google Calendar is not connected.', { code: 'google_not_connected' })
      await db.update(conns).set({ pushTasks, updatedAt: now() }).where(eq(conns.userId, userId))
      if (pushTasks) await pushMissing(userId) // the rest, if there are many, follow with the next sync
    },

    async listEvents(userId: string, range: { from: Date; to: Date }): Promise<CalendarEvent[]> {
      return withGoogle(userId, async (token, c) => {
        const raw = await need().client.listEvents(token, c.calendarId, { timeMin: range.from.toISOString(), timeMax: range.to.toISOString() })
        return raw.map(toEvent).filter((e): e is CalendarEvent => e !== null)
      })
    },

    async createEvent(userId: string, input: CreateCalendarEvent): Promise<CalendarEvent> {
      return withGoogle(userId, async (token, c) => {
        const e = await need().client.insertEvent(token, c.calendarId, { summary: input.title, description: input.description, ...whenInput(input) })
        return toEvent(e)!
      })
    },

    async updateEvent(userId: string, eventId: string, input: UpdateCalendarEvent): Promise<CalendarEvent> {
      return withGoogle(userId, async (token, c) => {
        const g = need()
        const current = await g.client.getEvent(token, c.calendarId, eventId)
        if (!current) throw notFound('Event')
        if (current.extendedProperties?.private?.timedeskTaskId) throw conflict('This event mirrors a task. Change the task instead.')
        const patch: GoogleEventInput = {}
        if (input.title !== undefined) patch.summary = input.title
        if (input.description !== undefined) patch.description = input.description
        if (input.start !== undefined) Object.assign(patch, whenInput({ start: input.start, end: input.end, allDay: input.allDay, timeZone: input.timeZone }))
        return toEvent(await g.client.patchEvent(token, c.calendarId, eventId, patch))!
      })
    },

    async deleteEvent(userId: string, eventId: string) {
      await withGoogle(userId, async (token, c) => {
        const g = need()
        const current = await g.client.getEvent(token, c.calendarId, eventId)
        if (!current) throw notFound('Event')
        if (current.extendedProperties?.private?.timedeskTaskId) throw conflict('This event mirrors a task. Delete or change the task instead.')
        await g.client.deleteEvent(token, c.calendarId, eventId)
      })
    },

    /** Called after a task is created or changed. A Google problem is logged and never fails the task. */
    mirrorTask: async (userId: string, task: Task) => void (await safely('mirror a task', () => mirrorTaskNow(userId, task))),
    unmirrorTask: async (userId: string, taskId: string) => void (await safely('remove a task mirror', () => removeMirror(userId, taskId))),

    /**
     * Brings Google's changes in: a mirrored event that was moved or renamed in Google updates its
     * task, and one deleted in Google drops its link (the task stays). Then mirrors tasks that have no event yet.
     */
    async sync(userId: string): Promise<GoogleSyncResult & { remaining: number }> {
      // Where the next sync starts. When Google had more changes than one listing reads, only as far as was read.
      let syncedUpTo: Date | null = now()
      const result = await withGoogle(userId, async (token, c) => {
        const managed = { privateProp: 'timedeskManaged=1', showDeleted: true, oldestChangeFirst: true }
        // First sync: read every event timedesk manages. Later: only what changed since the last sync.
        const since = c.lastSyncAt ? new Date(c.lastSyncAt.getTime() - 60_000) : null
        let changed: Awaited<ReturnType<GoogleClient['listEvents']>>
        try {
          changed = await need().client.listEvents(token, c.calendarId, since ? { ...managed, updatedMin: since.toISOString() } : managed)
        } catch (e) {
          // Google only reports changes of roughly the last 20 days, and answers 410 for older ones: read them all once instead.
          if (!(since && e instanceof GoogleApiError && e.status === 410)) throw e
          changed = await need().client.listEvents(token, c.calendarId, managed)
        }
        const out: GoogleSyncResult = { checked: 0, updatedTasks: 0, pushed: 0, unlinked: 0 }
        if (changed.more) {
          const last = Math.max(...changed.map((e) => Date.parse(e.updated ?? '')).filter((t) => Number.isFinite(t)))
          syncedUpTo = Number.isFinite(last) ? new Date(last) : c.lastSyncAt // nothing usable read: start from the same place again
        }

        for (const e of changed) {
          const taskId = e.extendedProperties?.private?.timedeskTaskId
          if (!taskId) continue
          const link = await linkOf(taskId)
          if (!link || link.userId !== userId || link.googleEventId !== e.id) continue
          out.checked++

          if (e.status === 'cancelled') {
            await db.update(links).set({ googleEventId: deletedMarker(taskId), etag: null, updatedAt: now() }).where(eq(links.taskId, taskId))
            out.unlinked++
            continue
          }
          if (link.etag && link.etag === e.etag) continue // our own write, nothing new

          const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
          if (task) {
            const title = (e.summary ?? '').replace(/^✓\s*/, '').trim()
            const due = e.start?.date ?? e.start?.dateTime?.slice(0, 10)
            const patch: Partial<Pick<Task, 'title' | 'due'>> = {}
            if (title && title !== task.title) patch.title = title.slice(0, 300)
            if (due && dayOnly.test(due) && due !== task.due) patch.due = due
            if (Object.keys(patch).length > 0) {
              await db.update(tasks).set({ ...patch, updatedAt: now() }).where(eq(tasks.id, taskId))
              out.updatedTasks++
            }
          }
          await db.update(links).set({ etag: e.etag ?? null, updatedAt: now() }).where(eq(links.taskId, taskId))
        }
        return out
      })

      const conn = await connectionOf(userId)
      let remaining = 0
      if (conn?.pushTasks) ({ pushed: result.pushed, remaining } = await pushMissing(userId))
      await db.update(conns).set({ lastSyncAt: syncedUpTo, updatedAt: now() }).where(eq(conns.userId, userId))
      // `remaining` is new: tasks still waiting to be mirrored (older apps ignore it). Sync again to send them.
      return { ...result, remaining }
    },

    /** Used by tests and clean-up: how many tasks of this person are mirrored. */
    async linkedTaskIds(userId: string): Promise<string[]> {
      const rows = await db.select({ taskId: links.taskId }).from(links).where(eq(links.userId, userId))
      return rows.map((r) => r.taskId)
    },
  }
}

export type GoogleCalendarService = ReturnType<typeof createGoogleCalendarService>
