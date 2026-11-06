import { addDays } from './calendar.ts'
import { toDateKey } from './tasks.ts'

/** One event from the person's Google Calendar, in the shape the API sends to the browser. */
export interface CalendarEvent {
  id: string
  title: string
  /** All-day events: a date (YYYY-MM-DD). Timed events: an ISO date-time with its offset. */
  start: string
  /** Same format as `start`. For all-day events this is the first day AFTER the event (the way Google and iCal do it). */
  end: string
  allDay: boolean
  description: string
  /** Opens the event in Google Calendar. */
  link: string | null
  /** Set when this event is the mirror of a timedesk task (the task is shown instead of the event). */
  timedeskTaskId?: string
}

export interface GoogleStatus {
  /** False when the server has no Google client id and secret: the feature is simply switched off. */
  configured: boolean
  connected: boolean
  email: string | null
  pushTasks: boolean
  lastSyncAt: string | null
}

export interface GoogleSyncResult {
  /** Linked events looked at. */
  checked: number
  /** Tasks changed because the event was moved or renamed in Google. */
  updatedTasks: number
  /** Tasks newly mirrored to Google. */
  pushed: number
  /** Events deleted in Google: the link was dropped and the task kept. */
  unlinked: number
}

const localMidnight = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

/** The events that touch a local calendar day (all-day events across several days included). */
export function eventsOnDay(events: CalendarEvent[], day: string): CalendarEvent[] {
  const start = localMidnight(day)
  const end = localMidnight(addDays(day, 1))
  return events
    .filter((e) => {
      if (e.allDay) return e.start <= day && day < e.end
      const s = new Date(e.start).getTime()
      const f = new Date(e.end).getTime()
      return s < end && Math.max(f, s + 1) > start
    })
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
}

/** The local date key an event starts on. */
export const eventStartDay = (e: CalendarEvent): string => (e.allDay ? e.start : toDateKey(new Date(e.start).getTime()))

/** "9:30 AM" for a timed event, or "" for an all-day one. */
export function eventTimeLabel(e: CalendarEvent): string {
  if (e.allDay) return ''
  return new Date(e.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
