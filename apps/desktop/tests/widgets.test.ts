import { describe, expect, it } from 'vitest'
import { DEFAULT_DESKTOP_SETTINGS } from '@timedesk/shared'
import { WIDGET_SIZES, anchorOf, anchorOnScreen, createIdleWatcher, describeAway, sanitizeDesktopSettings, shouldShowWidget, widgetBounds, windowTitle } from '../src/widgets.ts'

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
