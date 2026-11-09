import { DEFAULT_FOCUS_APPS, DEFAULT_FOCUS_NUDGE_SECONDS, DEFAULT_FOCUS_SITES, type FocusSession, type FocusState } from './focus.ts'

/**
 * The contract between the web app and the desktop app. The desktop app exposes it as `window.timedesk`
 * inside the page; in a normal browser it does not exist, so the web app checks before using it.
 */

/** One slice of time spent in one window. Uploaded to the API as activity. */
export interface ActivitySample {
  id: string
  app: string
  title: string
  startedAt: string
  seconds: number
}

/** Per-device desktop settings, kept in the app's own data folder (not in the database). */
export interface DesktopSettings {
  /** Start with the computer, hidden in the tray. */
  autoStart: boolean
  /** Closing the window keeps timedesk running in the tray. */
  closeToTray: boolean
  /** Record which app is in front. Off until the person turns it on. */
  trackApps: boolean
  /** Also record window titles (otherwise only app names). */
  trackTitles: boolean
  /** The small floating timer: only while another window is in front ("auto"), all the time, or never. */
  widget: 'auto' | 'always' | 'never'
  widgetMode: WidgetMode
  /** System-wide keys: Ctrl+Alt+T starts or stops the timer, Ctrl+Alt+N adds a task. */
  shortcuts: boolean
  /** Ask what to do with the time when you come back after being away this many minutes. 0 turns it off. */
  idleMinutes: number
  /** Focus guard: while a timer runs, nudge me when a listed app or site is in front. Off until turned on. */
  focusGuard: boolean
  /** Programs that count as a distraction. */
  focusApps: string[]
  /** Words in a browser tab title that count as a distraction. */
  focusSites: string[]
  /** How long a distraction may last before the nudge. */
  focusNudgeSeconds: number
}

export type WidgetMode = 'compact' | 'expanded' | 'dock' | 'pomodoro'

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  autoStart: false,
  closeToTray: true,
  trackApps: false,
  trackTitles: true,
  widget: 'auto',
  widgetMode: 'compact',
  shortcuts: true,
  idleMinutes: 5,
  focusGuard: false,
  focusApps: DEFAULT_FOCUS_APPS,
  focusSites: DEFAULT_FOCUS_SITES,
  focusNudgeSeconds: DEFAULT_FOCUS_NUDGE_SECONDS,
}

export interface AppInfo {
  /** "bundled": the app opens its own copy of the interface. "remote": it opens a website address (development). */
  mode: 'bundled' | 'remote'
  version: string
  platform: string
  packaged: boolean
  /** What the window opened: the bundled app address, or the website address. */
  startUrl: string
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'downloading'; version: string }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

export interface TimerState {
  running: boolean
  label: string
  startedAt: number | null
  /** Show the running time in the window title. Defaults to yes. */
  showInTitle?: boolean
  /** Pomodoro lengths in minutes, so Focus guard can rest during breaks when the Pomodoro style is chosen. */
  pomodoro?: { focus: number; break: number }
}

export type TrayAction = 'toggle-timer'

/** What the person chose after being away: take the idle minutes off the timer (and keep going), or stop it when they left. */
export interface IdleDecision {
  action: 'remove' | 'stop'
  /** When the person went idle, ms since 1970. */
  at: number
}

/** The login token, kept encrypted by the operating system (Windows DPAPI, Linux keyring), never in page storage. */
export interface TokenStore {
  get(): Promise<string | null>
  set(token: string): Promise<void>
  clear(): Promise<void>
}

export interface TimedeskBridge {
  isDesktop: true
  tokens: TokenStore
  info(): Promise<AppInfo>
  notify(title: string, body: string): Promise<void>
  setTimerState(state: TimerState): void
  getSettings(): Promise<DesktopSettings>
  setSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings>
  /** The web app tells the desktop app who is signed in; app tracking only runs while someone is. */
  setSignedIn(signedIn: boolean): void
  /** Takes the recorded samples (and clears them). Put them back with requeueActivity if uploading fails. */
  pullActivity(): Promise<ActivitySample[]>
  requeueActivity(samples: ActivitySample[]): void
  /** The latest update state, so a page that loads late still learns an update is ready. */
  getUpdateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<void>
  installUpdate(): void
  onUpdate(cb: (status: UpdateStatus) => void): () => void
  onTrayAction(cb: (action: TrayAction) => void): () => void
  /** The floating timer and quick-add windows are pages of the same app. These let them act like windows of it. */
  hideWidget(): void
  openMainWindow(): void
  /** Closes the quick-add window (and only that, or the floating timer). */
  closeOwnWindow(): void
  /** Tell the other windows the tasks or the timer changed, so they reload at once. */
  dataChanged(): void
  onDataChanged(cb: () => void): () => void
  onIdleDecision(cb: (d: IdleDecision) => void): () => void
  /** The quick-add window was opened (with the shortcut): clear it and focus the text box. */
  onQuickAddShown(cb: () => void): () => void
  /** Focus guard, live: whether a session runs and whether a distraction is in front. */
  getFocusState(): Promise<FocusState>
  onFocusState(cb: (s: FocusState) => void): () => void
  /** Finished focus sessions (and forget them). Put them back with requeueFocusSessions if uploading fails. */
  pullFocusSessions(): Promise<FocusSession[]>
  requeueFocusSessions(sessions: FocusSession[]): void
}
