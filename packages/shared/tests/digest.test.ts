import { describe, expect, it } from 'vitest'
import { buildDigest, dueBucketOn, isValidTimeZone, planCandidates, timeEntriesCsv, zonedDateKey, zonedDayStart, zonedDays, zonedHour, type DigestTask } from '../src/index.ts'

const H = 3_600_000

describe('dates in a named time zone', () => {
  it('finds midnight in a zone ahead of UTC and one behind it', () => {
    expect(new Date(zonedDayStart('2026-11-06', 'Asia/Karachi')).toISOString()).toBe('2026-11-05T19:00:00.000Z')
    expect(new Date(zonedDayStart('2026-11-06', 'America/New_York')).toISOString()).toBe('2026-11-06T05:00:00.000Z')
    expect(new Date(zonedDayStart('2026-11-06', 'UTC')).toISOString()).toBe('2026-11-06T00:00:00.000Z')
  })

  it('knows the date and hour there, which can differ from the UTC date', () => {
    const at = Date.parse('2026-11-05T20:30:00Z') // 01:30 on the 6th in Karachi
    expect(zonedDateKey(at, 'Asia/Karachi')).toBe('2026-11-06')
    expect(zonedHour(at, 'Asia/Karachi')).toBe(1)
    expect(zonedDateKey(at, 'UTC')).toBe('2026-11-05')
  })

  it('has 23 and 25 hour days when the clocks change', () => {
    const [spring] = zonedDays('2026-03-29', '2026-03-29', 'Europe/London')
    expect((spring.end - spring.start) / H).toBe(23)
    const [autumn] = zonedDays('2026-10-25', '2026-10-25', 'Europe/London')
    expect((autumn.end - autumn.start) / H).toBe(25)
  })

  it('lists consecutive days without gaps', () => {
    const days = zonedDays('2026-11-02', '2026-11-08', 'Asia/Karachi')
    expect(days.map((d) => d.key)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
    for (let i = 1; i < days.length; i++) expect(days[i].start).toBe(days[i - 1].end)
  })

  it('rejects names it does not know', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
  })
})

const task = (over: Partial<DigestTask> & { id: string }): DigestTask => ({
  title: over.id,
  projectId: null,
  status: 'todo',
  priority: 'medium',
  due: null,
  completedAt: null,
  ...over,
})

describe('digest of a range of days', () => {
  const tz = 'UTC'
  const days = zonedDays('2026-11-02', '2026-11-08', tz)
  const prev = zonedDays('2026-10-26', '2026-11-01', tz)
  const at = (iso: string) => Date.parse(iso)
  const entries = [
    { id: 'a', taskId: null, projectId: 'p1', startedAt: at('2026-11-03T09:00:00Z'), endedAt: at('2026-11-03T11:00:00Z') },
    // Crosses midnight into the range: only the part inside counts.
    { id: 'b', taskId: null, projectId: 'p2', startedAt: at('2026-11-01T23:00:00Z'), endedAt: at('2026-11-02T01:00:00Z') },
    { id: 'c', taskId: null, projectId: null, startedAt: at('2026-11-05T10:00:00Z'), endedAt: at('2026-11-05T10:30:00Z') },
    { id: 'old', taskId: null, projectId: 'p1', startedAt: at('2026-10-27T10:00:00Z'), endedAt: at('2026-10-27T13:00:00Z') },
    // A project that was deleted.
    { id: 'd', taskId: null, projectId: 'gone', startedAt: at('2026-11-06T10:00:00Z'), endedAt: at('2026-11-06T10:15:00Z') },
  ]
  const projects = [
    { id: 'p1', name: 'Website' },
    { id: 'p2', name: 'Mobile' },
  ]
  const tasks = [
    task({ id: 'won', status: 'done', completedAt: at('2026-11-04T12:00:00Z'), projectId: 'p1' }),
    task({ id: 'won-later', status: 'done', completedAt: at('2026-11-07T12:00:00Z') }),
    task({ id: 'done-last-week', status: 'done', completedAt: at('2026-10-30T12:00:00Z') }),
    task({ id: 'open' }),
  ]
  const d = buildDigest({ days, previousDays: prev, entries, tasks, projects, now: at('2026-11-09T00:00:00Z') })

  it('totals the time inside the range, split by project and day', () => {
    expect(d.totalMs).toBe(2 * H + 1 * H + 0.5 * H + 0.25 * H)
    expect(d.byProject).toEqual([
      { projectId: 'p1', name: 'Website', ms: 2 * H },
      { projectId: 'p2', name: 'Mobile', ms: 1 * H },
      { projectId: null, name: 'No project', ms: 0.75 * H },
    ])
    expect(d.byDay.find((x) => x.date === '2026-11-02')?.ms).toBe(1 * H)
    expect(d.bestDay).toEqual({ date: '2026-11-03', ms: 2 * H })
    expect(d.sessions).toBe(4)
    expect(d.longestSessionMs).toBe(2 * H)
  })

  it('compares with the days before', () => {
    expect(d.previousTotalMs).toBe(3 * H + 1 * H)
  })

  it('lists only tasks finished inside the range, newest first', () => {
    expect(d.completed.map((t) => t.id)).toEqual(['won-later', 'won'])
    expect(d.completed[1].project).toBe('Website')
  })

  it('has no best day when nothing was tracked', () => {
    const empty = buildDigest({ days, entries: [], tasks: [], projects, now: Date.now() })
    expect(empty.bestDay).toBeNull()
    expect(empty.previousTotalMs).toBeNull()
  })
})

describe('what to work on today', () => {
  const today = '2026-11-06'
  it('puts overdue first, then due today, started, high priority, soon, the rest', () => {
    const list = planCandidates(
      [
        task({ id: 'later-low', priority: 'low', due: '2026-12-01' }),
        task({ id: 'soon', due: '2026-11-08' }),
        task({ id: 'high', priority: 'high' }),
        task({ id: 'started', status: 'in_progress' }),
        task({ id: 'today', due: today }),
        task({ id: 'very-late', due: '2026-11-01' }),
        task({ id: 'late', due: '2026-11-04' }),
        task({ id: 'finished', status: 'done', due: '2026-11-01' }),
      ],
      [],
      today,
    )
    expect(list.map((t) => t.id)).toEqual(['very-late', 'late', 'today', 'started', 'high', 'soon', 'later-low'])
    expect(list[0].reason).toBe('overdue since 2026-11-01')
    expect(list[2].reason).toBe('due today')
  })

  it('uses the date it is given, not the computer clock', () => {
    expect(dueBucketOn('2026-11-06', '2026-11-06')).toBe('today')
    expect(dueBucketOn('2026-11-06', '2026-11-07')).toBe('overdue')
    expect(dueBucketOn(null, '2026-11-07')).toBe('none')
  })

  it('stops at the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => task({ id: 't' + i }))
    expect(planCandidates(many, [], today, 5)).toHaveLength(5)
  })
})

describe('time entries as CSV', () => {
  it('writes one row per finished entry, oldest first, with safe cells', () => {
    const start = new Date(2026, 10, 3, 9, 5).getTime()
    const csv = timeEntriesCsv(
      [
        { id: 'run', taskId: null, projectId: null, startedAt: start + 9 * H, endedAt: null },
        { id: 'b', taskId: 't1', projectId: 'p1', startedAt: start + 2 * H, endedAt: start + 2 * H + 30 * 60_000 },
        { id: 'a', taskId: null, projectId: null, startedAt: start, endedAt: start + 90 * 60_000 },
      ],
      [{ id: 'p1', name: 'Client, Inc' }],
      [{ id: 't1', title: '=HYPERLINK("x")' }],
    )
    expect(csv.split('\r\n')).toEqual([
      'Date,Start,End,Duration,Hours,Project,Task',
      '2026-11-03,09:05,10:35,1:30,1.5,No project,',
      `2026-11-03,11:05,11:35,0:30,0.5,"Client, Inc","'=HYPERLINK(""x"")"`,
      '',
    ])
  })
})
