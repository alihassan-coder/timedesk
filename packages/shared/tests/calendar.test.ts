import { describe, expect, it } from 'vitest'
import { addDays, addMonths, dayOfMonth, monthGrid, sameMonth, startOfWeek, weekDays } from '../src/calendar.ts'

describe('calendar helpers', () => {
  it('adds days across month and year edges', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('moves by months and lands on the 1st', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01')
    expect(addMonths('2026-01-10', -1)).toBe('2025-12-01')
  })

  it('weeks start on Monday', () => {
    expect(startOfWeek('2026-11-06')).toBe('2026-11-02') // a Friday
    expect(startOfWeek('2026-11-02')).toBe('2026-11-02') // a Monday
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02') // a Sunday
    expect(weekDays('2026-11-06')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
  })

  it('builds whole-week month grids', () => {
    const grid = monthGrid('2026-11-15')
    expect(grid[0][0]).toBe('2026-10-26')
    expect(grid.at(-1)![6]).toBe('2026-12-06')
    expect(grid.every((w) => w.length === 7)).toBe(true)
    expect(grid.flat().filter((k) => sameMonth(k, '2026-11-01'))).toHaveLength(30)
    expect(monthGrid('2027-02-01')).toHaveLength(4) // Feb 2027 starts on a Monday and has 28 days
    expect(monthGrid('2026-02-01')).toHaveLength(5)
  })

  it('reads the day of month', () => {
    expect(dayOfMonth('2026-11-06')).toBe(6)
  })
})

import { daysInRange, rangeBuckets } from '../src/calendar.ts'

describe('custom range buckets', () => {
  it('counts days inclusively', () => {
    expect(daysInRange('2026-11-01', '2026-11-01')).toBe(1)
    expect(daysInRange('2026-10-30', '2026-11-02')).toBe(4)
    expect(daysInRange('2026-11-05', '2026-11-01')).toBeLessThanOrEqual(0)
  })

  it('uses one bucket per day for short ranges, covering the range exactly', () => {
    const { unit, buckets } = rangeBuckets('2026-11-01', '2026-11-14')
    expect(unit).toBe('day')
    expect(buckets).toHaveLength(14)
    expect(buckets[0].start).toBe(new Date(2026, 10, 1).getTime())
    expect(buckets.at(-1)!.end).toBe(new Date(2026, 10, 15).getTime())
  })

  it('uses weeks for medium ranges and clips the first and last week to the range', () => {
    const { unit, buckets } = rangeBuckets('2026-11-04', '2026-12-30') // Wed to Wed
    expect(unit).toBe('week')
    expect(buckets[0].start).toBe(new Date(2026, 10, 4).getTime())
    expect(buckets[0].end).toBe(new Date(2026, 10, 9).getTime()) // the next Monday
    expect(buckets.at(-1)!.end).toBe(new Date(2026, 11, 31).getTime())
    for (let i = 1; i < buckets.length; i++) expect(buckets[i].start).toBe(buckets[i - 1].end) // no gaps, no overlap
  })

  it('uses months for long ranges', () => {
    const { unit, buckets } = rangeBuckets('2026-01-15', '2026-12-31')
    expect(unit).toBe('month')
    expect(buckets).toHaveLength(12)
    expect(buckets[0].end).toBe(new Date(2026, 1, 1).getTime())
  })

  it('returns nothing for a backwards range', () => {
    expect(rangeBuckets('2026-11-05', '2026-11-01').buckets).toEqual([])
  })
})
