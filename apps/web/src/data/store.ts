import { useSyncExternalStore } from 'react'
import type { Task, TimeEntry } from '@timedesk/shared'

/**
 * TEMPORARY local store (localStorage). Every screen goes through this file only,
 * so later we swap it for PowerSync (local SQLite + sync) without touching the UI.
 */
interface State {
  tasks: Task[]
  entries: TimeEntry[]
}

const KEY = 'timedesk:v1'

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    // corrupt or blocked storage: start empty
  }
  return { tasks: [], entries: [] }
}

let state: State = load()
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // storage full or blocked: keep working in memory
  }
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

const newId = () => crypto.randomUUID()

export const actions = {
  addTask(title: string) {
    const t = title.trim()
    if (!t) return
    set({ ...state, tasks: [{ id: newId(), title: t, done: false, createdAt: Date.now() }, ...state.tasks] })
  },
  toggleTask(taskId: string) {
    set({ ...state, tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) })
  },
  deleteTask(taskId: string) {
    set({ ...state, tasks: state.tasks.filter((t) => t.id !== taskId) })
  },
  /** Starts a timer. Only one can run at a time, so any running one is stopped first. */
  startTimer(taskId: string | null) {
    const now = Date.now()
    const entries = state.entries.map((e) => (e.endedAt === null ? { ...e, endedAt: now } : e))
    set({ ...state, entries: [...entries, { id: newId(), taskId, startedAt: now, endedAt: null }] })
  },
  stopTimer() {
    const now = Date.now()
    set({ ...state, entries: state.entries.map((e) => (e.endedAt === null ? { ...e, endedAt: now } : e)) })
  },
}
