import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings, type TimerState, type WidgetMode } from '@timedesk/shared'

/** Pure rules for the floating timer, the window title, idle time and the settings. No Electron in here, so they are tested directly. */

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

/**
 * Where the floating window goes. The bottom bar spans the bottom of the screen. The other styles keep the position
 * the person dragged them to (kept inside the screen), or start in the bottom-right corner.
 */
export function widgetBounds(mode: WidgetMode, workArea: Rect, saved?: { x: number; y: number } | null): Rect {
  if (mode === 'dock') {
    const h = WIDGET_SIZES.dock.height
    return { x: workArea.x, y: workArea.y + workArea.height - h, width: workArea.width, height: h }
  }
  const { width, height } = WIDGET_SIZES[mode]
  const x = saved ? saved.x : workArea.x + workArea.width - width - WIDGET_MARGIN
  const y = saved ? saved.y : workArea.y + workArea.height - height - WIDGET_MARGIN
  return {
    x: clamp(x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(y, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  }
}

/** Is the saved position still on a screen that exists? (A monitor may have been unplugged.) */
export function insideAnyScreen(pos: { x: number; y: number }, areas: Rect[]): boolean {
  return areas.some((a) => pos.x >= a.x - 20 && pos.x < a.x + a.width - 20 && pos.y >= a.y - 20 && pos.y < a.y + a.height - 20)
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
    reset() {
      idleSince = null
    },
  }
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
  for (const k of ['autoStart', 'closeToTray', 'trackApps', 'trackTitles', 'shortcuts'] as const) if (typeof p[k] === 'boolean') next[k] = p[k]
  if (p.widget === 'auto' || p.widget === 'always' || p.widget === 'never') next.widget = p.widget
  if (typeof p.widgetMode === 'string' && MODES.includes(p.widgetMode as WidgetMode)) next.widgetMode = p.widgetMode as WidgetMode
  if (typeof p.idleMinutes === 'number' && Number.isFinite(p.idleMinutes)) next.idleMinutes = Math.min(240, Math.max(0, Math.round(p.idleMinutes)))
  return next
}
