import { startOfWeek } from './calendar.ts'
import { toDateKey } from './tasks.ts'
import type { Task } from './types.ts'

/** Finished tasks leave the board and list this many days after they were finished, into the Archive. */
export const ARCHIVE_AFTER_DAYS = 7

/**
 * Archived = finished at least ARCHIVE_AFTER_DAYS ago. Nothing is stored or deleted: it is only where the task is shown.
 * Repeating tasks archive like any other, because finishing one already created the next, open copy. A finished task
 * without a finish time (from before finish times were saved) is old, so it is archived.
 */
export function isArchived(t: Pick<Task, 'status' | 'completedAt'>, now: number): boolean {
  if (t.status !== 'done') return false
  return t.completedAt === null || now - t.completedAt >= ARCHIVE_AFTER_DAYS * 86_400_000
}

/** The tasks to show on the board and list, and the archived ones (newest finished first). */
export function splitArchived(tasks: Task[], now: number): { active: Task[]; archived: Task[] } {
  const active: Task[] = []
  const archived: Task[] = []
  for (const t of tasks) (isArchived(t, now) ? archived : active).push(t)
  archived.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
  return { active, archived }
}

/** Archived tasks by the week they were finished (week start key), newest week first. No finish time: last, weekStart null. */
export function archiveByWeek(archived: Task[]): { weekStart: string | null; tasks: Task[] }[] {
  const groups = new Map<string | null, Task[]>()
  for (const t of [...archived].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))) {
    const key = t.completedAt === null ? null : startOfWeek(toDateKey(t.completedAt))
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b.localeCompare(a)))
    .map(([weekStart, tasks]) => ({ weekStart, tasks }))
}
