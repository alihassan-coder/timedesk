import { useSyncExternalStore } from 'react'
import { getDesktop } from './desktop'

/**
 * Which reminders you want. Saved on this device at once and synced to your account, like the other preferences.
 */
export interface NotifyPrefs {
  /** A reminder for each task due today, and one summary of overdue tasks per day. */
  dueReminders: boolean
  /** When a timer has been running for more than four hours. */
  longTimer: boolean
}

const KEY = 'timedesk:notify-prefs'
const DEFAULTS: NotifyPrefs = { dueReminders: true, longTimer: true }

function load(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NotifyPrefs>) }
  } catch {
    // blocked or corrupt storage: use defaults
  }
  return DEFAULTS
}

let prefs = load()
const listeners = new Set<() => void>()

export function setNotifyPrefs(next: NotifyPrefs) {
  prefs = next
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

export const getNotifyPrefs = () => prefs
export const patchNotifyPrefs = (patch: Partial<NotifyPrefs>) => setNotifyPrefs({ ...prefs, ...patch })
export const replaceNotifyPrefs = (next: Partial<NotifyPrefs>) => setNotifyPrefs({ ...DEFAULTS, ...next })

export function subscribeNotifyPrefs(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useNotifyPrefs(): NotifyPrefs {
  return useSyncExternalStore(subscribeNotifyPrefs, () => prefs)
}

/** Shows a system notification: native in the desktop app, the browser's own when permission was given. */
export async function notify(title: string, body: string): Promise<boolean> {
  const desktop = getDesktop()
  if (desktop) {
    await desktop.notify(title, body)
    return true
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body })
    return true
  }
  return false
}
