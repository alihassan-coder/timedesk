import { dueBucketOn } from './tasks.ts'
import { overlapMs } from './time.ts'
import type { DueBucket, Priority, TaskStatus, TimeEntry } from './types.ts'

/**
 * The facts behind Tempo's daily summary, weekly review and "plan my day". Everything here is plain arithmetic
 * on the person's data, so the numbers are exact and testable. The AI only turns them into words.
 */

export interface DigestDay {
  /** YYYY-MM-DD */
  key: string
  start: number
  /** Exclusive. */
  end: number
}

export interface DigestTask {
  id: string
  title: string
  projectId: string | null
  status: TaskStatus
  priority: Priority
  due: string | null
  /** When it was marked done (epoch ms), or null. */
  completedAt: number | null
}

export interface DigestProject {
  id: string
  name: string
}

export interface Digest {
  from: string
  to: string
  totalMs: number
  /** Total of the same number of days just before, for comparison. Null when not asked for. */
  previousTotalMs: number | null
  byProject: { projectId: string | null; name: string; ms: number }[]
  byDay: { date: string; ms: number }[]
  /** The day with the most tracked time, or null when nothing was tracked. */
  bestDay: { date: string; ms: number } | null
  /** Timer sessions that overlap the range. */
  sessions: number
  longestSessionMs: number
  /** Tasks marked done inside the range, newest first. */
  completed: { id: string; title: string; project: string | null }[]
}

export const NO_PROJECT = 'No project'

function trackedIn(entries: TimeEntry[], days: DigestDay[], now: number) {
  return days.map((d) => ({ date: d.key, ms: entries.reduce((s, e) => s + overlapMs(e, d.start, d.end, now), 0) }))
}

export function buildDigest(input: {
  days: DigestDay[]
  previousDays?: DigestDay[]
  entries: TimeEntry[]
  tasks: DigestTask[]
  projects: DigestProject[]
  now: number
}): Digest {
  const { days, entries, tasks, projects, now } = input
  if (days.length === 0) throw new Error('A digest needs at least one day.')
  const from = days[0].start
  const to = days[days.length - 1].end
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? NO_PROJECT) : NO_PROJECT)

  const byDay = trackedIn(entries, days, now)
  const totalMs = byDay.reduce((s, d) => s + d.ms, 0)

  const perProject = new Map<string | null, number>()
  let sessions = 0
  let longestSessionMs = 0
  for (const e of entries) {
    const ms = overlapMs(e, from, to, now)
    if (ms <= 0) continue
    sessions++
    longestSessionMs = Math.max(longestSessionMs, ms)
    // A project that was deleted counts as "no project", like it does in the rest of the app.
    const key = e.projectId && names.has(e.projectId) ? e.projectId : null
    perProject.set(key, (perProject.get(key) ?? 0) + ms)
  }
  const byProject = [...perProject.entries()]
    .map(([projectId, ms]) => ({ projectId, name: nameOf(projectId), ms }))
    .sort((a, b) => b.ms - a.ms)

  const best = byDay.reduce<{ date: string; ms: number } | null>((a, d) => (d.ms > 0 && (!a || d.ms > a.ms) ? d : a), null)

  const completed = tasks
    .filter((t) => t.status === 'done' && t.completedAt !== null && t.completedAt >= from && t.completedAt < to)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .map((t) => ({ id: t.id, title: t.title, project: t.projectId ? nameOf(t.projectId) : null }))

  return {
    from: days[0].key,
    to: days[days.length - 1].key,
    totalMs,
    previousTotalMs: input.previousDays ? trackedIn(entries, input.previousDays, now).reduce((s, d) => s + d.ms, 0) : null,
    byProject,
    byDay,
    bestDay: best,
    sessions,
    longestSessionMs,
    completed,
  }
}

export interface PlanCandidate {
  id: string
  title: string
  project: string | null
  priority: Priority
  status: TaskStatus
  due: string | null
  bucket: DueBucket
  /** Why it is on the list, in a few words. */
  reason: string
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

/**
 * Open tasks in the order they most need attention on `today`: overdue (longest first), due today, already
 * started, high priority, due in the next days, then the rest by priority.
 */
export function planCandidates(tasks: DigestTask[], projects: DigestProject[], today: string, limit = 10): PlanCandidate[] {
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const tier = (t: DigestTask, b: DueBucket) => {
    if (b === 'overdue') return 0
    if (b === 'today') return 1
    if (t.status === 'in_progress') return 2
    if (t.priority === 'high') return 3
    if (b === 'tomorrow' || b === 'this_week') return 4
    return 5
  }
  const reason = (t: DigestTask, b: DueBucket) =>
    b === 'overdue'
      ? `overdue since ${t.due}`
      : b === 'today'
        ? 'due today'
        : t.status === 'in_progress'
          ? 'already started'
          : t.priority === 'high'
            ? 'high priority'
            : b === 'tomorrow'
              ? 'due tomorrow'
              : b === 'this_week'
                ? `due ${t.due}`
                : 'open'

  return tasks
    .filter((t) => t.status !== 'done')
    .map((t) => ({ t, b: dueBucketOn(t.due, today) }))
    .sort(
      (x, y) =>
        tier(x.t, x.b) - tier(y.t, y.b) ||
        (x.t.due ?? '9999').localeCompare(y.t.due ?? '9999') ||
        PRIORITY_RANK[x.t.priority] - PRIORITY_RANK[y.t.priority] ||
        x.t.title.localeCompare(y.t.title),
    )
    .slice(0, limit)
    .map(({ t, b }) => ({
      id: t.id,
      title: t.title,
      project: t.projectId ? (names.get(t.projectId) ?? null) : null,
      priority: t.priority,
      status: t.status,
      due: t.due,
      bucket: b,
      reason: reason(t, b),
    }))
}

/** A spreadsheet cell: quoted when needed, and never read as a formula (a title like "=1+1" stays text). */
function cell(v: string | number): string {
  let s = String(v)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/**
 * Tracked time as CSV for a spreadsheet or an invoice, oldest first, in this device's local time. A running
 * timer is left out, since it has no end yet.
 */
export function timeEntriesCsv(
  entries: TimeEntry[],
  projects: DigestProject[],
  tasks: Pick<DigestTask, 'id' | 'title'>[],
): string {
  const project = new Map(projects.map((p) => [p.id, p.name]))
  const task = new Map(tasks.map((t) => [t.id, t.title]))
  const rows = [['Date', 'Start', 'End', 'Duration', 'Hours', 'Project', 'Task']]
  for (const e of [...entries].filter((x) => x.endedAt !== null).sort((a, b) => a.startedAt - b.startedAt)) {
    const start = new Date(e.startedAt)
    const end = new Date(e.endedAt!)
    const minutes = Math.round((e.endedAt! - e.startedAt) / 60_000)
    rows.push([
      localDate(start),
      localTime(start),
      localTime(end),
      `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`,
      (minutes / 60).toFixed(2),
      e.projectId ? (project.get(e.projectId) ?? NO_PROJECT) : NO_PROJECT,
      e.taskId ? (task.get(e.taskId) ?? '') : '',
    ] as string[])
  }
  return rows.map((r, i) => (i === 0 ? r.join(',') : r.map((c, j) => cell(j === 4 ? Number(c) : c)).join(','))).join('\r\n') + '\r\n'
}
