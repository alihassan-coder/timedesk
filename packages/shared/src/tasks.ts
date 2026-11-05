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
  if (!due) return 'none'
  const days = daysUntil(due, now)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days <= 7) return 'this_week'
  return 'later'
}

/** The next due date (YYYY-MM-DD) after `due` for a recurring task. */
export function nextDue(due: string, r: Recurrence): string {
  const [y, m, d] = due.split('-').map(Number)
  const next =
    r.freq === 'monthly'
      ? new Date(y, m, d)
      : new Date(y, m - 1, d + (r.freq === 'daily' ? 1 : r.freq === 'weekly' ? 7 : Math.max(1, r.every ?? 1)))
  return toDateKey(next.getTime())
}

export function describeRecurrence(r: Recurrence): string {
  if (r.freq === 'custom') return `Every ${r.every ?? 1} days`
  return { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[r.freq]
}
