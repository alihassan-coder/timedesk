import { useSyncExternalStore } from 'react'
import {
  type Priority,
  type Project,
  type Recurrence,
  type Task,
  type TaskStatus,
  type TimeEntry,
} from '@timedesk/shared'
import { api, ApiError } from '@/lib/api'
import { readCache, writeCache } from '@/lib/cache'

/**
 * Data layer. Everything the screens show comes from the timedesk API (your Neon database) and is
 * scoped to the signed-in person. Screens read and write only through this file, so the offline
 * sync engine can replace it later without touching any screen.
 *
 * Updates are optimistic: the screen changes at once, then the API call runs. If it fails, the
 * data is reloaded from the server and `error` explains what happened.
 */
interface State {
  projects: Project[]
  tasks: Task[]
  entries: TimeEntry[]
  /** False until the first load finishes. */
  ready: boolean
  error: string
}

const EMPTY: State = { projects: [], tasks: [], entries: [], ready: false, error: '' }
let state: State = EMPTY
let userId: string | null = null
const listeners = new Set<() => void>()

function set(next: Partial<State>) {
  state = { ...state, ...next }
  // Keep a copy on this device so the next visit opens instantly.
  if (userId && state.ready) writeCache('data', userId, { projects: state.projects, tasks: state.tasks, entries: state.entries })
  listeners.forEach((l) => l())
}

export function useStore(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export const getState = () => state

interface ApiTask extends Omit<Task, 'createdAt'> {
  createdAt: string
}
interface ApiEntry {
  id: string
  taskId: string | null
  projectId: string | null
  startedAt: string
  endedAt: string | null
}

const toTask = (t: ApiTask): Task => ({
  id: t.id,
  title: t.title,
  projectId: t.projectId,
  status: t.status,
  priority: t.priority,
  due: t.due,
  recurrence: t.recurrence,
  createdAt: new Date(t.createdAt).getTime(),
})
const toEntry = (e: ApiEntry): TimeEntry => ({
  id: e.id,
  taskId: e.taskId,
  projectId: e.projectId,
  startedAt: new Date(e.startedAt).getTime(),
  endedAt: e.endedAt ? new Date(e.endedAt).getTime() : null,
})
const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Could not reach the server.')

/**
 * Starts the data layer for a signed-in person: shows what this device cached last time right away,
 * then refreshes from the server (the database stays the source of truth).
 */
export function bindStore(id: string) {
  if (userId === id) return
  userId = id
  const cached = readCache<Pick<State, 'projects' | 'tasks' | 'entries'>>('data', id)
  if (cached) set({ ...cached, ready: true, error: '' })
  void loadStore()
}

/** Loads everything for the signed-in person. */
export async function loadStore() {
  try {
    const [p, t, e] = await Promise.all([
      api<{ projects: Project[] }>('/projects'),
      api<{ tasks: ApiTask[] }>('/tasks'),
      api<{ entries: ApiEntry[] }>('/time-entries'),
    ])
    set({ projects: p.projects, tasks: t.tasks.map(toTask), entries: e.entries.map(toEntry), ready: true, error: '' })
  } catch (e) {
    set({ ready: true, error: message(e) })
  }
}

/** Forget everything, for example on sign out, so the next person never sees it. */
export function resetStore() {
  userId = null
  state = EMPTY
  listeners.forEach((l) => l())
}

export interface NewTask {
  title: string
  projectId: string | null
  priority: Priority
  due: string | null
  recurrence: Recurrence | null
}

/** Runs an API call after an optimistic update. On failure, reload the truth from the server. */
async function sync(call: () => Promise<unknown>) {
  try {
    await call()
  } catch (e) {
    await loadStore()
    set({ error: message(e) })
  }
}

export const actions = {
  async addTask(input: NewTask) {
    const title = input.title.trim()
    if (!title) return
    const task: Task = { id: crypto.randomUUID(), ...input, title, status: 'todo', createdAt: Date.now() }
    set({ tasks: [task, ...state.tasks] })
    await sync(() =>
      api('/tasks', {
        method: 'POST',
        body: { id: task.id, title, projectId: task.projectId, priority: task.priority, due: task.due, recurrence: task.recurrence },
      }),
    )
  },

  /** Completing a recurring task makes the server create the next one. */
  async setStatus(taskId: string, status: TaskStatus) {
    const task = state.tasks.find((t) => t.id === taskId)
    if (!task) return
    set({ tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)) })
    await sync(() => api(`/tasks/${taskId}`, { method: 'PATCH', body: { status } }))
    // The server schedules the next occurrence of a recurring task, so pick it up.
    if (status === 'done' && task.status !== 'done' && task.recurrence && task.due) await loadStore()
  },

  async deleteTask(taskId: string) {
    set({ tasks: state.tasks.filter((t) => t.id !== taskId) })
    await sync(() => api(`/tasks/${taskId}`, { method: 'DELETE' }))
  },

  async addProject(name: string, description: string) {
    const n = name.trim()
    if (!n) return
    const color = ((state.projects.length % 5) + 1) as Project['color']
    const project: Project = { id: crypto.randomUUID(), name: n, description: description.trim(), color }
    set({ projects: [...state.projects, project] })
    await sync(() => api('/projects', { method: 'POST', body: project }))
  },

  /** Only one timer runs at a time. The server stops any running one, and we mirror that here. */
  async startTimer(target: { taskId?: string | null; projectId?: string | null }) {
    const taskId = target.taskId ?? null
    const projectId = target.projectId ?? state.tasks.find((t) => t.id === taskId)?.projectId ?? null
    try {
      const { entry } = await api<{ entry: ApiEntry }>('/time-entries/start', { method: 'POST', body: { taskId, projectId } })
      const now = Date.now()
      set({ entries: [...state.entries.map((e) => (e.endedAt === null ? { ...e, endedAt: now } : e)), toEntry(entry)], error: '' })
    } catch (e) {
      set({ error: message(e) })
    }
  },

  async stopTimer() {
    try {
      const { entry } = await api<{ entry: ApiEntry }>('/time-entries/stop', { method: 'POST' })
      const done = toEntry(entry)
      set({ entries: state.entries.map((e) => (e.id === done.id ? done : e)), error: '' })
    } catch (e) {
      await loadStore()
      set({ error: message(e) })
    }
  },
}
