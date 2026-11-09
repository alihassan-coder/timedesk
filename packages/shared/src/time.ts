import { splitParallel } from './parallel.ts'
import type { ReportPeriod, TimeEntry } from './types.ts'

/** Duration of an entry in ms. A running entry counts up to `now`. A piece of shared time counts its share. */
export function entryDuration(entry: TimeEntry, now: number): number {
  return Math.max(0, (entry.endedAt ?? now) - entry.startedAt) * (entry.share ?? 1)
}

/** 3725000 -> "01:02:05" */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

/** 5400000 -> "1h 30m", 600000 -> "10m", 0 -> "0m". For summaries, not live timers. */
export function formatHours(ms: number): string {
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

/** Like formatHours, but shows seconds under a minute: 35000 -> "35s". For small amounts such as app tracking. */
export function formatShort(ms: number): string {
  return ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}s` : formatHours(ms)
}

/** Start (epoch ms, local time) of the day/month/quarter/year containing `at`. */
export function periodStart(period: ReportPeriod, at: number): number {
  const d = new Date(at)
  switch (period) {
    case 'day':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    case 'month':
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    case 'quarter':
      return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime()
    case 'year':
      return new Date(d.getFullYear(), 0, 1).getTime()
  }
}

/** Total tracked ms per task (key "" = no task) for entries starting in the period. */
export function totalsByTask(
  entries: TimeEntry[],
  period: ReportPeriod,
  now: number,
): Map<string, number> {
  const from = periodStart(period, now)
  const totals = new Map<string, number>()
  for (const e of splitParallel(entries)) {
    if (e.startedAt < from) continue
    const key = e.taskId ?? ''
    totals.set(key, (totals.get(key) ?? 0) + entryDuration(e, now))
  }
  return totals
}

/** Milliseconds of `entry` that fall inside [from, to). Entries crossing midnight are split. Shared time counts its share. */
export function overlapMs(entry: TimeEntry, from: number, to: number, now: number): number {
  const start = Math.max(entry.startedAt, from)
  const end = Math.min(entry.endedAt ?? now, to)
  return Math.max(0, end - start) * (entry.share ?? 1)
}

/** Tracked ms for each of the last `days` local days, oldest first, ending with today. */
export function dailyTotals(
  entries: TimeEntry[],
  now: number,
  days: number,
): { start: number; ms: number }[] {
  const pieces = splitParallel(entries)
  const t = new Date(now)
  const result: { start: number; ms: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(t.getFullYear(), t.getMonth(), t.getDate() - i).getTime()
    const end = new Date(t.getFullYear(), t.getMonth(), t.getDate() - i + 1).getTime()
    const ms = pieces.reduce((sum, e) => sum + overlapMs(e, start, end, now), 0)
    result.push({ start, ms })
  }
  return result
}
