import { describe, expect, it } from 'vitest'
import { linuxAutostartEntry, linuxAutostartPath } from '../src/autostart.ts'
import { DEV_WEB_URL, isInternalUrl, isSafeExternalUrl, resolveConfig } from '../src/config.ts'
import { createTracker, type ForegroundWindow } from '../src/tracker.ts'
import { sanitizeBounds } from '../src/window-state.ts'

describe('which web address the app opens', () => {
  const none = { argv: [], env: {} }

  it('uses the local dev server when nothing else is set', () => {
    expect(resolveConfig(none).webUrl).toBe(DEV_WEB_URL)
  })

  it('prefers the command line, then the environment, then the user file, then the build', () => {
    const all = {
      argv: ['--web-url=https://cli.example.com'],
      env: { TIMEDESK_WEB_URL: 'https://env.example.com' },
      userFile: { webUrl: 'https://file.example.com' },
      baked: { webUrl: 'https://baked.example.com' },
    }
    expect(resolveConfig(all).webUrl).toBe('https://cli.example.com')
    expect(resolveConfig({ ...all, argv: [] }).webUrl).toBe('https://env.example.com')
    expect(resolveConfig({ ...all, argv: [], env: {} }).webUrl).toBe('https://file.example.com')
    expect(resolveConfig({ ...all, argv: [], env: {}, userFile: null }).webUrl).toBe('https://baked.example.com')
  })

  it('ignores addresses that are not http or https and falls through to the next source', () => {
    expect(resolveConfig({ argv: ['--web-url=javascript:alert(1)'], env: { TIMEDESK_WEB_URL: 'file:///etc/passwd' }, baked: { webUrl: 'https://ok.example.com/' } }).webUrl).toBe('https://ok.example.com')
    expect(resolveConfig({ argv: [], env: { TIMEDESK_WEB_URL: 'not a url' } }).webUrl).toBe(DEV_WEB_URL)
  })

  it('keeps a path but drops a trailing slash', () => {
    expect(resolveConfig({ argv: [], env: { TIMEDESK_WEB_URL: 'https://example.com/app/' } }).webUrl).toBe('https://example.com/app')
  })
})

describe('what may open inside the window', () => {
  it('only the app origin is internal', () => {
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

describe('remembered window position', () => {
  const screens = [{ x: 0, y: 0, width: 1920, height: 1080 }]

  it('uses the default size when nothing was saved or the data is junk', () => {
    expect(sanitizeBounds(null, screens)).toEqual({ width: 1280, height: 820 })
    expect(sanitizeBounds({ width: 'big' as never, height: 5 }, screens)).toEqual({ width: 1280, height: 820 })
  })

  it('keeps a position that is on screen', () => {
    expect(sanitizeBounds({ x: 100, y: 50, width: 1000, height: 700, maximized: true }, screens)).toEqual({ x: 100, y: 50, width: 1000, height: 700, maximized: true })
  })

  it('forgets a position whose monitor was unplugged', () => {
    const out = sanitizeBounds({ x: 3000, y: 100, width: 1000, height: 700 }, screens)
    expect(out.x).toBeUndefined()
    expect(out.width).toBe(1000)
  })

  it('never makes the window unusably small', () => {
    expect(sanitizeBounds({ width: 100, height: 100 }, screens)).toMatchObject({ width: 800, height: 560 })
  })
})

describe('activity tracker', () => {
  function setup(opts: { idle?: () => number; appsOnly?: boolean } = {}) {
    let win: ForegroundWindow | null = { app: 'VS Code', title: 'api.ts' }
    let n = 0
    let clock = 1_700_000_000_000
    const tracker = createTracker({
      getWindow: async () => win,
      getIdleSeconds: opts.idle ?? (() => 0),
      now: () => clock,
      newId: () => `id-${++n}`,
      appsOnly: () => !!opts.appsOnly,
      maxBuffered: 5,
    })
    return {
      tracker,
      show: (w: ForegroundWindow | null) => { win = w },
      advance: (ms: number) => { clock += ms },
    }
  }

  it('adds up the time while the same window stays in front', async () => {
    const { tracker } = setup()
    for (let i = 0; i < 4; i++) await tracker.tick()
    expect(tracker.drain()).toEqual([expect.objectContaining({ app: 'VS Code', title: 'api.ts', seconds: 20 })])
  })

  it('starts a new slice when the window changes', async () => {
    const { tracker, show } = setup()
    await tracker.tick()
    await tracker.tick()
    show({ app: 'Chrome', title: 'Docs' })
    await tracker.tick()
    const out = tracker.drain()
    expect(out.map((s) => [s.app, s.seconds])).toEqual([['VS Code', 10], ['Chrome', 5]])
  })

  it('treats a title change inside the same app as a new slice', async () => {
    const { tracker, show } = setup()
    await tracker.tick()
    show({ app: 'VS Code', title: 'tests.ts' })
    await tracker.tick()
    expect(tracker.drain().map((s) => s.title)).toEqual(['api.ts', 'tests.ts'])
  })

  it('records nothing while the person is idle, and closes the open slice', async () => {
    let idle = 0
    const { tracker } = setup({ idle: () => idle })
    await tracker.tick()
    idle = 300
    await tracker.tick()
    await tracker.tick()
    expect(tracker.drain()).toEqual([expect.objectContaining({ seconds: 5 })])
  })

  it('records nothing when no window can be read (for example the lock screen)', async () => {
    const { tracker, show } = setup()
    show(null)
    await tracker.tick()
    expect(tracker.drain()).toEqual([])
  })

  it('apps-only mode never stores window titles', async () => {
    const { tracker } = setup({ appsOnly: true })
    await tracker.tick()
    expect(tracker.drain()[0].title).toBe('')
  })

  it('draining empties the buffer, and a failed upload can be put back in order', async () => {
    const { tracker, show } = setup()
    await tracker.tick()
    show({ app: 'Slack', title: '' })
    await tracker.tick()
    const first = tracker.drain()
    expect(tracker.drain()).toEqual([])
    tracker.requeue(first)
    expect(tracker.drain().map((s) => s.app)).toEqual(['VS Code', 'Slack'])
  })

  it('stops growing without bound when uploads keep failing', async () => {
    const { tracker, show } = setup()
    for (let i = 0; i < 12; i++) {
      show({ app: `App ${i}`, title: '' })
      await tracker.tick()
    }
    expect(tracker.drain().map((s) => s.app)).toEqual(['App 7', 'App 8', 'App 9', 'App 10', 'App 11'])
  })

  it('gives every slice its own id so a retried upload cannot double count', async () => {
    const { tracker, show } = setup()
    await tracker.tick()
    show({ app: 'Slack', title: '' })
    await tracker.tick()
    const ids = tracker.drain().map((s) => s.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('reset forgets everything, for example on sign out', async () => {
    const { tracker } = setup()
    await tracker.tick()
    tracker.reset()
    expect(tracker.drain()).toEqual([])
  })
})

describe('start with the computer on Linux', () => {
  it('writes a standard autostart entry that launches hidden', () => {
    const entry = linuxAutostartEntry('/opt/timedesk/timedesk')
    expect(entry).toContain('[Desktop Entry]')
    expect(entry).toContain('Exec=/opt/timedesk/timedesk --hidden')
  })

  it('quotes a path with spaces', () => {
    expect(linuxAutostartEntry('/home/a b/timedesk.AppImage')).toContain('Exec="/home/a b/timedesk.AppImage" --hidden')
  })

  it('lives in the per-user autostart folder', () => {
    expect(linuxAutostartPath('/home/sam')).toBe('/home/sam/.config/autostart/timedesk.desktop')
  })
})
