import type { Project, Task, TimeEntry } from '@timedesk/shared'
/** "Write docs", or "Write docs + Render video" while multitasking, for the tray and the floating timer. */
export function timersLabel(timers: TimeEntry[], tasks: Task[], projects: Project[]): string {
  const name = (e: TimeEntry) => tasks.find((t) => t.id === e.taskId)?.title ?? projects.find((p) => p.id === e.projectId)?.name ?? 'Stopwatch'
  const names = [...timers].reverse().map(name)
  if (names.length <= 2) return names.join(' + ')
  return `${names[0]} + ${names.length - 1} more`
}
