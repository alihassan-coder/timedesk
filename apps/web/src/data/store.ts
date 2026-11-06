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

interface ApiTask extends Omit<Task, 'createdAt' | 'completedAt'> {
  createdAt: string
  completedAt: string | null
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
  completedAt: t.completedAt ? new Date(t.completedAt).getTime() : null,
})

/** A task with a new status, keeping completedAt in step the way the server does. */
const withStatus = (t: Task, status: TaskStatus): Task => ({
  ...t,
  status,
  completedAt: status === 'done' ? (t.status === 'done' ? t.completedAt : Date.now()) : null,
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

/**
 * Called after every change this window makes to tasks or the timer. The desktop app uses it to tell its other
 * windows (floating timer, quick add) to reload at once.
 */
let mutationHook: (() => void) | null = null
export function setMutationHook(fn: (() => void) | null) {
  mutationHook = fn
}

/** What the most recent timer was on, so "resume" can start it again. */
export function lastTimerTarget(entries: TimeEntry[]): { taskId: string | null; projectId: string | null } | null {
  const last = [...entries].sort((a, b) => b.startedAt - a.startedAt)[0]
  return last ? { taskId: last.taskId, projectId: last.projectId } : null
}

/** Runs an API call after an optimistic update. On failure, reload the truth from the server. */
async function sync(call: () => Promise<unknown>) {
  try {
    await call()
    mutationHook?.()
  } catch (e) {
    await loadStore()
    set({ error: message(e) })
  }
}

export const actions = {
  async addTask(input: NewTask) {
    const title = input.title.trim()
    if (!title) return
    const task: Task = { id: crypto.randomUUID(), ...input, title, status: 'todo', createdAt: Date.now(), completedAt: null }
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
    set({ tasks: state.tasks.map((t) => (t.id === taskId ? withStatus(t, status) : t)) })
    await sync(() => api(`/tasks/${taskId}`, { method: 'PATCH', body: { status } }))
    // The server schedules the next occurrence of a recurring task, so pick it up.
    if (status === 'done' && task.status !== 'done' && task.recurrence && task.due) await loadStore()
  },

  /** Edit any task fields, for example drag a task to another day. */
  async updateTask(taskId: string, patch: Partial<Pick<Task, 'title' | 'due' | 'priority' | 'projectId' | 'status'>>) {
    if (!state.tasks.some((t) => t.id === taskId)) return
    set({ tasks: state.tasks.map((t) => (t.id === taskId ? { ...(patch.status ? withStatus(t, patch.status) : t), ...patch } : t)) })
    await sync(() => api(`/tasks/${taskId}`, { method: 'PATCH', body: patch }))
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

  async updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'color'>>) {
    const clean = { ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) }
    if (clean.name === '') return
    set({ projects: state.projects.map((p) => (p.id === id ? { ...p, ...clean } : p)) })
    await sync(() => api(`/projects/${id}`, { method: 'PATCH', body: clean }))
  },

  /** The server keeps the project's tasks and tracked time: they become "no project". */
  async deleteProject(id: string) {
    set({
      projects: state.projects.filter((p) => p.id !== id),
      tasks: state.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null } : t)),
      entries: state.entries.map((e) => (e.projectId === id ? { ...e, projectId: null } : e)),
    })
    await sync(() => api(`/projects/${id}`, { method: 'DELETE' }))
  },

  /** Starts the timer on whatever the last one was on. Falls back to a plain stopwatch. */
  async resumeLast() {
    await actions.startTimer(lastTimerTarget(state.entries) ?? {})
  },

  /** Only one timer runs at a time. The server stops any running one, and we mirror that here. */
  async startTimer(target: { taskId?: string | null; projectId?: string | null }) {
    const taskId = target.taskId ?? null
    const projectId = target.projectId ?? state.tasks.find((t) => t.id === taskId)?.projectId ?? null
    try {
      const { entry } = await api<{ entry: ApiEntry }>('/time-entries/start', { method: 'POST', body: { taskId, projectId } })
      const now = Date.now()
      set({ entries: [...state.entries.map((e) => (e.endedAt === null ? { ...e, endedAt: now } : e)), toEntry(entry)], error: '' })
      mutationHook?.()
    } catch (e) {
      set({ error: message(e) })
    }
  },

  /** Stops the running timer now, or at `at` (ms), for example the moment the person went idle. */
  async stopTimer(at?: number) {
    try {
      const { entry } = await api<{ entry: ApiEntry }>('/time-entries/stop', {
        method: 'POST',
        body: at === undefined ? undefined : { endedAt: new Date(at).toISOString() },
      })
      const done = toEntry(entry)
      set({ entries: state.entries.map((e) => (e.id === done.id ? done : e)), error: '' })
      mutationHook?.()
    } catch (e) {
      await loadStore()
      set({ error: message(e) })
    }
  },
}
