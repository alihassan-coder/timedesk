import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CalendarEvent, GoogleStatus, GoogleSyncResult } from '@timedesk/shared'
import { api, ApiError } from '@/lib/api'
import { useProfile } from '@/lib/auth-client'
import { isDesktop } from '@/lib/desktop'

/**
 * Google Calendar on the browser side. Everything goes through the timedesk API: the browser never sees
 * a Google token. Status is kept in one place so every screen agrees on whether Google is connected.
 */

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Could not reach the server.')

// ---- connection status (shared by every screen) ----
interface StatusState {
  userId: string | null
  status: GoogleStatus | null
  /** The last check failed. `status` may still hold an older answer. */
  error: boolean
}
let state: StatusState = { userId: null, status: null, error: false }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()
const emit = (next: StatusState) => {
  state = next
  listeners.forEach((l) => l())
}

// The last answer per person, so the Calendar page can render at once and check again in the background.
const cacheKey = (userId: string) => `timedesk:google-status:${userId}`
function readCachedStatus(userId: string): GoogleStatus | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId))
    return raw ? (JSON.parse(raw) as GoogleStatus) : null
  } catch {
    return null // storage blocked or the value is broken
  }
}
function writeCachedStatus(userId: string, status: GoogleStatus) {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(status))
  } catch {
    // Storage blocked or full: the cache is only a head start.
  }
}

async function loadStatus(userId: string) {
  try {
    const status = await api<GoogleStatus>('/integrations/google')
    writeCachedStatus(userId, status)
    emit({ userId, status, error: false })
  } catch {
    // Keep what we had (or the cached answer). A failed check must not look like "not connected".
    const status = state.userId === userId ? state.status : readCachedStatus(userId)
    emit({ userId, status, error: true })
  }
}

/** Fetches the connection status now (and on first use). */
export function refreshGoogleStatus(userId: string): Promise<void> {
  if (!inflight) inflight = loadStatus(userId).finally(() => (inflight = null))
  return inflight
}

export function useGoogleStatus() {
  const { user } = useProfile()
  const userId = user?.id ?? null
  const current = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
  const cached = useMemo(() => (userId ? readCachedStatus(userId) : null), [userId])
  // Another person signed in on this device: forget the previous person's status.
  const mine = current.userId === userId
  const status = mine ? (current.status ?? cached) : cached
  const error = mine && current.error
  useEffect(() => {
    if (userId && current.userId !== userId) void refreshGoogleStatus(userId)
  }, [userId, current.userId])
  const refresh = useCallback(() => (userId ? refreshGoogleStatus(userId) : Promise.resolve()), [userId])
  return { status, loading: status === null && !error, error, refresh }
}

// ---- connecting ----
/** Opens Google's permission screen: in the browser this page is replaced; in the desktop app the system browser opens. */
export async function startGoogleConnect(): Promise<void> {
  const desktop = isDesktop()
  const { url } = await api<{ url: string }>('/integrations/google/connect', { method: 'POST', body: { desktop } })
  if (desktop) window.open(url, '_blank')
  else window.location.assign(url)
}

export async function disconnectGoogle(): Promise<void> {
  await api('/integrations/google', { method: 'DELETE' })
}

export const setGooglePushTasks = (pushTasks: boolean) => api<GoogleStatus>('/integrations/google', { method: 'PATCH', body: { pushTasks } })
export const syncGoogle = () => api<GoogleSyncResult>('/calendar/sync', { method: 'POST' })

// ---- events ----
export interface EventInput {
  title: string
  description: string
  start: string
  end?: string
  allDay: boolean
}

export const createGoogleEvent = (input: EventInput) => api<{ event: CalendarEvent }>('/calendar/events', { method: 'POST', body: input })
export const updateGoogleEvent = (id: string, input: Partial<EventInput>) =>
  api<{ event: CalendarEvent }>(`/calendar/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: input })
export const deleteGoogleEvent = (id: string) => api(`/calendar/events/${encodeURIComponent(id)}`, { method: 'DELETE' })

const midnight = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Events per person and range, kept for this session so going back to a month shows it at once while it reloads.
const eventCache = new Map<string, CalendarEvent[]>()

/**
 * The person's own Google events between two local dates (the second one is NOT included). Events that
 * only mirror a timedesk task are left out, because the task itself is shown. Does nothing until `enabled`.
 */
export function useGoogleEvents(fromKey: string, toKey: string, enabled: boolean) {
  const { user } = useProfile()
  const key = `${user?.id ?? ''}|${fromKey}|${toKey}`
  const [loaded, setLoaded] = useState<{ key: string; events: CalendarEvent[] }>(() => ({ key, events: eventCache.get(key) ?? [] }))
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const request = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const mine = ++request.current
    const query = new URLSearchParams({ from: midnight(fromKey).toISOString(), to: midnight(toKey).toISOString() })
    api<{ events: CalendarEvent[] }>(`/calendar/events?${query}`)
      .then((r) => {
        const fresh = r.events.filter((e) => !e.timedeskTaskId)
        eventCache.set(key, fresh)
        if (mine !== request.current) return // a newer request replaced this one
        setLoaded({ key, events: fresh })
        setError('')
      })
      .catch((e) => {
        if (mine !== request.current) return
        setError(message(e))
        // The permission was withdrawn in Google: make every screen notice.
        if (e instanceof ApiError && e.status === 409) {
          eventCache.clear()
          void refreshGoogleStatus(state.userId ?? '')
        }
      })
  }, [key, fromKey, toKey, enabled, tick])

  // Stale while revalidate: a range seen before shows its cached events while the fresh answer loads.
  // A new range keeps the previous events on screen until its own arrive, as before.
  const events = loaded.key === key ? loaded.events : (eventCache.get(key) ?? loaded.events)
  return { events: enabled ? events : [], error: enabled ? error : '', reload: () => setTick((t) => t + 1) }
}
