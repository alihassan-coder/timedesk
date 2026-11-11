import { describe, expect, it } from 'vitest'
import { ARCHIVE_AFTER_DAYS, archiveByWeek, daysUntil, describeRecurrence, dueBucket, isArchived, nextDue, splitArchived, startOfWeek, toDateKey, type Task } from '../src/index.ts'

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

describe('archive: finished tasks leave the board after a week', () => {
  const DAY = 86_400_000
  const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, projectId: null, status: 'todo', priority: 'medium', due: null, recurrence: null, createdAt: NOW - 30 * DAY, completedAt: null, ...extra })
  const done = (id: string, daysAgo: number | null, extra: Partial<Task> = {}) => task(id, { status: 'done', completedAt: daysAgo === null ? null : NOW - daysAgo * DAY, ...extra })

  it('a task finished less than 7 days ago stays; from 7 days on it is archived', () => {
    expect(ARCHIVE_AFTER_DAYS).toBe(7)
    expect(isArchived(done('a', 6.9), NOW)).toBe(false)
    expect(isArchived(done('b', 7), NOW)).toBe(true)
    expect(isArchived(done('c', 40), NOW)).toBe(true)
  })

  it('open tasks are never archived, however old', () => {
    expect(isArchived(task('open', { createdAt: NOW - 400 * DAY }), NOW)).toBe(false)
    expect(isArchived(task('busy', { status: 'in_progress' }), NOW)).toBe(false)
  })

  it('finished before finish times were saved (no time): archived', () => {
    expect(isArchived(done('old', null), NOW)).toBe(true)
  })

  it('finished copies of a repeating task archive too; the next one stays open', () => {
    const list = [done('post-1', 14, { recurrence: { freq: 'weekly' } }), task('post-2', { recurrence: { freq: 'weekly' } })]
    const { active, archived } = splitArchived(list, NOW)
    expect(active.map((t) => t.id)).toEqual(['post-2'])
    expect(archived.map((t) => t.id)).toEqual(['post-1'])
  })

  it('archive groups by the week the task was finished, newest week first, newest task first', () => {
    const groups = archiveByWeek([done('a', 8), done('b', 20), done('c', 9), done('d', null)])
    expect(groups.map((g) => g.tasks.map((t) => t.id))).toEqual([['a', 'c'], ['b'], ['d']])
    expect(groups[0].weekStart).toBe(startOfWeek(toDateKey(NOW - 8 * DAY)))
    expect(groups.at(-1)!.weekStart).toBeNull() // no finish time: "Earlier"
  })
})
