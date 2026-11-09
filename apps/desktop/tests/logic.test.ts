import { describe, expect, it } from 'vitest'
import { LINUX_WM_CLASS, linuxAutostartEntry, linuxAutostartPath, linuxDesktopEntry, linuxDesktopEntryPath, linuxIconPath } from '../src/autostart.ts'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createTracker, type ForegroundWindow } from '../src/tracker.ts'
import { sanitizeBounds } from '../src/window-state.ts'

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

  it('a very long app name stays one slice (it is compared as stored, cut to 120 characters)', async () => {
    const { tracker, show } = setup()
    const long = 'A'.repeat(300)
    show({ app: long, title: 'x' })
    for (let i = 0; i < 3; i++) await tracker.tick()
    expect(tracker.drain()).toEqual([expect.objectContaining({ app: long.slice(0, 120), seconds: 15 })])
  })

  it('sleep closes the open slice and nothing is recorded until resume', async () => {
    const { tracker } = setup()
    await tracker.tick()
    tracker.pause()
    await tracker.tick()
    await tracker.tick()
    tracker.resume()
    await tracker.tick()
    expect(tracker.drain().map((s) => s.seconds)).toEqual([5, 5])
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

describe('Linux dock icon', () => {
  // Docks show an app's icon by matching its window name (WM_CLASS / app_id) to StartupWMClass in a .desktop file.
  it('the window name comes from desktopName, and every entry points at it', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { desktopName?: string }
    expect(pkg.desktopName).toBe(`${LINUX_WM_CLASS}.desktop`)
    expect(linuxAutostartEntry('/opt/timedesk/timedesk')).toContain('StartupWMClass=timedesk')
    expect(linuxDesktopEntry('/home/sam/Apps/timedesk.AppImage', '/home/sam/icon.png')).toContain('StartupWMClass=timedesk')
  })

  it('the AppImage gets a menu entry that starts it and shows the logo', () => {
    const entry = linuxDesktopEntry('/home/sam/My Apps/timedesk.AppImage', linuxIconPath('/home/sam'))
    expect(entry).toContain('Exec="/home/sam/My Apps/timedesk.AppImage" %U')
    expect(entry).toContain('Icon=/home/sam/.local/share/icons/hicolor/512x512/apps/timedesk.png')
    expect(entry).toContain('Name=timedesk')
    expect(linuxDesktopEntryPath('/home/sam')).toBe('/home/sam/.local/share/applications/timedesk.desktop')
  })

  it('the installed .deb entry uses the same window name', () => {
    const config = createRequire(import.meta.url)('../electron-builder.config.cjs') as { linux: { syncDesktopName?: boolean; desktop?: { entry?: Record<string, string> } } }
    expect(config.linux.syncDesktopName).toBe(true)
    expect(config.linux.desktop?.entry?.StartupWMClass).toBe(LINUX_WM_CLASS)
  })
})
