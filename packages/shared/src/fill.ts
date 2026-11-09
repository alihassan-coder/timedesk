import type { TimeEntry } from './types.ts'

/**
 * Filling in the day: the parts of a day nothing was tracked for, and a good guess of what they were, from calendar
 * meetings and from which apps were in front (desktop app tracking). The person approves each one; nothing is added
 * on its own. Pure functions, so the rules are tested once and used by the web app and the API.
 */

export interface Interval {
  start: number
  end: number
}

/** Sorted, with overlapping or touching intervals joined. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start)
  const out: Interval[] = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end)
    else out.push({ ...i })
  }
  return out
}

/** What is left of `from` after taking away `minus`. */
export function subtractIntervals(from: Interval[], minus: Interval[]): Interval[] {
  const cut = mergeIntervals(minus)
  const out: Interval[] = []
  for (const piece of mergeIntervals(from)) {
    let start = piece.start
    for (const m of cut) {
      if (m.end <= start || m.start >= piece.end) continue
      if (m.start > start) out.push({ start, end: m.start })
      start = Math.max(start, m.end)
      if (start >= piece.end) break
    }
    if (start < piece.end) out.push({ start, end: piece.end })
  }
  return out
}

const overlap = (a: Interval, b: Interval) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))

/** One stretch of time with the same app in front (from the desktop app's tracking). */
export interface ActivityBlock {
  app: string
  start: number
  end: number
}

/** A calendar event with a time (all-day events are not time spent). */
export interface TimedEvent {
  title: string
  start: number
  end: number
}

export interface GapSuggestion {
  /** Stable for the same stretch of time, so a skipped suggestion stays skipped. */
  id: string
  /** meeting: from the calendar. activity: apps were in use. gap: nothing tracked and no clue what it was. */
  kind: 'meeting' | 'activity' | 'gap'
  start: number
  end: number
  /** "Design review", "VS Code, Figma", or "Not tracked". */
  label: string
  /** The apps in front, most used first (activity only). */
  apps: string[]
  /** The project these apps are usually tracked on, or null. */
  projectId: string | null
}

const MINUTE = 60_000
const roundMinute = (ms: number) => Math.round(ms / MINUTE) * MINUTE

/**
 * Which project each app is usually tracked on: for every stretch an app was in front while a timer with a project ran,
 * that project gets the time. The project with the most time wins, if it has at least half of that app's tracked time.
 */
export function learnAppProjects(activity: ActivityBlock[], entries: TimeEntry[], now: number): Record<string, string> {
  const withProject = entries.filter((e) => e.projectId && e.share === undefined)
  const per = new Map<string, Map<string, number>>()
  for (const a of activity) {
    for (const e of withProject) {
      const ms = overlap(a, { start: e.startedAt, end: e.endedAt ?? now })
      if (ms <= 0) continue
      const m = per.get(a.app) ?? new Map<string, number>()
      m.set(e.projectId!, (m.get(e.projectId!) ?? 0) + ms)
      per.set(a.app, m)
    }
  }
  const out: Record<string, string> = {}
  for (const [app, m] of per) {
    const total = [...m.values()].reduce((s, v) => s + v, 0)
    const [best, ms] = [...m.entries()].sort((a, b) => b[1] - a[1])[0]
    if (ms >= total / 2) out[app] = best
  }
  return out
}

/** Apps in front over a stretch, most used first. */
function appsIn(piece: Interval, activity: ActivityBlock[]): { app: string; ms: number }[] {
  const by = new Map<string, number>()
  for (const a of activity) {
    const ms = overlap(piece, a)
    if (ms > 0) by.set(a.app, (by.get(a.app) ?? 0) + ms)
  }
  return [...by.entries()].map(([app, ms]) => ({ app, ms })).sort((a, b) => b.ms - a.ms)
}

/**
 * The day's untracked time, with what it probably was. Meetings come first (they are certain), then stretches where
 * apps were in use (activity close together is joined, so a two-minute coffee does not split it), then plain gaps
 * between tracked time. Pieces shorter than `minMs` are left out.
 */
export function suggestGaps(input: {
  entries: TimeEntry[]
  activity: ActivityBlock[]
  events: TimedEvent[]
  /** The part of the day to look at (for today: up to now). */
  from: number
  to: number
  now: number
  appProjects?: Record<string, string>
  minMs?: number
  /** Activity closer together than this is one stretch of work. */
  joinMs?: number
}): GapSuggestion[] {
  const { from, to, now } = input
  const minMs = input.minMs ?? 10 * MINUTE
  const joinMs = input.joinMs ?? 5 * MINUTE
  const clip = (i: Interval): Interval => ({ start: Math.max(from, i.start), end: Math.min(to, i.end) })
  const out: GapSuggestion[] = []
  const add = (kind: GapSuggestion['kind'], piece: Interval, label: string, apps: string[], projectId: string | null) => {
    const start = roundMinute(piece.start)
    const end = roundMinute(piece.end)
    if (end - start < minMs) return
    out.push({ id: `${kind}:${start}:${end}`, kind, start, end, label, apps, projectId })
  }

  const tracked = mergeIntervals(input.entries.filter((e) => e.share === undefined).map((e) => clip({ start: e.startedAt, end: e.endedAt ?? now })))

  // Meetings from the calendar that no timer covered.
  for (const ev of [...input.events].sort((a, b) => a.start - b.start)) {
    for (const piece of subtractIntervals([clip(ev)], tracked)) add('meeting', piece, ev.title || 'Meeting', [], null)
  }
  const known = mergeIntervals([...tracked, ...out])

  // Stretches of work in apps that no timer or meeting covered.
  const blocks = input.activity.map((a) => ({ ...a, ...clip(a) })).filter((a) => a.end > a.start)
  const sessions = mergeIntervals(blocks.map((b) => ({ start: b.start, end: b.end + joinMs }))).map((s) => ({ start: s.start, end: s.end - joinMs }))
  for (const piece of subtractIntervals(sessions, known)) {
    const apps = appsIn(piece, blocks)
    if (apps.length === 0) continue
    // The project of the apps that took most of the time.
    const votes = new Map<string, number>()
    for (const a of apps) {
      const p = input.appProjects?.[a.app]
      if (p) votes.set(p, (votes.get(p) ?? 0) + a.ms)
    }
    const projectId = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const names = apps.slice(0, 3).map((a) => a.app)
    add('activity', piece, names.join(', '), names, projectId)
  }

  // Plain gaps between tracked time (lunch, or a timer that was forgotten): only between the first and last tracked
  // moment of the day, and only longer ones, so the list stays short.
  const all = mergeIntervals([...tracked, ...out, ...sessions])
  if (all.length > 1) {
    const span = { start: all[0].start, end: all[all.length - 1].end }
    for (const piece of subtractIntervals([span], all)) add('gap', piece, 'Not tracked', [], null)
  }

  return out.sort((a, b) => a.start - b.start)
}
