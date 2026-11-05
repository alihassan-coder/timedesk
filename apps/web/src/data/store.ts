import { useSyncExternalStore } from 'react'
import { nextDue, type Priority, type Project, type Recurrence, type Task, type TaskStatus, type TimeEntry } from '@timedesk/shared'
import { buildEntries, buildMessages, buildTasks, projects, type ChatMessage } from './seed'

/**
 * IN-MEMORY store seeded with dummy data (resets on refresh). Every screen reads and writes
 * through this file only, so phase 2 swaps it for PowerSync + the API without touching the UI.
 */
interface State {
  projects: Project[]
  tasks: Task[]
  entries: TimeEntry[]
  messages: ChatMessage[]
}

const now0 = Date.now()
let state: State = {
  projects,
  tasks: buildTasks(now0),
  entries: buildEntries(now0),
  messages: buildMessages(now0),
}
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
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

export interface NewTask {
  title: string
  projectId: string | null
  priority: Priority
  due: string | null
  recurrence: Recurrence | null
}

export const actions = {
  addTask(input: NewTask) {
    const title = input.title.trim()
    if (!title) return
    set({ ...state, tasks: [{ id: newId(), ...input, title, status: 'todo', createdAt: Date.now() }, ...state.tasks] })
  },

  /** Completing a recurring task schedules the next occurrence. */
  setStatus(taskId: string, status: TaskStatus) {
    const task = state.tasks.find((t) => t.id === taskId)
    if (!task) return
    let tasks = state.tasks.map((t) => (t.id === taskId ? { ...t, status } : t))
    if (status === 'done' && task.status !== 'done' && task.recurrence && task.due) {
      tasks = [{ ...task, id: newId(), status: 'todo', due: nextDue(task.due, task.recurrence), createdAt: Date.now() }, ...tasks]
    }
    set({ ...state, tasks })
  },

  addProject(name: string, description: string) {
    const n = name.trim()
    if (!n) return
    const color = ((state.projects.length % 5) + 1) as Project['color']
    set({ ...state, projects: [...state.projects, { id: newId(), name: n, description: description.trim(), color }] })
  },

  deleteTask(taskId: string) {
    set({ ...state, tasks: state.tasks.filter((t) => t.id !== taskId) })
  },

  /** Only one timer runs at a time, so any running one is stopped first. */
  startTimer(target: { taskId?: string | null; projectId?: string | null }) {
    const now = Date.now()
    const taskId = target.taskId ?? null
    const projectId = target.projectId ?? state.tasks.find((t) => t.id === taskId)?.projectId ?? null
    const entries = state.entries.map((e) => (e.endedAt === null ? { ...e, endedAt: now } : e))
    set({ ...state, entries: [...entries, { id: newId(), taskId, projectId, startedAt: now, endedAt: null }] })
  },

  stopTimer() {
    const now = Date.now()
    set({ ...state, entries: state.entries.map((e) => (e.endedAt === null ? { ...e, endedAt: now } : e)) })
  },

  sendMessage(channelId: string, text: string) {
    const t = text.trim()
    if (!t) return
    set({ ...state, messages: [...state.messages, { id: newId(), channelId, userId: 'u1', text: t, at: Date.now() }] })
  },
}
