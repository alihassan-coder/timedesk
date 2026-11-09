import { describe, expect, it } from 'vitest'
import { DEFAULT_DESKTOP_SETTINGS } from '@timedesk/shared'
import { WIDGET_SIZES, anchorOf, anchorOnScreen, crashReloadDelay, createIdleWatcher, describeAway, mergeUpdateStatus, sanitizeDesktopSettings, shouldShowWidget, trayStatus, widgetBounds, windowTitle } from '../src/widgets.ts'

const screen1 = { x: 0, y: 0, width: 1920, height: 1040 } // work area: the taskbar is not included

describe('floating timer position', () => {
  it('starts in the bottom-right corner, with a margin', () => {
    const b = widgetBounds('compact', screen1)
    expect(b).toEqual({ x: 1920 - WIDGET_SIZES.compact.width - 16, y: 1040 - WIDGET_SIZES.compact.height - 16, ...WIDGET_SIZES.compact })
  })
  it('hangs from the corner the person dragged it to, but always on screen', () => {
    expect(widgetBounds('expanded', screen1, { right: 700, bottom: 500 })).toMatchObject({ x: 700 - WIDGET_SIZES.expanded.width, y: 500 - WIDGET_SIZES.expanded.height })
    expect(widgetBounds('expanded', screen1, { right: 5000, bottom: -300 })).toMatchObject({ x: 1920 - WIDGET_SIZES.expanded.width, y: 0 })
  })
  it('every style grows and shrinks around the same bottom-right corner', () => {
    const corner = anchorOf(widgetBounds('compact', screen1, { right: 1000, bottom: 600 }))
    for (const m of ['expanded', 'pomodoro'] as const) expect(anchorOf(widgetBounds(m, screen1, corner))).toEqual(corner)
    expect(anchorOf(widgetBounds('compact', screen1, anchorOf(widgetBounds('expanded', screen1, corner))))).toEqual(corner)
  })
  it('the bottom bar spans the whole bottom edge', () => {
    expect(widgetBounds('dock', screen1, { right: 700, bottom: 500 })).toEqual({ x: 0, y: 1040 - WIDGET_SIZES.dock.height, width: 1920, height: WIDGET_SIZES.dock.height })
  })
  it('every style fits a small 1366x728 screen', () => {
    const small = { x: 0, y: 0, width: 1366, height: 728 }
    for (const m of ['compact', 'expanded', 'dock', 'pomodoro'] as const) {
      const b = widgetBounds(m, small)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(1366)
      expect(b.y + b.height).toBeLessThanOrEqual(728)
    }
  })
  it('notices a saved corner on a monitor that is gone', () => {
    expect(anchorOnScreen({ right: 2500, bottom: 300 }, [screen1])).toBe(false)
    expect(anchorOnScreen({ right: 2500, bottom: 300 }, [screen1, { x: 1920, y: 0, width: 1920, height: 1080 }])).toBe(true)
    expect(anchorOnScreen({ right: 1900, bottom: 1000 }, [screen1])).toBe(true)
  })
})

describe('when the floating timer shows', () => {
  const base = { visibility: 'auto', signedIn: true, running: true, mainFocused: false, dismissed: false } as const
  it('automatic: only while a timer runs and the app is not in front', () => {
    expect(shouldShowWidget(base)).toBe(true)
    expect(shouldShowWidget({ ...base, mainFocused: true })).toBe(false)
    expect(shouldShowWidget({ ...base, running: false })).toBe(false)
  })
  it('always shows (even with no timer), never does not', () => {
    expect(shouldShowWidget({ ...base, visibility: 'always', running: false, mainFocused: true })).toBe(true)
    expect(shouldShowWidget({ ...base, visibility: 'never' })).toBe(false)
  })
  it('stays hidden when signed out or when the person closed it', () => {
    expect(shouldShowWidget({ ...base, signedIn: false })).toBe(false)
    expect(shouldShowWidget({ ...base, visibility: 'always', dismissed: true })).toBe(false)
  })
})

describe('window title', () => {
  const t0 = new Date(2026, 10, 6, 10, 0, 0).getTime()
  it('shows the running time and the task', () => {
    expect(windowTitle({ running: true, label: 'Write docs', startedAt: t0 }, t0 + (42 * 60 + 10) * 1000)).toBe('● 00:42:10 · Write docs — timedesk')
    expect(windowTitle({ running: true, label: '', startedAt: t0 }, t0 + 3_725_000)).toContain('01:02:05 · Stopwatch')
  })
  it('is plain when nothing runs, or when the person turned it off', () => {
    expect(windowTitle({ running: false, label: '', startedAt: null }, t0)).toBe('timedesk')
    expect(windowTitle({ running: true, label: 'x', startedAt: t0, showInTitle: false }, t0)).toBe('timedesk')
  })
})

describe('idle time', () => {
  it('reports when the person is back after being away long enough', () => {
    const w = createIdleWatcher()
    const t = 1_000_000_000
    expect(w.check(10, t, true, 5)).toBeNull()
    expect(w.check(300, t + 290_000, true, 5)).toBeNull() // just crossed 5 minutes: remember when it began
    expect(w.check(600, t + 590_000, true, 5)).toBeNull() // still away
    const back = w.check(2, t + 662_000, true, 5)
    expect(back).toEqual({ idleSince: t + 290_000 - 300_000 })
    expect(w.check(2, t + 670_000, true, 5)).toBeNull() // only once
  })
  it('ignores short breaks, a stopped timer and a turned-off setting', () => {
    const w = createIdleWatcher()
    expect(w.check(100, 1, true, 5)).toBeNull()
    expect(w.check(1, 2, true, 5)).toBeNull()
    expect(w.check(400, 3, false, 5)).toBeNull()
    expect(w.check(1, 4, false, 5)).toBeNull()
    expect(w.check(400, 5, true, 0)).toBeNull()
    expect(w.check(1, 6, true, 0)).toBeNull()
  })
  it('forgets about being away if the timer was stopped meanwhile', () => {
    const w = createIdleWatcher()
    w.check(400, 1000, true, 5)
    w.check(500, 2000, false, 5) // stopped while away
    expect(w.check(1, 3000, true, 5)).toBeNull()
  })
  it('says how long in words', () => {
    expect(describeAway(12 * 60_000)).toBe('12 minutes')
    expect(describeAway(60_000)).toBe('1 minute')
    expect(describeAway(65 * 60_000)).toBe('1 hour 5 minutes')
    expect(describeAway(120 * 60_000)).toBe('2 hours')
  })
})

describe('settings from the page', () => {
  const cur = DEFAULT_DESKTOP_SETTINGS
  it('accepts valid choices', () => {
    expect(sanitizeDesktopSettings(cur, { widget: 'always', widgetMode: 'pomodoro', shortcuts: false, idleMinutes: 15 })).toMatchObject({
      widget: 'always',
      widgetMode: 'pomodoro',
      shortcuts: false,
      idleMinutes: 15,
    })
  })
  it('ignores anything that is not allowed', () => {
    expect(sanitizeDesktopSettings(cur, { widget: 'sometimes', widgetMode: 'giant', idleMinutes: 'soon', autoStart: 'yes', evil: true })).toEqual(cur)
    expect(sanitizeDesktopSettings(cur, null)).toEqual(cur)
  })
  it('keeps idle minutes within limits', () => {
    expect(sanitizeDesktopSettings(cur, { idleMinutes: 99999 }).idleMinutes).toBe(240)
    expect(sanitizeDesktopSettings(cur, { idleMinutes: -5 }).idleMinutes).toBe(0)
  })
  it('fills in new settings for someone who saved an older settings file', () => {
    const old = { autoStart: true, closeToTray: true, trackApps: false, trackTitles: true } as never
    expect(sanitizeDesktopSettings(old, {})).toMatchObject({ autoStart: true, widget: 'auto', widgetMode: 'compact', shortcuts: true, idleMinutes: 5 })
  })
})

describe('coming back from sleep or the lock screen', () => {
  const t = 1_000_000_000
  it('asks about the time when the computer was away long enough with the timer running', () => {
    const w = createIdleWatcher()
    expect(w.resumed(t, t + 6 * 60_000, true, 5)).toEqual({ idleSince: t })
  })
  it('stays quiet after a short sleep, a stopped timer or a turned-off setting', () => {
    const w = createIdleWatcher()
    expect(w.resumed(t, t + 4 * 60_000, true, 5)).toBeNull()
    expect(w.resumed(t, t + 60 * 60_000, false, 5)).toBeNull()
    expect(w.resumed(t, t + 60 * 60_000, true, 0)).toBeNull()
  })
  it('counts from when the person went idle if that was before the computer slept', () => {
    const w = createIdleWatcher()
    w.check(300, t, true, 5) // idle since t - 300s
    expect(w.resumed(t + 60_000, t + 120_000, true, 5)).toEqual({ idleSince: t - 300_000 })
  })
  it('the person is back afterwards, so the idle watcher does not ask a second time', () => {
    const w = createIdleWatcher()
    w.check(300, t, true, 5)
    w.resumed(t + 60_000, t + 120_000, true, 5)
    expect(w.check(1, t + 130_000, true, 5)).toBeNull()
  })
})

describe('tray text', () => {
  const start = 1_000_000_000
  const running = { running: true, label: 'Write docs', startedAt: start }
  it('says what runs and for how long', () => {
    expect(trayStatus({ running: false, label: '', startedAt: null }, start)).toBe('No timer running')
    expect(trayStatus(running, start + 5 * 60_000)).toBe('Timer running: Write docs (5m)')
    expect(trayStatus({ ...running, label: '' }, start + 65 * 60_000)).toBe('Timer running: Stopwatch (1h 05m)')
  })
  it('stays the same within a minute, so the menu is not rebuilt for nothing', () => {
    expect(trayStatus(running, start + 61_000)).toBe(trayStatus(running, start + 119_000))
    expect(trayStatus(running, start + 119_000)).not.toBe(trayStatus(running, start + 120_000))
  })
})

describe('update status', () => {
  it('a failed later check does not hide an update that is ready', () => {
    const ready = { state: 'ready' as const, version: '0.4.0' }
    expect(mergeUpdateStatus(ready, { state: 'error', message: 'offline' })).toBe(ready)
  })
  it('otherwise the newest status wins', () => {
    expect(mergeUpdateStatus({ state: 'downloading', version: '0.4.0' }, { state: 'error', message: 'x' })).toEqual({ state: 'error', message: 'x' })
    expect(mergeUpdateStatus({ state: 'idle' }, { state: 'ready', version: '0.4.0' })).toEqual({ state: 'ready', version: '0.4.0' })
    expect(mergeUpdateStatus({ state: 'error', message: 'x' }, { state: 'downloading', version: '0.4.0' })).toEqual({ state: 'downloading', version: '0.4.0' })
  })
})

describe('reloading a crashed window', () => {
  it('reloads at once the first time, then backs off up to a minute', () => {
    expect(crashReloadDelay(1)).toBe(0)
    expect(crashReloadDelay(2)).toBe(2000)
    expect(crashReloadDelay(3)).toBe(4000)
    expect(crashReloadDelay(20)).toBe(60_000)
  })
})
