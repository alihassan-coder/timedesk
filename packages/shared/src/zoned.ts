import { addDays } from './calendar.ts'

/**
 * Dates in a named time zone (for example "Asia/Karachi"), for code that runs on a server whose own clock is in
 * another zone (Vercel runs in UTC). A browser can use the local helpers instead; the server cannot.
 */

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string) {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** Whether the runtime knows this IANA time zone name. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone)
    return true
  } catch {
    return false
  }
}

function parts(at: number, timeZone: string) {
  const out: Record<string, number> = {}
  for (const p of formatter(timeZone).formatToParts(new Date(at))) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number }
}

/** How far the zone is ahead of UTC at that instant, in ms. */
function offsetAt(at: number, timeZone: string): number {
  const p = parts(at, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(at / 1000) * 1000
}

/** The calendar date (YYYY-MM-DD) at that instant in the zone. */
export function zonedDateKey(at: number, timeZone: string): string {
  const p = parts(at, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** The hour of the day (0 to 23) at that instant in the zone. */
export function zonedHour(at: number, timeZone: string): number {
  return parts(at, timeZone).hour
}

/** The instant a calendar day starts (local midnight) in the zone. Correct across daylight saving changes. */
export function zonedDayStart(key: string, timeZone: string): number {
  const [y, m, d] = key.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  let start = guess - offsetAt(guess, timeZone)
  // The offset at midnight can differ from the offset at the guess when a clock change falls in between.
  const again = guess - offsetAt(start, timeZone)
  if (again !== start) start = again
  return start
}

export interface ZonedDay {
  /** YYYY-MM-DD */
  key: string
  start: number
  /** Exclusive: the start of the next day. */
  end: number
}

/** Every day from `from` to `to` (both included) with its start and end instants in the zone. */
export function zonedDays(from: string, to: string, timeZone: string): ZonedDay[] {
  const out: ZonedDay[] = []
  for (let key = from; key <= to && out.length < 400; key = addDays(key, 1)) {
    out.push({ key, start: zonedDayStart(key, timeZone), end: zonedDayStart(addDays(key, 1), timeZone) })
  }
  return out
}
