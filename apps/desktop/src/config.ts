/** Where the desktop app finds the timedesk web app. The same web UI runs in the browser and here. */
export interface DesktopConfig {
  webUrl: string
}

export interface ConfigSources {
  /** Command line flag, for example --web-url=http://localhost:5173 */
  argv: string[]
  env: Record<string, string | undefined>
  /** Contents of config.json in the user data folder (a person can edit this), if present. */
  userFile?: Partial<DesktopConfig> | null
  /** Written into the app at build time from TIMEDESK_WEB_URL. */
  baked?: Partial<DesktopConfig> | null
}

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

/** Priority: command line, environment, the user's own file, the build, then the local dev server. */
export function resolveConfig(src: ConfigSources): DesktopConfig {
  const flag = src.argv.find((a) => a.startsWith('--web-url='))?.slice('--web-url='.length)
  const webUrl = clean(flag) ?? clean(src.env.TIMEDESK_WEB_URL) ?? clean(src.userFile?.webUrl) ?? clean(src.baked?.webUrl) ?? DEV_WEB_URL
  return { webUrl }
}

/** Only the app itself may load inside the window; everything else opens in the normal browser. */
export function isInternalUrl(target: string, webUrl: string): boolean {
  try {
    return new URL(target).origin === new URL(webUrl).origin
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
