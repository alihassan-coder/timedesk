import { describe, expect, it } from 'vitest'
import { dailyTotals, entryDuration, formatDuration, formatHours, formatShort, overlapMs, periodStart, type TimeEntry } from '../src/index.ts'

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const entry = (startedAt: number, endedAt: number | null): TimeEntry => ({ id: 'e', taskId: null, projectId: null, startedAt, endedAt })

describe('formatting', () => {
  it('formats a live timer as HH:MM:SS', () => {
    expect(formatDuration(3_725_000)).toBe('01:02:05')
    expect(formatDuration(0)).toBe('00:00:00')
  })
  it('formats summaries as hours and minutes', () => {
    expect(formatHours(5_400_000)).toBe('1h 30m')
    expect(formatHours(600_000)).toBe('10m')
    expect(formatHours(3_600_000)).toBe('1h 00m')
  })
})

describe('short durations', () => {
  it('shows seconds under a minute and hours and minutes above', () => {
    expect(formatShort(35_000)).toBe('35s')
    expect(formatShort(0)).toBe('0s')
    expect(formatShort(59_400)).toBe('59s')
    expect(formatShort(60_000)).toBe('1m')
    expect(formatShort(5_400_000)).toBe('1h 30m')
  })
})

describe('entry duration', () => {
  it('a finished entry lasts from start to end', () => {
    expect(entryDuration(entry(at(2026, 11, 4, 9), at(2026, 11, 4, 10, 30)), at(2026, 11, 5))).toBe(5_400_000)
  })
  it('a running entry counts up to now', () => {
    expect(entryDuration(entry(at(2026, 11, 4, 9), null), at(2026, 11, 4, 9, 15))).toBe(900_000)
  })
  it('never goes negative if the clock is behind', () => {
    expect(entryDuration(entry(at(2026, 11, 4, 9), null), at(2026, 11, 4, 8))).toBe(0)
  })
})

describe('splitting time across days', () => {
  const night = entry(at(2026, 11, 4, 23), at(2026, 11, 5, 1)) // 23:00 to 01:00

  it('counts only the part inside the day', () => {
    expect(overlapMs(night, at(2026, 11, 4), at(2026, 11, 5), 0)).toBe(3_600_000)
    expect(overlapMs(night, at(2026, 11, 5), at(2026, 11, 6), 0)).toBe(3_600_000)
  })
  it('is zero for a day it does not touch', () => {
    expect(overlapMs(night, at(2026, 11, 6), at(2026, 11, 7), 0)).toBe(0)
  })
  it('daily totals put each hour on the right day and end with today', () => {
    const now = at(2026, 11, 5, 12)
    const totals = dailyTotals([night], now, 3)
    expect(totals.map((d) => d.start)).toEqual([at(2026, 11, 3), at(2026, 11, 4), at(2026, 11, 5)])
    expect(totals.map((d) => d.ms)).toEqual([0, 3_600_000, 3_600_000])
  })
})

describe('report periods', () => {
  const now = at(2026, 11, 18, 14, 30)
  it.each([
    ['day', at(2026, 11, 18)],
    ['month', at(2026, 11, 1)],
    ['quarter', at(2026, 10, 1)],
    ['year', at(2026, 1, 1)],
  ] as const)('%s starts at the right moment', (period, expected) => {
    expect(periodStart(period, now)).toBe(expected)
  })
  it('the first quarter starts in January', () => {
    expect(periodStart('quarter', at(2026, 3, 31))).toBe(at(2026, 1, 1))
  })
})
