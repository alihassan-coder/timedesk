import { describe, expect, it } from 'vitest'
import { APP_START_URL, contentSecurityPolicy, DEV_WEB_URL, isInternalUrl, isSafeExternalUrl, linuxOzonePlatform, resolveConfig } from '../src/config.ts'

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
})
