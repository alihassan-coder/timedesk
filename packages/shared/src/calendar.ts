import { toDateKey } from './tasks.ts'

/** Date helpers for the day, week and month task views. All dates are local YYYY-MM-DD keys. */

function parse(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (key: string, n: number): string => {
  const d = parse(key)
  d.setDate(d.getDate() + n)
  return toDateKey(d.getTime())
}

/** The first day of the month containing `key`, then moved by `n` months. */
export const addMonths = (key: string, n: number): string => {
  const d = parse(key)
  return toDateKey(new Date(d.getFullYear(), d.getMonth() + n, 1).getTime())
}

/** Monday of the week containing `key`. */
export const startOfWeek = (key: string): string => {
  const day = (parse(key).getDay() + 6) % 7 // Monday = 0
  return addDays(key, -day)
}

/** The 7 days (Monday to Sunday) of the week containing `key`. */
export const weekDays = (key: string): string[] => {
  const start = startOfWeek(key)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** Whole weeks (Monday to Sunday) that cover the month containing `key`: 4 to 6 rows of 7 days. */
export const monthGrid = (key: string): string[][] => {
  const d = parse(key)
  const first = toDateKey(new Date(d.getFullYear(), d.getMonth(), 1).getTime())
  const last = toDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime())
  const weeks: string[][] = []
  let cursor = startOfWeek(first)
  while (cursor <= last) {
    weeks.push(weekDays(cursor))
    cursor = addDays(cursor, 7)
  }
  return weeks
}

export const sameMonth = (a: string, b: string): boolean => a.slice(0, 7) === b.slice(0, 7)

export const dayOfMonth = (key: string): number => Number(key.slice(8, 10))

export interface RangeBucket {
  label: string
  /** Local start, ms. */
  start: number
  /** Local end (exclusive), ms. */
  end: number
}

const ms = (key: string) => parse(key).getTime()

/** Days from `from` to `to`, both included. */
export const daysInRange = (from: string, to: string): number => Math.round((ms(addDays(to, 1)) - ms(from)) / 86_400_000)

/**
 * Splits a custom date range into chart buckets: one per day up to 31 days, one per week up to
 * about six months, one per month beyond that. The first and last bucket are cut to the range.
 */
export function rangeBuckets(from: string, to: string): { unit: 'day' | 'week' | 'month'; buckets: RangeBucket[] } {
  const total = daysInRange(from, to)
  if (total <= 0) return { unit: 'day', buckets: [] }
  const last = addDays(to, 1) // exclusive end
  const label = (key: string, o: Intl.DateTimeFormatOptions) => parse(key).toLocaleDateString(undefined, o)
  const unit = total <= 31 ? 'day' : total <= 182 ? 'week' : 'month'
  const buckets: RangeBucket[] = []
  let cursor = from
  while (cursor < last) {
    let next: string
    if (unit === 'day') next = addDays(cursor, 1)
    else if (unit === 'week') next = addDays(startOfWeek(cursor), 7)
    else next = addMonths(cursor, 1)
    if (next > last) next = last
    const text =
      unit === 'month'
        ? label(cursor, { month: 'short', year: from.slice(0, 4) === to.slice(0, 4) ? undefined : '2-digit' })
        : label(cursor, { day: 'numeric', month: 'short' })
    buckets.push({ label: text, start: ms(cursor), end: ms(next) })
    cursor = next
  }
  return { unit, buckets }
}
