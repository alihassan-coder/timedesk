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
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = { autoStart: false, closeToTray: true, trackApps: false, trackTitles: true }

export interface AppInfo {
  version: string
  platform: string
  packaged: boolean
  webUrl: string
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
}

export type TrayAction = 'toggle-timer'

export interface TimedeskBridge {
  isDesktop: true
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
}
