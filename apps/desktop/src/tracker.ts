import type { ActivitySample } from '@timedesk/shared'

export type { ActivitySample }

export interface ForegroundWindow {
  app: string
  title: string
}

export interface TrackerOptions {
  /** What is in front right now, or null if nothing can be read. */
  getWindow: () => Promise<ForegroundWindow | null>
  /** Seconds since the person last touched the keyboard or mouse. */
  getIdleSeconds: () => number
  now?: () => number
  newId?: () => string
  /** How often tick() is called, in seconds. */
  intervalSeconds?: number
  /** After this much idle time nothing is recorded. */
  idleLimitSeconds?: number
  /** Record only the app name, never the window title. */
  appsOnly?: () => boolean
  /** Never grow without bound if the app cannot upload (for example while offline). */
  maxBuffered?: number
}

/**
 * Turns "what is in front" snapshots into samples. It keeps a slice open while the same window stays
 * in front, closes it when the window changes or the person goes idle, and hands finished slices out
 * through drain(). It has no timers of its own: the caller calls tick() every few seconds.
 */
export function createTracker(opts: TrackerOptions) {
  const now = opts.now ?? Date.now
  const newId = opts.newId ?? (() => crypto.randomUUID())
  const step = opts.intervalSeconds ?? 5
  const idleLimit = opts.idleLimitSeconds ?? 120
  const maxBuffered = opts.maxBuffered ?? 2000

  let current: { app: string; title: string; startedAt: number; seconds: number } | null = null
  let paused = false
  const done: ActivitySample[] = []

  function close() {
    if (current && current.seconds > 0) {
      done.push({ id: newId(), app: current.app, title: current.title, startedAt: new Date(current.startedAt).toISOString(), seconds: current.seconds })
      if (done.length > maxBuffered) done.splice(0, done.length - maxBuffered)
    }
    current = null
  }

  return {
    async tick() {
      if (paused || opts.getIdleSeconds() >= idleLimit) return close()
      const win = await opts.getWindow().catch(() => null)
      if (paused || !win || !win.app) return close()

      // Compared the way it is stored (cut to length), or a very long name would open a new slice on every tick.
      const app = win.app.slice(0, 120)
      const title = opts.appsOnly?.() ? '' : win.title.slice(0, 300)
      if (current && current.app === app && current.title === title) {
        current.seconds += step
        return
      }
      close()
      current = { app, title, startedAt: now() - step * 1000, seconds: step }
    },

    /** The computer is going to sleep or locking: finish the open slice so none spans the time away, and record nothing until resume(). */
    pause() {
      paused = true
      close()
    },

    resume() {
      paused = false
    },

    /** Finished slices, plus the one in progress, and forget them. Call before uploading. */
    drain(): ActivitySample[] {
      close()
      return done.splice(0, done.length)
    },

    /** Put samples back after a failed upload. */
    requeue(samples: ActivitySample[]) {
      done.unshift(...samples)
      if (done.length > maxBuffered) done.splice(0, done.length - maxBuffered)
    },

    /** Drop everything, for example when tracking is switched off or the person signs out. */
    reset() {
      current = null
      done.length = 0
    },

    pending: () => done.length + (current ? 1 : 0),
  }
}

export type Tracker = ReturnType<typeof createTracker>
