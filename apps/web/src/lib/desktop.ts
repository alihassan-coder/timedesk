import { useSyncExternalStore } from 'react'
import type { TimedeskBridge, UpdateStatus } from '@timedesk/shared'

declare global {
  interface Window {
    /** Present only inside the timedesk desktop app. */
    timedesk?: TimedeskBridge
  }
}

/** The desktop bridge, or null in a normal browser. */
export const getDesktop = (): TimedeskBridge | null => (typeof window !== 'undefined' ? (window.timedesk ?? null) : null)
export const isDesktop = () => getDesktop() !== null

// ---- update status, pushed by the desktop app ----
let update: UpdateStatus = { state: 'idle' }
const listeners = new Set<() => void>()
let attached = false

function attach() {
  if (attached) return
  attached = true
  const d = getDesktop()
  if (!d) return
  const apply = (s: UpdateStatus) => {
    update = s
    listeners.forEach((l) => l())
  }
  d.onUpdate(apply)
  // The update may have been announced before this page finished loading, so ask for the current state too.
  void d.getUpdateStatus().then(apply)
}

export function useUpdateStatus(): UpdateStatus {
  attach()
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => update,
  )
}
