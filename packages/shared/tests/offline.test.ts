import { describe, expect, it } from 'vitest'
import {
  applyOp,
  dailyTotals,
  failureAction,
  multitaskMs,
  opRequest,
  rebase,
  retryDelay,
  runningEntries,
  splitParallel,
  buildDigest,
  zonedDays,
  type OfflineData,
  type QueuedOp,
  type Task,
  type TimeEntry,
} from '../src/index.ts'

const H = 3_600_000
const T0 = Date.parse('2026-11-09T09:00:00Z')
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, projectId: null, status: 'todo', priority: 'medium', due: null, recurrence: null, createdAt: T0, completedAt: null, ...extra })
const entry = (id: string, start: number, end: number | null, extra: Partial<TimeEntry> = {}): TimeEntry => ({ id, taskId: null, projectId: null, startedAt: start, endedAt: end, ...extra })
const empty: OfflineData = { projects: [], tasks: [], entries: [] }
const q = (op: QueuedOp['op'], n = 0): QueuedOp => ({ opId: `op-${n}`, queuedAt: T0, op, tries: 0 })

describe('offline changes', () => {
  it('the bug from real use: start a timer, lose the internet, stop it — it stops, at the moment Stop was pressed', () => {
    const started = applyOp(empty, { kind: 'timer.start', entry: entry('e1', T0, null), parallel: false })
    expect(runningEntries(started.entries)).toHaveLength(1)
    const stopped = applyOp(started, { kind: 'timer.stop', id: 'e1', endedAt: T0 + 2 * H })
    expect(stopped.entries[0]).toMatchObject({ id: 'e1', endedAt: T0 + 2 * H })
    expect(runningEntries(stopped.entries)).toHaveLength(0)
    // And the requests that go out later carry those exact times, so the server ends up the same.
    expect(opRequest({ kind: 'timer.stop', id: 'e1', endedAt: T0 + 2 * H })).toEqual({ method: 'POST', path: '/time-entries/stop', body: { id: 'e1', endedAt: '2026-11-09T11:00:00.000Z' } })
  })

  it('starting another timer switches: the running one stops when the new one starts', () => {
    let d = applyOp(empty, { kind: 'timer.start', entry: entry('a', T0, null), parallel: false })
    d = applyOp(d, { kind: 'timer.start', entry: entry('b', T0 + H, null), parallel: false })
    expect(d.entries.find((e) => e.id === 'a')?.endedAt).toBe(T0 + H)
    expect(runningEntries(d.entries).map((e) => e.id)).toEqual(['b'])
  })

  it('multitasking: a timer started alongside keeps the others running', () => {
    let d = applyOp(empty, { kind: 'timer.start', entry: entry('a', T0, null), parallel: false })
    d = applyOp(d, { kind: 'timer.start', entry: entry('b', T0 + H, null), parallel: true })
    expect(runningEntries(d.entries).map((e) => e.id)).toEqual(['b', 'a'])
    d = applyOp(d, { kind: 'timer.stop', id: 'a', endedAt: T0 + 2 * H })
    expect(runningEntries(d.entries).map((e) => e.id)).toEqual(['b'])
  })

  it('a stop never ends a timer before it started (clocks differ between devices)', () => {
    const d = applyOp({ ...empty, entries: [entry('a', T0, null)] }, { kind: 'timer.stop', id: 'a', endedAt: T0 - 5000 })
    expect(d.entries[0].endedAt).toBe(T0)
  })

  it('applying the same change twice changes nothing more (it is safe to send or replay twice)', () => {
    const ops: QueuedOp['op'][] = [
      { kind: 'task.create', task: task('t1') },
      { kind: 'timer.start', entry: entry('e1', T0, null), parallel: false },
      { kind: 'timer.stop', id: 'e1', endedAt: T0 + H },
    ]
    const once = ops.reduce(applyOp, empty)
    const twice = ops.reduce(applyOp, once)
    expect(twice).toEqual(once)
  })

  it('after the server data loads, the changes still waiting are put back on top', () => {
    const server: OfflineData = { projects: [], tasks: [task('t1')], entries: [entry('e1', T0, null)] }
    const pending = [
      q({ kind: 'task.update', id: 't1', patch: { status: 'done' }, at: T0 + H }, 1),
      q({ kind: 'task.create', task: task('t2') }, 2),
      q({ kind: 'timer.stop', id: 'e1', endedAt: T0 + H }, 3),
    ]
    const d = rebase(server, pending)
    expect(d.tasks.find((t) => t.id === 't1')).toMatchObject({ status: 'done', completedAt: T0 + H })
    expect(d.tasks.map((t) => t.id)).toEqual(['t2', 't1'])
    expect(d.entries[0].endedAt).toBe(T0 + H)
  })

  it('deleting a project keeps its tasks and time, as "no project"', () => {
    const d = applyOp(
      { projects: [{ id: 'p', name: 'P', description: '', color: 1 }], tasks: [task('t', { projectId: 'p' })], entries: [entry('e', T0, T0 + H, { projectId: 'p' })] },
      { kind: 'project.delete', id: 'p' },
    )
    expect(d).toEqual({ projects: [], tasks: [task('t')], entries: [entry('e', T0, T0 + H)] })
  })

  it('decides what to do when sending failed', () => {
    const start = { kind: 'timer.start', entry: entry('e', T0, null), parallel: false } as const
    expect(failureAction(start, null)).toBe('retry') // offline
    expect(failureAction(start, 503)).toBe('retry') // server asleep or down
    expect(failureAction(start, 429)).toBe('retry')
    expect(failureAction(start, 401)).toBe('signin')
    expect(failureAction(start, 409)).toBe('done') // already there
    expect(failureAction({ kind: 'task.delete', id: 'x' }, 404)).toBe('done') // already gone
    expect(failureAction({ kind: 'task.create', task: task('x') }, 422)).toBe('drop') // refused for good
    expect(retryDelay(1)).toBe(2000)
    expect(retryDelay(4)).toBe(16000)
    expect(retryDelay(50)).toBe(120_000)
  })
})

describe('several timers at once', () => {
  it('leaves entries that never overlap exactly as they are', () => {
    const list = [entry('a', T0, T0 + H), entry('b', T0 + H, T0 + 2 * H)]
    expect(splitParallel(list)).toBe(list)
  })

  it('shares the overlapping hour, so the totals match the clock', () => {
    // a: 9-11, b: 10-12. The clock says 3 hours; 10-11 is shared.
    const pieces = splitParallel([entry('a', T0, T0 + 2 * H, { taskId: 'A' }), entry('b', T0 + H, T0 + 3 * H, { taskId: 'B' })])
    const byTask = (t: string) => pieces.filter((p) => p.taskId === t).reduce((s, p) => s + ((p.endedAt ?? 0) - p.startedAt) * (p.share ?? 1), 0)
    expect(byTask('A')).toBe(1.5 * H)
    expect(byTask('B')).toBe(1.5 * H)
    expect(dailyTotals([entry('a', T0, T0 + 2 * H), entry('b', T0 + H, T0 + 3 * H)], T0 + 4 * H, 1)[0].ms).toBe(3 * H)
  })

  it('works while timers are still running, as the clock moves', () => {
    const list = [entry('a', T0, null), entry('b', T0 + H, null)]
    const pieces = splitParallel(list)
    const total = (now: number) => pieces.reduce((s, p) => s + ((p.endedAt ?? now) - p.startedAt) * (p.share ?? 1), 0)
    expect(total(T0 + 2 * H)).toBe(2 * H)
    expect(total(T0 + 5 * H)).toBe(5 * H)
  })

  it('the digest counts real timers as sessions but shares the time', () => {
    const days = zonedDays('2026-11-09', '2026-11-09', 'UTC')
    const g = buildDigest({ days, entries: [entry('a', T0, T0 + 2 * H, { projectId: 'p' }), entry('b', T0 + H, T0 + 3 * H)], tasks: [], projects: [{ id: 'p', name: 'Site' }], now: T0 + 5 * H })
    expect(g.totalMs).toBe(3 * H)
    expect(g.sessions).toBe(2)
    expect(g.byProject).toEqual([
      { projectId: 'p', name: 'Site', ms: 1.5 * H },
      { projectId: null, name: 'No project', ms: 1.5 * H },
    ])
  })

  it('measures how long you multitasked', () => {
    const list = [entry('a', T0, T0 + 2 * H), entry('b', T0 + H, T0 + 3 * H), entry('c', T0 + 5 * H, T0 + 6 * H)]
    expect(multitaskMs(list, T0, T0 + 24 * H, T0 + 24 * H)).toBe(H)
  })

  it('three at once share in thirds, and nothing is lost', () => {
    const list = [entry('a', T0, T0 + 3 * H), entry('b', T0, T0 + 3 * H), entry('c', T0, T0 + 3 * H)]
    const pieces = splitParallel(list)
    expect(pieces.every((p) => Math.abs((p.share ?? 1) - 1 / 3) < 1e-9)).toBe(true)
    expect(dailyTotals(list, T0 + 4 * H, 1)[0].ms).toBeCloseTo(3 * H)
  })
})
