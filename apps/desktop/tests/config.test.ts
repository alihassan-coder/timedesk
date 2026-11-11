import { describe, expect, it } from 'vitest'
import { APP_START_URL, contentSecurityPolicy, DEV_WEB_URL, isInternalUrl, isSafeExternalUrl, linuxOzonePlatform, resolveConfig, startupRecovery } from '../src/config.ts'

describe('which interface the app opens', () => {
  const base = { argv: [] as string[], env: {} as Record<string, string | undefined>, hasBundledUi: true }

  it('opens its own bundled interface when it has one and nothing else was asked for', () => {
    expect(resolveConfig(base)).toMatchObject({ mode: 'bundled', startUrl: APP_START_URL })
  })

  it('falls back to the local dev server when running from source without a bundled interface', () => {
    expect(resolveConfig({ ...base, hasBundledUi: false })).toMatchObject({ mode: 'remote', startUrl: DEV_WEB_URL })
  })

  it('an address given on purpose wins, in this order: command line, environment, the user file', () => {
    const all = { ...base, argv: ['--web-url=https://cli.example.com'], env: { TIMEDESK_WEB_URL: 'https://env.example.com' }, userFile: { webUrl: 'https://file.example.com' } }
    expect(resolveConfig(all)).toMatchObject({ mode: 'remote', startUrl: 'https://cli.example.com' })
    expect(resolveConfig({ ...all, argv: [] }).startUrl).toBe('https://env.example.com')
    expect(resolveConfig({ ...all, argv: [], env: {} }).startUrl).toBe('https://file.example.com')
  })

  it('ignores addresses that are not http or https and falls through', () => {
    expect(resolveConfig({ ...base, argv: ['--web-url=javascript:alert(1)'], env: { TIMEDESK_WEB_URL: 'file:///etc/passwd' } })).toMatchObject({ mode: 'bundled' })
    expect(resolveConfig({ ...base, hasBundledUi: false, env: { TIMEDESK_WEB_URL: 'not a url' } }).startUrl).toBe(DEV_WEB_URL)
  })

  it('keeps a path but drops a trailing slash', () => {
    expect(resolveConfig({ ...base, env: { TIMEDESK_WEB_URL: 'https://example.com/app/' } }).startUrl).toBe('https://example.com/app')
  })

  it('remembers which backend the bundled interface talks to', () => {
    expect(resolveConfig({ ...base, baked: { apiUrl: 'https://api.example.com/' } }).apiUrl).toBe('https://api.example.com')
    expect(resolveConfig(base).apiUrl).toBeNull()
  })
})

describe('what may open inside the window', () => {
  it('only the app itself is internal: the bundled address, compared by scheme and host', () => {
    expect(isInternalUrl('app://timedesk/tasks', APP_START_URL)).toBe(true)
    expect(isInternalUrl('app://timedesk.evil.com/', APP_START_URL)).toBe(false)
    expect(isInternalUrl('https://timedesk/', APP_START_URL)).toBe(false)
    // custom schemes all report the origin "null", so they must not be treated as equal to each other
    expect(isInternalUrl('evil://timedesk/', APP_START_URL)).toBe(false)
  })

  it('for a website address, the origin must match exactly', () => {
    expect(isInternalUrl('https://app.example.com/tasks', 'https://app.example.com')).toBe(true)
    expect(isInternalUrl('https://evil.example.com/', 'https://app.example.com')).toBe(false)
    expect(isInternalUrl('https://app.example.com.evil.com/', 'https://app.example.com')).toBe(false)
    expect(isInternalUrl('nonsense', 'https://app.example.com')).toBe(false)
  })

  it('external links may only be web or mail links', () => {
    expect(isSafeExternalUrl('https://github.com')).toBe(true)
    expect(isSafeExternalUrl('mailto:a@b.com')).toBe(true)
    expect(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('security policy of the bundled interface', () => {
  it('lets it load only its own files and talk only to its own backend', () => {
    const csp = contentSecurityPolicy('https://api.example.com')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self' https://api.example.com")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('never allows inline or remote scripts', () => {
    const script = contentSecurityPolicy('https://api.example.com').split('; ').find((d) => d.startsWith('script-src')) ?? ''
    expect(script).not.toContain('unsafe')
    expect(script).not.toContain('http')
  })

  it('without a known backend it only allows itself', () => {
    expect(contentSecurityPolicy(null)).toContain("connect-src 'self'")
    expect(contentSecurityPolicy(null)).not.toContain('https://')
  })
})

describe('Linux display server', () => {
  const wayland = { platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' } as Record<string, string | undefined>, argv: [] as string[] }
  it('runs through XWayland on a Wayland session', () => {
    expect(linuxOzonePlatform(wayland).force).toBe('x11')
  })
  it('leaves X11 sessions, Windows and an explicit choice alone', () => {
    expect(linuxOzonePlatform({ ...wayland, env: { XDG_SESSION_TYPE: 'x11' } }).force).toBeNull()
    expect(linuxOzonePlatform({ ...wayland, platform: 'win32' }).force).toBeNull()
    expect(linuxOzonePlatform({ ...wayland, env: { ...wayland.env, TIMEDESK_WAYLAND: '1' } }).force).toBeNull()
    expect(linuxOzonePlatform({ ...wayland, argv: ['--ozone-platform=wayland'] }).force).toBeNull()
    expect(linuxOzonePlatform({ ...wayland, env: { ...wayland.env, ELECTRON_OZONE_PLATFORM_HINT: 'auto' } }).force).toBeNull()
  })

  // Issue #2: on some Intel GPUs under GNOME Wayland the GPU process crashes through XWayland and no window ever appears.
  // After that happened once, the app starts in safe mode: native Wayland without hardware acceleration.
  const safe = { version: '0.4.1', reason: 'gpu' }
  it('after a failed start, uses native Wayland without the GPU', () => {
    const r = linuxOzonePlatform({ ...wayland, safeMode: safe, appVersion: '0.4.1' })
    expect(r).toMatchObject({ force: 'wayland', disableGpu: true })
    expect(r.reason).toMatch(/safe mode/)
  })
  it('on an X11 session, safe mode only turns the GPU off', () => {
    expect(linuxOzonePlatform({ ...wayland, env: { XDG_SESSION_TYPE: 'x11' }, safeMode: safe, appVersion: '0.4.1' })).toMatchObject({ force: null, disableGpu: true })
  })
  it('an update tries the normal way again (the new version may have fixed it)', () => {
    expect(linuxOzonePlatform({ ...wayland, safeMode: safe, appVersion: '0.5.0' })).toMatchObject({ force: 'x11', disableGpu: false })
  })
  it('TIMEDESK_X11=1 forces XWayland even in safe mode', () => {
    expect(linuxOzonePlatform({ ...wayland, env: { ...wayland.env, TIMEDESK_X11: '1' }, safeMode: safe, appVersion: '0.4.1' })).toMatchObject({ force: 'x11', disableGpu: false })
  })
  it('normally keeps the GPU on', () => {
    expect(linuxOzonePlatform(wayland).disableGpu).toBe(false)
  })
})

describe('recovering from a start that shows no window (Linux)', () => {
  const base = { platform: 'linux', inSafeMode: false, windowShown: false }
  it('a GPU crash before the window appeared switches to safe mode', () => {
    expect(startupRecovery({ ...base, event: 'gpu-crash' })).toBe('relaunch-safe')
  })
  it('a window that never appears switches to safe mode', () => {
    expect(startupRecovery({ ...base, event: 'no-window' })).toBe('relaunch-safe')
  })
  it('already in safe mode and still no window: quit, so the next click on the icon can start it again', () => {
    expect(startupRecovery({ ...base, inSafeMode: true, event: 'no-window' })).toBe('quit')
    expect(startupRecovery({ ...base, inSafeMode: true, event: 'gpu-crash' })).toBe('ignore') // Chromium restarts the GPU process itself
  })
  it('once the window is on screen, a GPU crash is left to Chromium, and other systems are never touched', () => {
    expect(startupRecovery({ ...base, windowShown: true, event: 'gpu-crash' })).toBe('ignore')
    expect(startupRecovery({ ...base, platform: 'win32', event: 'no-window' })).toBe('ignore')
  })
})
