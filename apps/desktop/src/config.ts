/**
 * How the desktop app finds its interface.
 *  - bundled: the packaged app opens its OWN copy of the web interface (built from apps/web) from inside the installer.
 *  - remote:  it opens a website address instead. Used while developing, or when someone points it at one.
 */
export interface DesktopConfig {
  mode: 'bundled' | 'remote'
  /** What the window opens: the bundled app address, or the website address. */
  startUrl: string
  /** The backend the bundled interface talks to (baked in at build time). Used for the security policy. */
  apiUrl: string | null
}

export interface ConfigSources {
  /** Command line flag, for example --web-url=http://localhost:5173 */
  argv: string[]
  env: Record<string, string | undefined>
  /** Contents of config.json in the user data folder (a person can edit this), if present. */
  userFile?: { webUrl?: string } | null
  /** Written into the app at build time. */
  baked?: { apiUrl?: string } | null
  /** Whether the installer contains the interface (dist/app exists). */
  hasBundledUi: boolean
}

/** The address the bundled interface is served from, inside the app. */
export const APP_ORIGIN = 'app://timedesk'
export const APP_START_URL = `${APP_ORIGIN}/`
export const DEV_WEB_URL = 'http://localhost:5173'

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')) : null
  } catch {
    return null
  }
}

/**
 * An address given on purpose (command line, environment, the user's own file) always wins, so a developer can
 * point the app at a local server. Otherwise the app uses its bundled interface, or the local dev server if
 * the interface is not bundled (running from source).
 */
export function resolveConfig(src: ConfigSources): DesktopConfig {
  const flag = src.argv.find((a) => a.startsWith('--web-url='))?.slice('--web-url='.length)
  const remote = clean(flag) ?? clean(src.env.TIMEDESK_WEB_URL) ?? clean(src.userFile?.webUrl)
  const apiUrl = clean(src.baked?.apiUrl)
  if (remote) return { mode: 'remote', startUrl: remote, apiUrl }
  if (src.hasBundledUi) return { mode: 'bundled', startUrl: APP_START_URL, apiUrl }
  return { mode: 'remote', startUrl: DEV_WEB_URL, apiUrl }
}

/**
 * Only the app itself may load inside the window; everything else opens in the normal browser.
 * Custom schemes like app:// have no usable URL.origin (it is the string "null" for every one of them),
 * so they are compared by scheme and host instead.
 */
export function isInternalUrl(target: string, startUrl: string): boolean {
  try {
    const t = new URL(target)
    const s = new URL(startUrl)
    if (s.protocol === 'app:') return t.protocol === 'app:' && t.host === s.host
    return t.origin === s.origin
  } catch {
    return false
  }
}

export function isSafeExternalUrl(target: string): boolean {
  try {
    const p = new URL(target).protocol
    return p === 'https:' || p === 'http:' || p === 'mailto:'
  } catch {
    return false
  }
}

/**
 * Security policy for the bundled interface: it may only load its own files, and talk to its own backend.
 * 'unsafe-inline' for styles only, because the interface sets some styles from code (charts, sizing).
 */
export function contentSecurityPolicy(apiUrl: string | null): string {
  const connect = ["'self'", ...(apiUrl ? [new URL(apiUrl).origin] : [])].join(' ')
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ')
}

/**
 * On a Linux Wayland session the app runs through XWayland unless told otherwise, because always-on-top, placing the
 * floating timer and reading the window in front (active-win) only work there. TIMEDESK_WAYLAND=1, an --ozone-platform
 * flag or ELECTRON_OZONE_PLATFORM_HINT keeps whatever was asked for. Returns the platform to force, and why (for the log).
 */
export function linuxOzonePlatform(src: {
  platform: string
  env: Record<string, string | undefined>
  argv: string[]
  /** Written after a start that showed no window (see startupRecovery). Only counts for the version that wrote it. */
  safeMode?: SafeMode | null
  appVersion?: string
}): { force: 'x11' | 'wayland' | null; disableGpu: boolean; reason: string } {
  const plain = (force: 'x11' | null, reason: string) => ({ force, disableGpu: false, reason })
  if (src.platform !== 'linux') return plain(null, 'not linux')
  const wayland = (src.env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland'
  const safe = !!src.safeMode && src.safeMode.version === src.appVersion && src.env.TIMEDESK_X11 !== '1'
  if (safe) {
    const why = `safe mode after a start with no window (${src.safeMode!.reason}): hardware acceleration off`
    return wayland ? { force: 'wayland', disableGpu: true, reason: `${why}, native Wayland` } : { force: null, disableGpu: true, reason: why }
  }
  if (!wayland) return plain(null, `session type ${src.env.XDG_SESSION_TYPE || 'unknown'}`)
  if (src.env.TIMEDESK_X11 === '1') return plain('x11', 'XWayland (TIMEDESK_X11=1)')
  if (src.env.TIMEDESK_WAYLAND === '1') return plain(null, 'native Wayland (TIMEDESK_WAYLAND=1)')
  if (src.argv.some((a) => a.startsWith('--ozone-platform'))) return plain(null, 'native choice from the command line')
  if (src.env.ELECTRON_OZONE_PLATFORM_HINT) return plain(null, `ELECTRON_OZONE_PLATFORM_HINT=${src.env.ELECTRON_OZONE_PLATFORM_HINT}`)
  return plain('x11', 'Wayland session: using XWayland so the floating timer and app tracking work')
}

/** Remembered in the data folder after a Linux start that showed no window: the next start uses the safe settings. */
export interface SafeMode {
  version: string
  reason: string
}

/**
 * What to do when the start goes wrong on Linux (issue #2: the GPU process crashes through XWayland on some Intel
 * laptops, and the window never appears while the app keeps running invisibly and holds the single-instance lock).
 * - relaunch-safe: remember safe mode and start again (native Wayland on Wayland, no hardware acceleration)
 * - quit: safe mode did not help either; quit so a click on the icon can start it again, instead of hiding forever
 * - ignore: nothing to do (other systems, or the window is already on screen, where Chromium recovers by itself)
 */
export function startupRecovery(s: { platform: string; inSafeMode: boolean; windowShown: boolean; event: 'gpu-crash' | 'no-window' }): 'relaunch-safe' | 'quit' | 'ignore' {
  if (s.platform !== 'linux' || s.windowShown) return 'ignore'
  if (!s.inSafeMode) return 'relaunch-safe'
  return s.event === 'no-window' ? 'quit' : 'ignore'
}
