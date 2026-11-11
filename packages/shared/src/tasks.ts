import type { DueBucket, Recurrence } from './types.ts'

/** Local YYYY-MM-DD for a timestamp. */
export function toDateKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

/** Whole days from today to `due` (negative = overdue). */
export function daysUntil(due: string, now: number): number {
  return dayNumber(due) - dayNumber(toDateKey(now))
}

export const DUE_BUCKET_ORDER: DueBucket[] = ['overdue', 'today', 'tomorrow', 'this_week', 'later', 'none']

export const DUE_BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  this_week: 'This week',
  later: 'Later',
  none: 'No date',
}

/** Which due-date category a task falls in. "This week" = the next 2 to 7 days. */
export function dueBucket(due: string | null, now: number): DueBucket {
  return dueBucketOn(due, toDateKey(now))
}

/** Like dueBucket, for a given "today" (YYYY-MM-DD). The server uses it with the user's own date, not its clock's. */
export function dueBucketOn(due: string | null, today: string): DueBucket {
  if (!due) return 'none'
  const days = dayNumber(due) - dayNumber(today)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days <= 7) return 'this_week'
  return 'later'
}

/**
 * The next due date (YYYY-MM-DD) after `due` for a recurring task. Monthly keeps the day number, but never runs
 * past the end of the next month: 31 Jan becomes 28 (or 29) Feb, not 3 Mar. Works in UTC, so no clock change can shift it.
 */
export function nextDue(due: string, r: Recurrence): string {
  const [y, m, d] = due.split('-').map(Number)
  let next: Date
  if (r.freq === 'monthly') {
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate() // m is 1-based, so month index m is the next month
    next = new Date(Date.UTC(y, m, Math.min(d, lastDay)))
  } else {
    next = new Date(Date.UTC(y, m - 1, d + (r.freq === 'daily' ? 1 : r.freq === 'weekly' ? 7 : Math.max(1, r.every ?? 1))))
  }
  return next.toISOString().slice(0, 10)
}

export function describeRecurrence(r: Recurrence): string {
  if (r.freq === 'custom') return `Every ${r.every ?? 1} days`
  return { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[r.freq]
}

