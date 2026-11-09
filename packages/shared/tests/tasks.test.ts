import { describe, expect, it } from 'vitest'
import { daysUntil, describeRecurrence, dueBucket, nextDue, toDateKey } from '../src/index.ts'

// Wednesday 4 Nov 2026, 15:00 local time. Using the Date constructor keeps this timezone-independent.
const NOW = new Date(2026, 10, 4, 15, 0).getTime()

describe('due date categories', () => {
  it.each([
    ['2026-11-02', 'overdue'],
    ['2026-11-03', 'overdue'],
    ['2026-11-04', 'today'],
    ['2026-11-05', 'tomorrow'],
    ['2026-11-06', 'this_week'],
    ['2026-11-11', 'this_week'], // 7 days out is the last day of "this week"
    ['2026-11-12', 'later'],
    [null, 'none'],
  ] as const)('%s is %s', (due, bucket) => {
    expect(dueBucket(due, NOW)).toBe(bucket)
  })

  it('counts whole calendar days, not 24-hour blocks, late in the evening', () => {
    const lateEvening = new Date(2026, 10, 4, 23, 59).getTime()
    expect(daysUntil('2026-11-05', lateEvening)).toBe(1)
  })
})

describe('recurring tasks', () => {
  it('daily moves to the next day, across a month end', () => {
    expect(nextDue('2026-11-30', { freq: 'daily' })).toBe('2026-12-01')
  })
  it('weekly adds 7 days, across a year end', () => {
    expect(nextDue('2026-12-29', { freq: 'weekly' })).toBe('2027-01-05')
  })
  it('monthly keeps the day number', () => {
    expect(nextDue('2026-11-15', { freq: 'monthly' })).toBe('2026-12-15')
  })
  it('monthly on a day the next month does not have lands on its last day, not in the month after', () => {
    expect(nextDue('2026-01-31', { freq: 'monthly' })).toBe('2026-02-28')
    expect(nextDue('2028-01-31', { freq: 'monthly' })).toBe('2028-02-29') // leap year
    expect(nextDue('2026-03-31', { freq: 'monthly' })).toBe('2026-04-30')
    expect(nextDue('2026-12-31', { freq: 'monthly' })).toBe('2027-01-31') // across a year end
  })
  it('custom repeats every N days', () => {
    expect(nextDue('2026-11-04', { freq: 'custom', every: 3 })).toBe('2026-11-07')
  })
  it('custom with a missing or zero interval still moves forward', () => {
    expect(nextDue('2026-11-04', { freq: 'custom' })).toBe('2026-11-05')
    expect(nextDue('2026-11-04', { freq: 'custom', every: 0 })).toBe('2026-11-05')
  })
  it('describes rules in plain words', () => {
    expect(describeRecurrence({ freq: 'weekly' })).toBe('Weekly')
    expect(describeRecurrence({ freq: 'custom', every: 3 })).toBe('Every 3 days')
  })
})

describe('date keys', () => {
  it('formats with zero padding', () => {
    expect(toDateKey(new Date(2026, 0, 5, 9).getTime())).toBe('2026-01-05')
  })
})
