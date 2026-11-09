import { beforeAll, describe, expect, it } from 'vitest'
import { api, approvedMember, createTestApp, type TestApp } from './helpers.ts'

/**
 * What an app that worked offline sends when the connection is back: its own ids and the moments the person really
 * pressed Start and Stop, possibly twice. And several timers at once (multitasking).
 */
let t: TestApp
let me: ReturnType<typeof api>
let other: ReturnType<typeof api>

beforeAll(async () => {
  t = await createTestApp()
  me = api(t, (await approvedMember(t, 'olga')).cookie)
  other = api(t, (await approvedMember(t, 'otto')).cookie)
})

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const running = async (who = me) => (await (await who.get('/time-entries/running')).json()) as { entry: { id: string } | null; entries: { id: string }[] }

describe('timers sent later by an app that was offline', () => {
  it('starts and stops at the times the person pressed the buttons, not when the requests arrived', async () => {
    const start = await me.post('/time-entries/start', { id: 'offline-entry-0001', startedAt: ago(90), taskId: null, projectId: null })
    expect(start.status).toBe(201)
    const stop = await me.post('/time-entries/stop', { id: 'offline-entry-0001', endedAt: ago(30) })
    expect(stop.status).toBe(200)
    const { entry } = await stop.json()
    expect(Date.parse(entry.endedAt) - Date.parse(entry.startedAt)).toBeCloseTo(60 * 60_000, -3)
  })

  it('sending the same start or stop twice changes nothing', async () => {
    const body = { id: 'offline-entry-0002', startedAt: ago(20), taskId: null, projectId: null }
    const a = await (await me.post('/time-entries/start', body)).json()
    const b = await (await me.post('/time-entries/start', body)).json()
    expect(b.entry.id).toBe(a.entry.id)
    const s1 = await (await me.post('/time-entries/stop', { id: 'offline-entry-0002', endedAt: ago(10) })).json()
    const s2 = await (await me.post('/time-entries/stop', { id: 'offline-entry-0002', endedAt: ago(1) })).json()
    expect(s2.entry.endedAt).toBe(s1.entry.endedAt) // the first stop counts
    expect((await running()).entries).toEqual([])
  })

  it('a device clock slightly ahead does not lose the timer: the time is kept within limits', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const r = await me.post('/time-entries/start', { id: 'offline-entry-0003', startedAt: future })
    expect(r.status).toBe(201)
    expect(Date.parse((await r.json()).entry.startedAt)).toBeLessThanOrEqual(Date.now())
    const s = await me.post('/time-entries/stop', { id: 'offline-entry-0003', endedAt: ago(60) }) // before it started
    expect(s.status).toBe(200)
    const { entry } = await s.json()
    expect(entry.endedAt).toBe(entry.startedAt)
  })

  it('refuses a start more than 30 days back, and nobody can use or stop another person\'s timer id', async () => {
    expect((await me.post('/time-entries/start', { id: 'offline-entry-0004', startedAt: ago(31 * 24 * 60) })).status).toBe(422)
    await me.post('/time-entries/start', { id: 'offline-entry-0005' })
    expect((await other.post('/time-entries/start', { id: 'offline-entry-0005' })).status).toBe(409)
    expect((await other.post('/time-entries/stop', { id: 'offline-entry-0005' })).status).toBe(404)
    await me.post('/time-entries/stop', { id: 'offline-entry-0005' })
  })

  it('creating a task or project twice with the same id gives back the first one', async () => {
    const a = await me.post('/tasks', { id: 'task-offline-0001', title: 'Written offline' })
    const b = await me.post('/tasks', { id: 'task-offline-0001', title: 'Written offline' })
    expect([a.status, b.status]).toEqual([201, 201])
    expect((await b.json()).task.id).toBe('task-offline-0001')
    expect((await (await me.get('/tasks')).json()).tasks.filter((x: { id: string }) => x.id === 'task-offline-0001')).toHaveLength(1)
    expect((await other.post('/tasks', { id: 'task-offline-0001', title: 'Mine?' })).status).toBe(409)
    await me.post('/projects', { id: 'project-offline-01', name: 'Offline project' })
    expect((await me.post('/projects', { id: 'project-offline-01', name: 'Offline project' })).status).toBe(201)
  })
})

describe('multitasking', () => {
  it('a timer started alongside keeps the other running; each stops on its own', async () => {
    await me.post('/time-entries/start', { id: 'multi-entry-00001' })
    await me.post('/time-entries/start', { id: 'multi-entry-00002', parallel: true })
    expect((await running()).entries.map((e) => e.id).sort()).toEqual(['multi-entry-00001', 'multi-entry-00002'])
    await me.post('/time-entries/stop', { id: 'multi-entry-00001' })
    expect((await running()).entries.map((e) => e.id)).toEqual(['multi-entry-00002'])
  })

  it('switching stops all running timers; stop with no id stops them all', async () => {
    await me.post('/time-entries/start', { id: 'multi-entry-00003', parallel: true })
    await me.post('/time-entries/start', { id: 'multi-entry-00004' })
    expect((await running()).entries.map((e) => e.id)).toEqual(['multi-entry-00004'])
    await me.post('/time-entries/start', { id: 'multi-entry-00005', parallel: true })
    expect((await me.post('/time-entries/stop', {})).status).toBe(200)
    expect((await running()).entries).toEqual([])
  })

  it('a switch sent late does not stop a timer that another device started after it', async () => {
    await me.post('/time-entries/start', { id: 'multi-entry-00006' }) // started now on device B
    await me.post('/time-entries/start', { id: 'multi-entry-00007', startedAt: ago(30) }) // pressed 30 min ago on offline device A
    const ids = (await running()).entries.map((e) => e.id).sort()
    expect(ids).toEqual(['multi-entry-00006', 'multi-entry-00007'])
    await me.post('/time-entries/stop', {})
  })
})

describe('custom project colours', () => {
  it('keeps a colour the person picked, and can go back to a preset', async () => {
    const { project } = await (await me.post('/projects', { name: 'Client A', color: 9, customColor: '#ff6600' })).json()
    expect(project).toMatchObject({ color: 9, customColor: '#ff6600' })
    const { project: p2 } = await (await me.patch(`/projects/${project.id}`, { customColor: null, color: 12 })).json()
    expect(p2).toMatchObject({ color: 12, customColor: null })
  })

  it('refuses colours that are not #rrggbb, and presets beyond 12', async () => {
    expect((await me.post('/projects', { name: 'X', customColor: 'red' })).status).toBe(422)
    expect((await me.post('/projects', { name: 'X', customColor: '#ff66' })).status).toBe(422)
    expect((await me.post('/projects', { name: 'X', color: 13 })).status).toBe(422)
  })
})
