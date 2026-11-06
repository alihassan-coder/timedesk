import { useSyncExternalStore } from 'react'

/**
 * How the timer behaves. Saved on this device at once and synced to your account, like the other preferences.
 * (Settings that belong to one computer, such as the floating timer's style, live in the desktop app instead.)
 */
export interface TimerPrefs {
  /** Minutes of tracked time you aim for each day. 0 turns the goal off. */
  dailyGoalMinutes: number
  /** Show the running time in the browser tab or window title. */
  titleTime: boolean
  pomodoroFocus: number
  pomodoroBreak: number
  /** A notification when a focus or break period ends. */
  pomodoroNotify: boolean
}

const KEY = 'timedesk:timer-prefs'
export const DEFAULT_TIMER_PREFS: TimerPrefs = { dailyGoalMinutes: 360, titleTime: true, pomodoroFocus: 25, pomodoroBreak: 5, pomodoroNotify: true }

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : fallback
  return Math.min(max, Math.max(min, v))
}

/** Keeps stored or synced values inside sensible limits, whatever they contain. */
export function sanitizeTimerPrefs(raw: Partial<TimerPrefs> | null | undefined): TimerPrefs {
  const p = { ...DEFAULT_TIMER_PREFS, ...(raw ?? {}) }
  return {
    dailyGoalMinutes: clamp(p.dailyGoalMinutes, 0, 1440, DEFAULT_TIMER_PREFS.dailyGoalMinutes),
    titleTime: typeof p.titleTime === 'boolean' ? p.titleTime : DEFAULT_TIMER_PREFS.titleTime,
    pomodoroFocus: clamp(p.pomodoroFocus, 1, 180, DEFAULT_TIMER_PREFS.pomodoroFocus),
    pomodoroBreak: clamp(p.pomodoroBreak, 1, 60, DEFAULT_TIMER_PREFS.pomodoroBreak),
    pomodoroNotify: typeof p.pomodoroNotify === 'boolean' ? p.pomodoroNotify : DEFAULT_TIMER_PREFS.pomodoroNotify,
  }
}

function load(): TimerPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return sanitizeTimerPrefs(JSON.parse(raw) as Partial<TimerPrefs>)
  } catch {
    // blocked or corrupt storage: use defaults
  }
  return DEFAULT_TIMER_PREFS
}

let prefs = load()
const listeners = new Set<() => void>()

function commit(next: TimerPrefs) {
  prefs = next
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

export const getTimerPrefs = () => prefs
export const patchTimerPrefs = (patch: Partial<TimerPrefs>) => commit(sanitizeTimerPrefs({ ...prefs, ...patch }))
export const replaceTimerPrefs = (next: Partial<TimerPrefs>) => commit(sanitizeTimerPrefs(next))

export function subscribeTimerPrefs(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

// Another window of the app (for example the floating timer) changed a preference: pick it up.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) commit(load())
  })
}

export function useTimerPrefs(): TimerPrefs {
  return useSyncExternalStore(subscribeTimerPrefs, () => prefs)
}

/** 360 -> "6h", 90 -> "1h 30m", 0 -> "Off". */
export function formatGoal(minutes: number): string {
  if (minutes <= 0) return 'Off'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}
