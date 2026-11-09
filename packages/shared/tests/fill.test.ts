import { describe, expect, it } from 'vitest'
import { learnAppProjects, mergeIntervals, subtractIntervals, suggestGaps, type TimeEntry } from '../src/index.ts'

const M = 60_000
const H = 60 * M
const DAY = Date.parse('2026-11-09T00:00:00Z')
const at = (h: number, m = 0) => DAY + h * H + m * M
const entry = (start: number, end: number | null, projectId: string | null = null): TimeEntry => ({ id: `e${start}`, taskId: null, projectId, startedAt: start, endedAt: end })

describe('intervals', () => {
  it('joins overlapping and touching pieces', () => {
    expect(mergeIntervals([{ start: 5, end: 8 }, { start: 1, end: 3 }, { start: 3, end: 4 }, { start: 7, end: 10 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 10 },
    ])
  })
  it('takes pieces away', () => {
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 2, end: 3 }, { start: 5, end: 12 }])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ])
    expect(subtractIntervals([{ start: 0, end: 10 }], [])).toEqual([{ start: 0, end: 10 }])
  })
})

describe('filling in the day', () => {
  const base = { from: at(0), to: at(18), now: at(18) }

  it('a meeting nobody tracked becomes a suggestion with its title; the tracked part is left out', () => {
    const s = suggestGaps({ ...base, entries: [entry(at(9), at(10, 30))], activity: [], events: [{ title: 'Design review', start: at(10), end: at(11) }] })
    expect(s).toEqual([{ id: `meeting:${at(10, 30)}:${at(11)}`, kind: 'meeting', start: at(10, 30), end: at(11), label: 'Design review', apps: [], projectId: null }])
  })

  it('apps in use with no timer: one stretch, apps by time, and the usual project', () => {
    const activity = [
      { app: 'Code', start: at(13), end: at(13, 40) },
      { app: 'Chrome', start: at(13, 42), end: at(13, 50) }, // 2 minutes away from the screen: still the same stretch
      { app: 'Code', start: at(13, 50), end: at(14, 30) },
    ]
    const [s] = suggestGaps({ ...base, entries: [], activity, events: [], appProjects: { Code: 'site' } })
    expect(s).toMatchObject({ kind: 'activity', start: at(13), end: at(14, 30), label: 'Code, Chrome', apps: ['Code', 'Chrome'], projectId: 'site' })
  })

  it('short pieces are not worth suggesting', () => {
    expect(suggestGaps({ ...base, entries: [], activity: [{ app: 'Slack', start: at(9), end: at(9, 6) }], events: [] })).toEqual([])
  })

  it('a plain gap between tracked time is offered (lunch, or a forgotten timer), but not before the day began', () => {
    const s = suggestGaps({ ...base, entries: [entry(at(9), at(12)), entry(at(13), at(17))], activity: [], events: [] })
    expect(s).toEqual([{ id: `gap:${at(12)}:${at(13)}`, kind: 'gap', start: at(12), end: at(13), label: 'Not tracked', apps: [], projectId: null }])
  })

  it('a running timer covers up to now, and nothing after the end of the window is suggested', () => {
    const s = suggestGaps({ ...base, to: at(15), now: at(15), entries: [entry(at(14), null)], activity: [{ app: 'Code', start: at(14), end: at(16) }], events: [] })
    expect(s).toEqual([])
  })

  it('a meeting wins over app activity at the same time', () => {
    const s = suggestGaps({ ...base, entries: [], activity: [{ app: 'Zoom', start: at(10), end: at(11) }], events: [{ title: 'Standup', start: at(10), end: at(10, 30) }] })
    expect(s.map((x) => [x.kind, x.label])).toEqual([
      ['meeting', 'Standup'],
      ['activity', 'Zoom'],
    ])
    expect(s[1].start).toBe(at(10, 30))
  })
})

describe('learning which project an app belongs to', () => {
  it('the project tracked most while the app was in front', () => {
    const activity = [
      { app: 'Figma', start: at(9), end: at(11) },
      { app: 'Figma', start: at(14), end: at(15) },
      { app: 'Code', start: at(11), end: at(12) },
    ]
    const entries = [entry(at(9), at(11), 'brand'), entry(at(14), at(15), 'site'), entry(at(11), at(12), 'site')]
    expect(learnAppProjects(activity, entries, at(18))).toEqual({ Figma: 'brand', Code: 'site' })
  })
  it('no guess when it is split evenly between less than half', () => {
    const activity = [{ app: 'Chrome', start: at(9), end: at(12) }]
    const entries = [entry(at(9), at(10), 'a'), entry(at(10), at(11), 'b'), entry(at(11), at(12), 'c')]
    expect(learnAppProjects(activity, entries, at(18))).toEqual({})
  })
})
