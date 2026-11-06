import { describe, expect, it } from 'vitest'
import { createFocusGuard } from '../src/focus.ts'
import { sanitizeDesktopSettings } from '../src/widgets.ts'
import { DEFAULT_DESKTOP_SETTINGS } from '../src/bridge.ts'
import type { ForegroundWindow } from '../src/tracker.ts'

function setup(opts: { nudgeSeconds?: number } = {}) {
  let window: ForegroundWindow | null = { app: 'Code', title: 'main.ts' }
  let idle = 0
  let clock = Date.parse('2026-11-06T09:00:00Z')
  let ids = 0
  const nudges: { match: string; label: string; seconds: number }[] = []
  const guard = createFocusGuard({
    getWindow: async () => window,
    getIdleSeconds: () => idle,
    rules: () => ({ apps: ['Discord'], sites: ['YouTube'], nudgeSeconds: opts.nudgeSeconds ?? 15 }),
    nudge: (n) => nudges.push(n),
    now: () => clock,
    newId: () => `session-${++ids}`,
  })
  const run = async (ticks: number, o?: { onBreak?: boolean }) => {
    for (let i = 0; i < ticks; i++) {
      clock += 5000
      await guard.tick(o)
    }
  }
  return {
    guard,
    nudges,
    run,
    show: (w: ForegroundWindow | null) => (window = w),
    setIdle: (s: number) => (idle = s),
  }
}

describe('focus guard', () => {
  it('does nothing until a timer starts', async () => {
    const t = setup()
    await t.run(10)
    expect(t.guard.state().active).toBe(false)
    expect(t.guard.drain()).toEqual([])
  })

  it('counts focused time, then nudges once a distraction lasts long enough', async () => {
    const t = setup()
    t.guard.start('1', 'Write docs')
    await t.run(12) // one minute of work
    t.show({ app: 'Google Chrome', title: 'Cats - YouTube - Google Chrome' })
    await t.run(2) // 10 s: not yet
    expect(t.nudges).toHaveLength(0)
    expect(t.guard.state()).toMatchObject({ active: true, distracted: true, match: 'YouTube', streakSeconds: 10 })
    await t.run(1) // 15 s: nudge
    expect(t.nudges).toEqual([{ match: 'YouTube', label: 'Write docs', seconds: 15 }])
    await t.run(5) // still there: no second nudge yet
    expect(t.nudges).toHaveLength(1)
    t.show({ app: 'Code', title: 'docs.md' })
    await t.run(1)
    expect(t.guard.state()).toMatchObject({ distracted: false, match: null, focusedSeconds: 65, distractedSeconds: 40, interruptions: 1 })
  })

  it('reminds again every two minutes while the distraction goes on', async () => {
    const t = setup({ nudgeSeconds: 10 })
    t.guard.start('1', 'Docs')
    t.show({ app: 'Discord', title: '#general' })
    await t.run(2 + 24) // 10 s, then 120 s more
    expect(t.nudges.map((n) => n.seconds)).toEqual([10, 130])
    expect(t.guard.state().interruptions).toBe(1)
  })

  it('a quick look at a distraction is counted but not nudged', async () => {
    const t = setup()
    t.guard.start('1', 'Docs')
    await t.run(12)
    t.show({ app: 'Discord', title: '' })
    await t.run(1)
    t.show({ app: 'Code', title: '' })
    await t.run(1)
    expect(t.nudges).toHaveLength(0)
    expect(t.guard.state()).toMatchObject({ distractedSeconds: 5, interruptions: 0 })
  })

  it('time away from the computer is away, not distraction, and resets the countdown', async () => {
    const t = setup()
    t.guard.start('1', 'Docs')
    t.show({ app: 'Discord', title: '' })
    await t.run(2)
    t.setIdle(600)
    await t.run(6)
    t.setIdle(0)
    await t.run(2)
    expect(t.nudges).toHaveLength(0)
    t.guard.stop()
    // 20 s distracted, too short to keep as a session
    expect(t.guard.drain()).toEqual([])
  })

  it('rests during a Pomodoro break', async () => {
    const t = setup()
    t.guard.start('1', 'Docs')
    t.show({ app: 'Discord', title: '' })
    await t.run(10, { onBreak: true })
    expect(t.nudges).toHaveLength(0)
    expect(t.guard.state()).toMatchObject({ onBreak: true, distractedSeconds: 0, focusedSeconds: 0 })
  })

  it('keeps a finished session with totals and listed names only, never window titles', async () => {
    const t = setup()
    t.guard.start('1', 'Write docs')
    await t.run(24)
    t.show({ app: 'Google Chrome', title: 'Secret project roadmap - YouTube' })
    await t.run(4)
    t.show({ app: 'Discord', title: 'DM with a friend' })
    await t.run(1)
    t.guard.stop()
    const [s] = t.guard.drain()
    expect(s).toMatchObject({
      id: 'session-1',
      label: 'Write docs',
      focusedSeconds: 120,
      distractedSeconds: 25,
      awaySeconds: 0,
      interruptions: 1,
      distractions: [{ name: 'YouTube', seconds: 20 }, { name: 'Discord', seconds: 5 }],
    })
    expect(JSON.stringify(s)).not.toMatch(/Secret|friend/)
    expect(t.guard.state()).toMatchObject({ active: false, pending: 0 })
  })

  it('switching to another timer finishes one session and starts the next', async () => {
    const t = setup()
    t.guard.start('1', 'First')
    await t.run(20)
    t.guard.start('1', 'First, renamed') // same timer: same session
    await t.run(1)
    t.guard.start('2', 'Second')
    expect(t.guard.state()).toMatchObject({ active: true, focusedSeconds: 0, pending: 1 })
    expect(t.guard.drain()[0]).toMatchObject({ label: 'First, renamed', focusedSeconds: 105 })
  })

  it('puts sessions back after a failed upload, and forgets everything on sign-out', async () => {
    const t = setup()
    t.guard.start('1', 'Docs')
    await t.run(20)
    t.guard.stop()
    const sessions = t.guard.drain()
    t.guard.requeue(sessions)
    expect(t.guard.state().pending).toBe(1)
    t.guard.start('2', 'More')
    t.guard.reset()
    expect(t.guard.state()).toMatchObject({ active: false, pending: 0 })
  })

  it('when no window can be read, nothing is counted', async () => {
    const t = setup()
    t.guard.start('1', 'Docs')
    t.show(null)
    await t.run(20)
    expect(t.guard.state()).toMatchObject({ focusedSeconds: 0, distractedSeconds: 0 })
  })
})

describe('focus guard settings', () => {
  it('is off by default, with starter lists', () => {
    expect(DEFAULT_DESKTOP_SETTINGS).toMatchObject({ focusGuard: false, focusNudgeSeconds: 15 })
    expect(DEFAULT_DESKTOP_SETTINGS.focusSites).toContain('YouTube')
  })
  it('accepts sensible changes and cleans the lists', () => {
    const s = sanitizeDesktopSettings(DEFAULT_DESKTOP_SETTINGS, { focusGuard: true, focusApps: [' Steam ', 'steam', 7], focusSites: [], focusNudgeSeconds: 30 })
    expect(s).toMatchObject({ focusGuard: true, focusApps: ['Steam'], focusSites: [], focusNudgeSeconds: 30 })
  })
  it('ignores junk and keeps the nudge delay within limits', () => {
    const cur = DEFAULT_DESKTOP_SETTINGS
    expect(sanitizeDesktopSettings(cur, { focusGuard: 'yes', focusApps: 'Steam', focusNudgeSeconds: 'soon' })).toEqual(cur)
    expect(sanitizeDesktopSettings(cur, { focusNudgeSeconds: 1 }).focusNudgeSeconds).toBe(5)
    expect(sanitizeDesktopSettings(cur, { focusNudgeSeconds: 99999 }).focusNudgeSeconds).toBe(600)
  })
})
