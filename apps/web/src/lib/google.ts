import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
}
let state: StatusState = { userId: null, status: null }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()
const emit = (next: StatusState) => {
  state = next
  listeners.forEach((l) => l())
}

async function loadStatus(userId: string) {
  try {
    const status = await api<GoogleStatus>('/integrations/google')
    emit({ userId, status })
  } catch {
    // Keep what we had. A failed check must not look like "not connected".
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
  // Another person signed in on this device: forget the previous person's status.
  const status = current.userId === userId ? current.status : null
  useEffect(() => {
    if (userId && current.userId !== userId) void refreshGoogleStatus(userId)
  }, [userId, current.userId])
  const refresh = useCallback(() => (userId ? refreshGoogleStatus(userId) : Promise.resolve()), [userId])
  return { status, loading: status === null, refresh }
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

/**
 * The person's own Google events between two local dates (the second one is NOT included). Events that
 * only mirror a timedesk task are left out, because the task itself is shown. Does nothing until `enabled`.
 */
export function useGoogleEvents(fromKey: string, toKey: string, enabled: boolean) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const request = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const mine = ++request.current
    const query = new URLSearchParams({ from: midnight(fromKey).toISOString(), to: midnight(toKey).toISOString() })
    api<{ events: CalendarEvent[] }>(`/calendar/events?${query}`)
      .then((r) => {
        if (mine !== request.current) return // a newer request replaced this one
        setEvents(r.events.filter((e) => !e.timedeskTaskId))
        setError('')
      })
      .catch((e) => {
        if (mine !== request.current) return
        setError(message(e))
        // The permission was withdrawn in Google: make every screen notice.
        if (e instanceof ApiError && e.status === 409) void refreshGoogleStatus(state.userId ?? '')
      })
  }, [fromKey, toKey, enabled, tick])

  return { events: enabled ? events : [], error, reload: () => setTick((t) => t + 1) }
}
