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
