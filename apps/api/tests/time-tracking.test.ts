import { beforeAll, describe, expect, it } from 'vitest'
import { api, approvedMember, createTestApp, type TestApp } from './helpers.ts'

let t: TestApp
let me: ReturnType<typeof api>
let other: ReturnType<typeof api>

beforeAll(async () => {
  t = await createTestApp()
  me = api(t, (await approvedMember(t, 'tina')).cookie)
  other = api(t, (await approvedMember(t, 'omar')).cookie)
}, 60_000)

describe('time tracking', () => {
  it('starts a timer, which then shows as running', async () => {
    const started = await me.post('/time-entries/start', {})
    expect(started.status).toBe(201)
    const { entry } = await (await me.get('/time-entries/running')).json()
    expect(entry).toMatchObject({ endedAt: null })
  })

  it('starting a second timer stops the first, so only one is ever running', async () => {
    const first = (await (await me.post('/time-entries/start', { projectId: 'p1' })).json()).entry
    const second = (await (await me.post('/time-entries/start', { projectId: 'p2' })).json()).entry

    const all = (await (await me.get('/time-entries')).json()).entries as { id: string; endedAt: string | null }[]
    expect(all.find((e) => e.id === first.id)!.endedAt).not.toBeNull()
    expect(all.filter((e) => e.endedAt === null).map((e) => e.id)).toEqual([second.id])
  })

  it('stopping records the end time and clears the running timer', async () => {
    const stopped = await me.post('/time-entries/stop')
    expect(stopped.status).toBe(200)
    expect((await stopped.json()).entry.endedAt).not.toBeNull()
    expect((await (await me.get('/time-entries/running')).json()).entry).toBeNull()
  })

  it('stopping when nothing runs is a 409, not a silent success', async () => {
    const res = await me.post('/time-entries/stop')
    expect(res.status).toBe(409)
  })

  it('another user has their own timer and cannot see this one', async () => {
    await me.post('/time-entries/start', {})
    expect((await (await other.get('/time-entries/running')).json()).entry).toBeNull()
    expect((await (await other.get('/time-entries')).json()).entries).toEqual([])
    // and they can run their own at the same time
    expect((await other.post('/time-entries/start', {})).status).toBe(201)
  })

  it('filters entries by a date range', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    const res = await (await me.get(`/time-entries?from=${encodeURIComponent(future)}`)).json()
    expect(res.entries).toEqual([])
  })

  it('can stop at the moment the person went idle, but not before it started or in the future', async () => {
    const started = (await (await me.post('/time-entries/start', {})).json()).entry
    const early = new Date(new Date(started.startedAt).getTime() - 60_000).toISOString()
    const late = new Date(Date.now() + 3_600_000).toISOString()
    expect((await me.post('/time-entries/stop', { endedAt: early })).status).toBe(422)
    expect((await me.post('/time-entries/stop', { endedAt: late })).status).toBe(422)
    const mid = new Date(new Date(started.startedAt).getTime() + 1000).toISOString()
    const stopped = (await (await me.post('/time-entries/stop', { endedAt: mid })).json()).entry
    expect(new Date(stopped.endedAt).toISOString()).toBe(mid)
    expect((await me.post('/time-entries/stop')).status).toBe(409)
  })
})
