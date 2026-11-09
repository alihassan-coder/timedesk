import { classifyWindow, IDLE_FOCUS_STATE, type FocusRules, type FocusSession, type FocusState } from '@timedesk/shared'
import type { ForegroundWindow } from './tracker.ts'

export interface FocusGuardOptions {
  /** What is in front right now, or null if nothing can be read. */
  getWindow: () => Promise<ForegroundWindow | null>
  /** Seconds since the person last touched the keyboard or mouse. */
  getIdleSeconds: () => number
  /** The person's lists and nudge delay, read on every tick so a change applies at once. */
  rules: () => FocusRules & { nudgeSeconds: number }
  /** Called when a distraction has lasted long enough, and again every `repeatSeconds` while it goes on. */
  nudge: (n: { match: string; label: string; seconds: number }) => void
  now?: () => number
  newId?: () => string
  /** How often tick() is called, in seconds. */
  intervalSeconds?: number
  /** After this much idle time the person counts as away, not distracted. */
  idleLimitSeconds?: number
  repeatSeconds?: number
  /** Sessions shorter than this (focused plus distracted) are not kept. */
  minSessionSeconds?: number
  maxBuffered?: number
}

interface Running {
  key: string
  label: string
  startedAt: number
  focused: number
  distracted: number
  away: number
  interruptions: number
  distractions: Map<string, number>
  match: string | null
  streak: number
  nudgedAt: number | null
  onBreak: boolean
}

/**
 * Counts focused and distracted time while a timer runs, and nudges after a listed app or site has been in front for a
 * while. Window titles are only used to match the person's own list here and are never kept: a finished session holds
 * totals and the listed names that matched. Like the tracker it has no timers: the caller calls tick() every few seconds.
 */
export function createFocusGuard(opts: FocusGuardOptions) {
  const now = opts.now ?? Date.now
  const newId = opts.newId ?? (() => crypto.randomUUID())
  const step = opts.intervalSeconds ?? 5
  const idleLimit = opts.idleLimitSeconds ?? 120
  const repeat = opts.repeatSeconds ?? 120
  const minSession = opts.minSessionSeconds ?? 60
  const maxBuffered = opts.maxBuffered ?? 200

  let cur: Running | null = null
  let paused = false
  const done: FocusSession[] = []

  const resetStreak = (r: Running) => {
    r.match = null
    r.streak = 0
    r.nudgedAt = null
  }

  function finish() {
    if (!cur) return
    const r = cur
    cur = null
    if (r.focused + r.distracted < minSession) return
    done.push({
      id: newId(),
      startedAt: new Date(r.startedAt).toISOString(),
      endedAt: new Date(now()).toISOString(),
      label: r.label.slice(0, 200),
      focusedSeconds: r.focused,
      distractedSeconds: r.distracted,
      awaySeconds: r.away,
      interruptions: r.interruptions,
      distractions: [...r.distractions.entries()]
        .map(([name, seconds]) => ({ name, seconds }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 10),
    })
    if (done.length > maxBuffered) done.splice(0, done.length - maxBuffered)
  }

  return {
    /**
     * A timer is running. `key` names it (its start time), so switching to another task finishes one session and
     * starts the next. Calling it again for the same timer only updates the label.
     */
    start(key: string, label: string) {
      if (cur && cur.key === key) {
        cur.label = label
        return
      }
      finish()
      cur = { key, label, startedAt: now(), focused: 0, distracted: 0, away: 0, interruptions: 0, distractions: new Map(), match: null, streak: 0, nudgedAt: null, onBreak: false }
    },

    /** The timer stopped, or Focus guard was turned off: keep the session if it was long enough. */
    stop: finish,

    /** `onBreak`: a Pomodoro break, when nothing is counted and nobody is nudged. */
    async tick({ onBreak = false }: { onBreak?: boolean } = {}) {
      const r = cur
      if (!r) return
      // Asleep or locked: nothing is counted, not even as away (the idle question after resume handles that time).
      if (paused) return resetStreak(r)
      r.onBreak = onBreak
      if (onBreak) return resetStreak(r)
      if (opts.getIdleSeconds() >= idleLimit) {
        r.away += step
        return resetStreak(r)
      }
      const win = await opts.getWindow().catch(() => null)
      if (cur !== r || paused) return // stopped (or the computer went to sleep) while the window was being read
      // Nothing readable (some Linux desktops): nothing to judge, so nothing is counted.
      if (!win || !win.app) return resetStreak(r)

      const verdict = classifyWindow(win, opts.rules())
      if (verdict.kind === 'ok') {
        r.focused += step
        return resetStreak(r)
      }
      if (r.match !== verdict.match) {
        resetStreak(r)
        r.match = verdict.match
      }
      r.streak += step
      r.distracted += step
      r.distractions.set(verdict.match, (r.distractions.get(verdict.match) ?? 0) + step)

      const { nudgeSeconds } = opts.rules()
      if (r.nudgedAt === null && r.streak >= nudgeSeconds) {
        r.interruptions += 1
        r.nudgedAt = r.streak
        opts.nudge({ match: verdict.match, label: r.label, seconds: r.streak })
      } else if (r.nudgedAt !== null && r.streak - r.nudgedAt >= repeat) {
        r.nudgedAt = r.streak
        opts.nudge({ match: verdict.match, label: r.label, seconds: r.streak })
      }
    },

    /** The computer is going to sleep or locking: the distraction streak ends and ticks count nothing until resume(). */
    pause() {
      paused = true
      if (cur) resetStreak(cur)
    },

    resume() {
      paused = false
    },

    state(): FocusState {
      if (!cur) return { ...IDLE_FOCUS_STATE, pending: done.length }
      return {
        active: true,
        onBreak: cur.onBreak,
        distracted: cur.match !== null,
        match: cur.match,
        streakSeconds: cur.streak,
        focusedSeconds: cur.focused,
        distractedSeconds: cur.distracted,
        interruptions: cur.interruptions,
        pending: done.length,
      }
    },

    active: () => cur !== null,

    /** Finished sessions, and forget them. Call before uploading. */
    drain(): FocusSession[] {
      return done.splice(0, done.length)
    },

    /** Put sessions back after a failed upload. */
    requeue(sessions: FocusSession[]) {
      done.unshift(...sessions)
      if (done.length > maxBuffered) done.splice(0, done.length - maxBuffered)
    },

    /** Drop everything, for example when the person signs out. */
    reset() {
      cur = null
      done.length = 0
    },
  }
}

export type FocusGuard = ReturnType<typeof createFocusGuard>
