import { useSyncExternalStore } from 'react'
import {
  applyOp,
  describeOp,
  failureAction,
  opRequest,
  rebase,
  retryDelay,
  runningEntries,
  splitParallel,
  withStatus,
  type Op,
  type Priority,
  type Project,
  type ProjectPatch,
  type QueuedOp,
  type Recurrence,
  type Task,
  type TaskPatch,
  type TaskStatus,
  type TimeEntry,
} from '@timedesk/shared'
import { api, ApiError } from '@/lib/api'
import { readCache, writeCache } from '@/lib/cache'

/**
 * Data layer, offline first. Screens read and write only through this file.
 *
 * Every change is applied on screen at once and kept in an outbox on this device (it survives a reload or a restart).
 * The outbox is sent to the API in order whenever there is a connection; a change that cannot be sent yet simply waits.
 * When the server's data is loaded, the changes still waiting are applied on top, so nothing the person did
 * disappears while it waits. The database stays the source of truth: if the server refuses a change for good, it is
 * dropped, the server's data is shown again, and `error` says what could not be saved.
 */
export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'signin'

interface State {
  projects: Project[]
  tasks: Task[]
  entries: TimeEntry[]
  /**
   * Entries ready for totals: where several timers ran at once their time is shared (see splitParallel), so totals
   * match the clock. Use `entries` for lists and the running timers, `tracked` for adding time up.
   */
  tracked: TimeEntry[]
  /** False until there is something to show (from this device or the server). */
  ready: boolean
  error: string
  /** Changes made on this device that the server does not have yet. */
  pending: number
  sync: SyncStatus
}

const EMPTY: State = { projects: [], tasks: [], entries: [], tracked: [], ready: false, error: '', pending: 0, sync: 'synced' }
let state: State = EMPTY
let userId: string | null = null
/** The server's data as last loaded (before the waiting changes are applied on top). */
let server: Pick<State, 'projects' | 'tasks' | 'entries'> | null = null
let outbox: QueuedOp[] = []
const listeners = new Set<() => void>()

function set(next: Partial<State>) {
  const prev = state
  state = { ...state, ...next }
  if (state.entries !== prev.entries) state.tracked = splitParallel(state.entries)
  // Keep a copy on this device so the next visit opens instantly, also when offline. Only when the data changed.
  const dataChanged = state.projects !== prev.projects || state.tasks !== prev.tasks || state.entries !== prev.entries
  if (userId && state.ready && dataChanged) writeCache('data', userId, server ?? { projects: state.projects, tasks: state.tasks, entries: state.entries })
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

/** Clears the error message (the person closed it). */
export const dismissError = () => set({ error: '' })

// ---- the outbox ---------------------------------------------------------------------------------------------
const outboxKey = (id: string) => `timedesk:outbox:${id}`

/**
 * The saved outbox is the one shared copy: the desktop app's floating timer and quick add are other pages on the same
 * device, so every change re-reads it before adding or removing (sending the same change twice is harmless). When
 * storage is blocked, the copy in memory is used.
 */
function readOutbox(id: string): QueuedOp[] | null {
  try {
    const raw = localStorage.getItem(outboxKey(id))
    const list = raw ? (JSON.parse(raw) as QueuedOp[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return null
  }
}
/**
 * Re-reads the shared outbox. Changes that another window sent meanwhile have left it: they are now on the server,
 * so they are applied to this window's copy of the server's data (otherwise they would vanish from this screen until
 * the next load). Returns true when that happened.
 */
function refreshOutbox(): boolean {
  if (!userId) return false
  const saved = readOutbox(userId)
  if (!saved) return false
  const gone = outbox.filter((o) => !saved.some((n) => n.opId === o.opId))
  outbox = saved
  if (server) for (const g of gone) server = applyOp(server, g.op)
  return gone.length > 0
}

/** Written at once (not debounced): a change must never be lost because the tab closed a moment later. */
function saveOutbox() {
  if (!userId) return
  try {
    if (outbox.length) localStorage.setItem(outboxKey(userId), JSON.stringify(outbox))
    else localStorage.removeItem(outboxKey(userId))
  } catch {
    // Storage full or blocked: the change still goes out while this page stays open.
  }
}

function cacheServer() {
  if (userId && server) writeCache('data', userId, server)
}

/** Shows the server's data with every waiting change on top. */
function show(extra: Partial<State> = {}) {
  refreshOutbox()
  const base = server ?? { projects: state.projects, tasks: state.tasks, entries: state.entries }
  const d = rebase(base, outbox)
  set({ ...d, ready: true, pending: outbox.length, ...extra })
}

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false

/** Records a change: on screen now, in the outbox until the server has it. */
function commit(op: Op) {
  if (!userId) return
  refreshOutbox()
  outbox.push({ opId: crypto.randomUUID(), queuedAt: Date.now(), op, tries: 0 })
  saveOutbox()
  // Apply to what is on screen directly (cheaper than a full rebase, and the same result).
  const d = applyOp({ projects: state.projects, tasks: state.tasks, entries: state.entries }, op)
  set({ ...d, pending: outbox.length, sync: online() ? 'syncing' : 'offline' })
  mutationHook?.()
  void flush()
}

/** Changes sent while a load was in flight: the load's answer may be older than them, so they are applied to it. */
let sentDuringLoad: Op[] | null = null

let flushing = false
let retryTimer: ReturnType<typeof setTimeout> | undefined

/** Sends waiting changes, oldest first. Stops at the first one that cannot go out yet, so the order is kept. */
async function flush() {
  if (flushing || !userId) return
  refreshOutbox()
  if (outbox.length === 0) {
    if (state.sync !== 'synced') set({ sync: 'synced' })
    return
  }
  if (!online()) {
    set({ sync: 'offline' })
    return
  }
  flushing = true
  clearTimeout(retryTimer)
  const owner = userId
  set({ sync: 'syncing' })
  let sentAny = false
  try {
    for (;;) {
      refreshOutbox()
      if (!outbox.length || userId !== owner) break
      const q = outbox[0]
      const req = opRequest(q.op)
      let status: number | null = 0
      try {
        await api(req.path, { method: req.method, body: req.body })
      } catch (e) {
        status = e instanceof ApiError ? e.status : null
      }
      if (userId !== owner) return // signed out meanwhile: the outbox belongs to the previous person and stays saved
      refreshOutbox() // another window may have sent or added changes meanwhile
      const action = status === 0 ? 'sent' : failureAction(q.op, status)
      if (action === 'sent' || action === 'done') {
        // The server has it now: keep this device's copy of the server's data in step, so a reload while offline
        // still shows it even though it is no longer waiting.
        outbox = outbox.filter((o) => o.opId !== q.opId)
        if (server) server = applyOp(server, q.op)
        sentDuringLoad?.push(q.op)
        sentAny = true
        saveOutbox()
        cacheServer()
        continue
      }
      if (action === 'drop') {
        const what = describeOp(q.op, state)
        outbox = outbox.filter((o) => o.opId !== q.opId)
        saveOutbox()
        await loadStore()
        set({ error: `Could not save ${what}: the server refused it.` })
        continue
      }
      // retry or signin: keep it (and everything after it) and try again later.
      const kept = outbox.find((o) => o.opId === q.opId)
      if (kept) kept.tries = q.tries + 1
      q.tries += 1
      saveOutbox()
      set({ sync: action === 'signin' ? 'signin' : online() && status !== null ? 'syncing' : 'offline', pending: outbox.length })
      retryTimer = setTimeout(() => void flush(), retryDelay(q.tries))
      return
    }
    set({ sync: 'synced', pending: outbox.length })
  } finally {
    flushing = false
    if (sentAny) mutationHook?.()
  }
}

// Come back online, or back to the tab: send what waited.
if (typeof window !== 'undefined') {
  // Another window of this app (the desktop app's floating timer, another tab) changed the outbox: show it here too.
  let reload: ReturnType<typeof setTimeout> | undefined
  window.addEventListener('storage', (e) => {
    if (!userId || e.key !== outboxKey(userId)) return
    const sentElsewhere = refreshOutbox()
    show({ sync: outbox.length ? state.sync : 'synced' })
    // Check with the server shortly after, so every window ends up showing exactly the same thing.
    if (sentElsewhere) {
      clearTimeout(reload)
      reload = setTimeout(() => void loadStore(), 1500)
    }
  })
  window.addEventListener('online', () => void flush())
  window.addEventListener('offline', () => userId && set({ sync: 'offline' }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush()
  })
}

// ---- loading ---------------------------------------------------------------------------------------------
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
const toProject = (p: Project): Project => ({ id: p.id, name: p.name, description: p.description, color: p.color, customColor: p.customColor ?? null })
const toEntry = (e: ApiEntry): TimeEntry => ({
  id: e.id,
  taskId: e.taskId,
  projectId: e.projectId,
  startedAt: new Date(e.startedAt).getTime(),
  endedAt: e.endedAt ? new Date(e.endedAt).getTime() : null,
})

/**
 * Starts the data layer for a signed-in person: shows what this device has (data and waiting changes) right away,
 * then refreshes from the server and sends what waited. Safe to call on every render (only the first call per person
 * does anything), so screens can call it before their first paint.
 */
export function bindStore(id: string) {
  if (userId === id) return
  userId = id
  server = readCache<Pick<State, 'projects' | 'tasks' | 'entries'>>('data', id)
  outbox = readOutbox(id) ?? []
  state = EMPTY // never show the previous person's data, even for a moment
  const sync: SyncStatus = !online() ? 'offline' : outbox.length ? 'syncing' : 'synced'
  if (server || outbox.length) show({ error: '', sync })
  else {
    state = { ...state, sync }
    listeners.forEach((l) => l())
  }
  void loadStore().then(() => flush())
}

let loading: Promise<void> | null = null

/** Loads everything for the signed-in person. Calls made while one is running share it. */
export function loadStore(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const owner = userId
      sentDuringLoad = []
      try {
        const [p, t, e] = await Promise.all([
          api<{ projects: Project[] }>('/projects'),
          api<{ tasks: ApiTask[] }>('/tasks'),
          api<{ entries: ApiEntry[] }>('/time-entries'),
        ])
        if (userId !== owner) return
        const loaded = { projects: p.projects.map(toProject), tasks: t.tasks.map(toTask), entries: e.entries.map(toEntry) }
        server = (sentDuringLoad ?? []).reduce(applyOp, loaded)
        cacheServer()
        show({ error: state.error.startsWith('Could not save') ? state.error : '' })
      } catch (err) {
        if (userId !== owner) return
        const offline = !(err instanceof ApiError)
        // Offline with data on this device: that is fine, keep working. Otherwise say what went wrong.
        if (offline && state.ready) set({ sync: 'offline' })
        else set({ ready: true, error: offline ? 'You are offline. Changes are saved on this device and sent when you are back online.' : (err as Error).message, sync: offline ? 'offline' : state.sync })
      } finally {
        loading = null
        sentDuringLoad = null
      }
    })()
  }
  return loading
}

/** Forget what is on screen, for example on sign out. The outbox stays saved for that person and goes out when they sign in again. */
export function resetStore() {
  userId = null
  server = null
  outbox = []
  clearTimeout(retryTimer)
  state = EMPTY
  listeners.forEach((l) => l())
}

/** Throws away the changes still waiting, for example when the account itself was deleted. */
export function discardPending() {
  outbox = []
  saveOutbox()
}

/** Changes made on this device that have not reached the server yet (for a warning before signing out). */
export const pendingChanges = () => outbox.length

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
  let last: TimeEntry | undefined
  for (const e of entries) if (!last || e.startedAt > last.startedAt) last = e
  return last ? { taskId: last.taskId, projectId: last.projectId } : null
}

export const actions = {
  /** Returns the new task's id, or null when the title was empty. Works offline. */
  addTask(input: NewTask): string | null {
    const title = input.title.trim().slice(0, 300)
    if (!title) return null
    const task: Task = { id: crypto.randomUUID(), ...input, title, status: 'todo', createdAt: Date.now(), completedAt: null }
    commit({ kind: 'task.create', task })
    return task.id
  },

  /** Completing a recurring task makes the server create the next one; it appears after the change is sent. */
  setStatus(taskId: string, status: TaskStatus) {
    const task = state.tasks.find((t) => t.id === taskId)
    if (!task || task.status === status) return
    commit({ kind: 'task.update', id: taskId, patch: { status }, at: Date.now() })
    if (status === 'done' && task.recurrence && task.due) void whenSynced().then(() => loadStore())
  },

  /** Edit any task fields, for example drag a task to another day. */
  updateTask(taskId: string, patch: TaskPatch) {
    if (!state.tasks.some((t) => t.id === taskId)) return
    const clean = { ...patch, ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 300) } : {}) }
    if (clean.title === '') return
    commit({ kind: 'task.update', id: taskId, patch: clean, at: Date.now() })
  },

  deleteTask(taskId: string) {
    commit({ kind: 'task.delete', id: taskId })
  },

  addProject(name: string, description: string, colors?: Pick<Project, 'color' | 'customColor'>) {
    const n = name.trim().slice(0, 120)
    if (!n) return null
    const color = colors?.color ?? (state.projects.length % 12) + 1
    const project: Project = { id: crypto.randomUUID(), name: n, description: description.trim().slice(0, 500), color, customColor: colors?.customColor ?? null }
    commit({ kind: 'project.create', project })
    return project.id
  },

  updateProject(id: string, patch: ProjectPatch) {
    const clean = { ...patch, ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 120) } : {}) }
    if (clean.name === '') return
    commit({ kind: 'project.update', id, patch: clean })
  },

  /** The server keeps the project's tasks and tracked time: they become "no project". */
  deleteProject(id: string) {
    commit({ kind: 'project.delete', id })
  },

  /** Starts the timer on whatever the last one was on. Falls back to a plain stopwatch. */
  resumeLast() {
    actions.startTimer(lastTimerTarget(state.entries) ?? {})
  },

  /**
   * Starts a timer, also offline: the time starts now, on this device. Normally this switches (the running timers
   * stop); with `parallel` they keep going, for multitasking.
   */
  startTimer(target: { taskId?: string | null; projectId?: string | null }, opts: { parallel?: boolean; at?: number } = {}) {
    const taskId = target.taskId ?? null
    const projectId = target.projectId ?? state.tasks.find((t) => t.id === taskId)?.projectId ?? null
    // The same task already running alongside others: nothing to start.
    if (opts.parallel && runningEntries(state.entries).some((e) => e.taskId === taskId && e.projectId === projectId)) return
    const entry: TimeEntry = { id: crypto.randomUUID(), taskId, projectId, startedAt: opts.at ?? Date.now(), endedAt: null }
    commit({ kind: 'timer.start', entry, parallel: !!opts.parallel })
  },

  /** Stops one timer (by id), or every running timer, now or at `at` (ms), for example when the person went idle. */
  stopTimer(at?: number, id?: string) {
    const end = at ?? Date.now()
    const targets = runningEntries(state.entries).filter((e) => !id || e.id === id)
    for (const e of targets) commit({ kind: 'timer.stop', id: e.id, endedAt: end })
  },
}

/** Resolves once the outbox is empty (or after 30 s), for follow-ups that need the server's answer. */
function whenSynced(): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now()
    const check = () => (outbox.length === 0 || Date.now() - started > 30_000 ? resolve() : setTimeout(check, 500))
    check()
  })
}

/** For tests and the sync badge: send waiting changes now. */
export const syncNow = () => flush()

/** Not used by screens; kept for tests that inspect what is waiting. */
export const _outbox = () => outbox.map((q) => q.op)
export type { Op }
// Kept for callers that still import it from here.
export { withStatus }
