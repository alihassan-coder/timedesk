import { DEFAULT_DESKTOP_SETTINGS, sanitizeFocusList, type DesktopSettings, type TimerState, type UpdateStatus, type WidgetMode } from '@timedesk/shared'

/**
 * Pure rules for the floating timer, the window title, idle time, the tray text, update status and the settings. No Electron
 * in here, so they are tested directly.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const WIDGET_SIZES: Record<WidgetMode, { width: number; height: number }> = {
  compact: { width: 330, height: 56 },
  expanded: { width: 300, height: 252 },
  dock: { width: 0, height: 46 }, // the width is the whole screen
  pomodoro: { width: 280, height: 292 },
}
export const WIDGET_MARGIN = 16

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max))

/** The bottom-right corner of a window. Remembering this (not the top-left) lets every style grow and shrink around the same corner. */
export interface Anchor {
  right: number
  bottom: number
}
export const anchorOf = (r: Rect): Anchor => ({ right: r.x + r.width, bottom: r.y + r.height })

/**
 * Where the floating window goes. The bottom bar spans the bottom of the screen. The other styles hang from the corner
 * the person last dragged them to (kept inside the screen), or start in the bottom-right corner of the screen.
 */
export function widgetBounds(mode: WidgetMode, workArea: Rect, anchor?: Anchor | null): Rect {
  if (mode === 'dock') {
    const h = WIDGET_SIZES.dock.height
    return { x: workArea.x, y: workArea.y + workArea.height - h, width: workArea.width, height: h }
  }
  const { width, height } = WIDGET_SIZES[mode]
  const right = anchor ? anchor.right : workArea.x + workArea.width - WIDGET_MARGIN
  const bottom = anchor ? anchor.bottom : workArea.y + workArea.height - WIDGET_MARGIN
  return {
    x: clamp(right - width, workArea.x, workArea.x + workArea.width - width),
    y: clamp(bottom - height, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  }
}

/** Is a saved corner still on a screen that exists? (A monitor may have been unplugged.) */
export function anchorOnScreen(anchor: Anchor, areas: Rect[]): boolean {
  return areas.some((r) => anchor.right > r.x + 20 && anchor.right <= r.x + r.width + 20 && anchor.bottom > r.y + 20 && anchor.bottom <= r.y + r.height + 20)
}

export function shouldShowWidget(s: {
  visibility: DesktopSettings['widget']
  signedIn: boolean
  running: boolean
  /** The main timedesk window is open, not minimized, and the one in front. */
  mainFocused: boolean
  /** The person closed it with the x. It stays closed until the next timer starts. */
  dismissed: boolean
}): boolean {
  if (!s.signedIn || s.dismissed || s.visibility === 'never') return false
  if (s.visibility === 'always') return true
  return s.running && !s.mainFocused
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "● 00:42:10 · Write docs - timedesk", or just "timedesk" when nothing runs. */
export function windowTitle(timer: TimerState & { showInTitle?: boolean }, now: number): string {
  if (!timer.running || !timer.startedAt || timer.showInTitle === false) return 'timedesk'
  const total = Math.max(0, Math.floor((now - timer.startedAt) / 1000))
  const clock = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  return `● ${clock} · ${timer.label || 'Stopwatch'} — timedesk`
}

/** Watches for the person stepping away while a timer runs, and reports when they come back. */
export function createIdleWatcher() {
  let idleSince: number | null = null
  return {
    /**
     * Call every few seconds. Returns the moment the person went idle once they are back (idle time has dropped below
     * the limit) after being away at least `limitMinutes` with the timer running. Otherwise null.
     */
    check(idleSeconds: number, now: number, running: boolean, limitMinutes: number): { idleSince: number } | null {
      if (!running || limitMinutes <= 0) {
        idleSince = null
        return null
      }
      if (idleSeconds >= limitMinutes * 60) {
        if (idleSince === null) idleSince = now - idleSeconds * 1000
        return null
      }
      if (idleSince !== null) {
        const since = idleSince
        idleSince = null
        return { idleSince: since }
      }
      return null
    },
    /**
     * The computer woke up or was unlocked. Returns when the person left (the earlier of going idle and going to sleep)
     * if that was at least `limitMinutes` ago with the timer running. Either way they are back now, so idle tracking starts over.
     */
    resumed(suspendedAt: number, now: number, running: boolean, limitMinutes: number): { idleSince: number } | null {
      const since = idleSince !== null ? Math.min(idleSince, suspendedAt) : suspendedAt
      idleSince = null
      if (!running || limitMinutes <= 0 || now - since < limitMinutes * 60_000) return null
      return { idleSince: since }
    },
    reset() {
      idleSince = null
    },
  }
}

/** "Timer running: Write docs (1h 05m)" or "No timer running": the tray tooltip and menu line, which only change once a minute. */
export function trayStatus(timer: TimerState, now: number): string {
  if (!timer.running) return 'No timer running'
  let elapsed = ''
  if (timer.startedAt) {
    const mins = Math.max(0, Math.floor((now - timer.startedAt) / 60_000))
    elapsed = mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`
  }
  return `Timer running: ${timer.label || 'Stopwatch'} (${elapsed})`
}

/** A failed later check must not hide an update that is already downloaded and ready to install. */
export function mergeUpdateStatus(prev: UpdateStatus, next: UpdateStatus): UpdateStatus {
  if (prev.state === 'ready' && next.state === 'error') return prev
  return next
}

/**
 * How long to wait before reloading a main window whose page crashed: at once the first time, then longer the more it
 * has crashed in the last few minutes, so a page that crashes on load does not spin.
 */
export function crashReloadDelay(recentCrashes: number): number {
  if (recentCrashes <= 1) return 0
  return Math.min(60_000, 1000 * 2 ** (recentCrashes - 1))
}

/** "12 minutes", "1 hour 5 minutes". */
export function describeAway(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000))
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minute${m === 1 ? '' : 's'}` : ''}`
}

const MODES: WidgetMode[] = ['compact', 'expanded', 'dock', 'pomodoro']

/**
 * Applies a change from the page to the saved settings, keeping only values that make sense. Anything unknown or of
 * the wrong type is ignored, so a page can never put the settings file into a bad state.
 */
export function sanitizeDesktopSettings(current: DesktopSettings, patch: unknown): DesktopSettings {
  const next: DesktopSettings = { ...DEFAULT_DESKTOP_SETTINGS, ...current }
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
  for (const k of ['autoStart', 'closeToTray', 'trackApps', 'trackTitles', 'shortcuts', 'focusGuard'] as const) if (typeof p[k] === 'boolean') next[k] = p[k]
  if (p.widget === 'auto' || p.widget === 'always' || p.widget === 'never') next.widget = p.widget
  if (typeof p.widgetMode === 'string' && MODES.includes(p.widgetMode as WidgetMode)) next.widgetMode = p.widgetMode as WidgetMode
  if (typeof p.idleMinutes === 'number' && Number.isFinite(p.idleMinutes)) next.idleMinutes = Math.min(240, Math.max(0, Math.round(p.idleMinutes)))
  if (Array.isArray(p.focusApps)) next.focusApps = sanitizeFocusList(p.focusApps)
  if (Array.isArray(p.focusSites)) next.focusSites = sanitizeFocusList(p.focusSites)
  if (typeof p.focusNudgeSeconds === 'number' && Number.isFinite(p.focusNudgeSeconds)) next.focusNudgeSeconds = Math.min(600, Math.max(5, Math.round(p.focusNudgeSeconds)))
  return next
}
