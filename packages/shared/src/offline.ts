import type { Project, Task, TaskStatus, TimeEntry } from './types.ts'

/**
 * Working offline. Every change the app makes is an operation: applied to the screen at once, kept in an outbox on
 * the device, and sent to the server in order when there is a connection. If the page reloads or the computer
 * restarts, the outbox is still there. After the server's data is loaded, the operations that have not been sent yet
 * are applied on top again ("rebase"), so nothing the person did disappears from the screen while it waits.
 *
 * Everything here is pure, so the same rules are tested once and used by every screen.
 */

export interface OfflineData {
  projects: Project[]
  tasks: Task[]
  entries: TimeEntry[]
}

export type TaskPatch = Partial<Pick<Task, 'title' | 'due' | 'priority' | 'projectId' | 'status' | 'recurrence'>>
export type ProjectPatch = Partial<Pick<Project, 'name' | 'description' | 'color' | 'customColor'>>

export type Op =
  | { kind: 'task.create'; task: Task }
  | { kind: 'task.update'; id: string; patch: TaskPatch; at: number }
  | { kind: 'task.delete'; id: string }
  | { kind: 'project.create'; project: Project }
  | { kind: 'project.update'; id: string; patch: ProjectPatch }
  | { kind: 'project.delete'; id: string }
  /** `parallel`: keep the timers that are already running (multitasking). Otherwise they stop when this one starts. */
  | { kind: 'timer.start'; entry: TimeEntry; parallel: boolean }
  | { kind: 'timer.stop'; id: string; endedAt: number }

export interface QueuedOp {
  /** Unique per operation, so the outbox can remove exactly the one that was sent. */
  opId: string
  /** When the person did it (ms). */
  queuedAt: number
  op: Op
  /** Failed sends so far, for backing off. */
  tries: number
}

/** A task with a new status, keeping completedAt in step the way the server does. */
export const withStatus = (t: Task, status: TaskStatus, at: number): Task => ({
  ...t,
  status,
  completedAt: status === 'done' ? (t.status === 'done' ? t.completedAt : at) : null,
})

/** What the operation does to the data on screen. */
export function applyOp(d: OfflineData, op: Op): OfflineData {
  switch (op.kind) {
    case 'task.create':
      return d.tasks.some((t) => t.id === op.task.id) ? d : { ...d, tasks: [op.task, ...d.tasks] }
    case 'task.update':
      return {
        ...d,
        tasks: d.tasks.map((t) => (t.id === op.id ? { ...(op.patch.status ? withStatus(t, op.patch.status, op.at) : t), ...op.patch } : t)),
      }
    case 'task.delete':
      return { ...d, tasks: d.tasks.filter((t) => t.id !== op.id) }
    case 'project.create':
      return d.projects.some((p) => p.id === op.project.id) ? d : { ...d, projects: [...d.projects, op.project] }
    case 'project.update':
      return { ...d, projects: d.projects.map((p) => (p.id === op.id ? { ...p, ...op.patch } : p)) }
    case 'project.delete':
      // The server keeps the project's tasks and time: they become "no project".
      return {
        projects: d.projects.filter((p) => p.id !== op.id),
        tasks: d.tasks.map((t) => (t.projectId === op.id ? { ...t, projectId: null } : t)),
        entries: d.entries.map((e) => (e.projectId === op.id ? { ...e, projectId: null } : e)),
      }
    case 'timer.start': {
      if (d.entries.some((e) => e.id === op.entry.id)) return d
      const start = op.entry.startedAt
      // Switching: timers that were already running stop when this one starts (never before they began).
      const entries = op.parallel
        ? d.entries
        : d.entries.map((e) => (e.endedAt === null && e.startedAt <= start ? { ...e, endedAt: Math.max(e.startedAt, start) } : e))
      return { ...d, entries: [...entries, { ...op.entry, endedAt: null }] }
    }
    case 'timer.stop':
      return { ...d, entries: d.entries.map((e) => (e.id === op.id && e.endedAt === null ? { ...e, endedAt: Math.max(e.startedAt, op.endedAt) } : e)) }
  }
}

/** The server's data with the operations that are still waiting applied on top. */
export const rebase = (server: OfflineData, pending: QueuedOp[]): OfflineData => pending.reduce((d, q) => applyOp(d, q.op), server)

export interface OpRequest {
  method: 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
}

const iso = (ms: number) => new Date(ms).toISOString()

/** The API call that carries an operation to the server. Every one is safe to send twice. */
export function opRequest(op: Op): OpRequest {
  switch (op.kind) {
    case 'task.create': {
      const t = op.task
      return { method: 'POST', path: '/tasks', body: { id: t.id, title: t.title, projectId: t.projectId, priority: t.priority, due: t.due, recurrence: t.recurrence, status: t.status } }
    }
    case 'task.update':
      return { method: 'PATCH', path: `/tasks/${op.id}`, body: op.patch }
    case 'task.delete':
      return { method: 'DELETE', path: `/tasks/${op.id}` }
    case 'project.create': {
      const p = op.project
      return { method: 'POST', path: '/projects', body: { id: p.id, name: p.name, description: p.description, color: p.color, customColor: p.customColor ?? null } }
    }
    case 'project.update':
      return { method: 'PATCH', path: `/projects/${op.id}`, body: op.patch }
    case 'project.delete':
      return { method: 'DELETE', path: `/projects/${op.id}` }
    case 'timer.start':
      return {
        method: 'POST',
        path: '/time-entries/start',
        body: { id: op.entry.id, taskId: op.entry.taskId, projectId: op.entry.projectId, startedAt: iso(op.entry.startedAt), parallel: op.parallel },
      }
    case 'timer.stop':
      return { method: 'POST', path: '/time-entries/stop', body: { id: op.id, endedAt: iso(op.endedAt) } }
  }
}

/**
 * What to do when sending failed. `status` is the HTTP status, or null when the server could not be reached.
 *  - retry: no connection, the server is down or busy. Keep it and try again later.
 *  - signin: the session ended. Keep it; it goes out after signing in again.
 *  - done: the server says the work is already done (sending twice), so it can leave the outbox.
 *  - drop: the server refused it for good (for example it was invalid). Keep trying would block everything after it.
 */
export function failureAction(op: Op, status: number | null): 'retry' | 'signin' | 'done' | 'drop' {
  if (status === null || status >= 500 || status === 408 || status === 429) return 'retry'
  if (status === 401) return 'signin'
  // Deleting something that is already gone, or updating something deleted elsewhere: nothing left to do.
  if (status === 404 && (op.kind.endsWith('.delete') || op.kind === 'task.update' || op.kind === 'project.update' || op.kind === 'timer.stop')) return 'done'
  if (status === 409 && (op.kind === 'task.create' || op.kind === 'project.create' || op.kind === 'timer.start')) return 'done'
  return 'drop'
}

/** Wait before the next try: 2 s, 4 s, 8 s ... up to 2 minutes. */
export const retryDelay = (tries: number) => Math.min(120_000, 2000 * 2 ** Math.max(0, tries - 1))

/** Words for an operation, for "could not save" messages. */
export function describeOp(op: Op, data: OfflineData): string {
  const task = (id: string) => data.tasks.find((t) => t.id === id)?.title
  const project = (id: string) => data.projects.find((p) => p.id === id)?.name
  switch (op.kind) {
    case 'task.create':
      return `adding "${op.task.title}"`
    case 'task.update':
      return `changing "${task(op.id) ?? 'a task'}"`
    case 'task.delete':
      return 'deleting a task'
    case 'project.create':
      return `adding the project "${op.project.name}"`
    case 'project.update':
      return `changing "${project(op.id) ?? 'a project'}"`
    case 'project.delete':
      return 'deleting a project'
    case 'timer.start':
      return 'starting the timer'
    case 'timer.stop':
      return 'stopping the timer'
  }
}
