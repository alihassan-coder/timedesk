import { beforeAll, describe, expect, it } from 'vitest'
import { api, approvedMember, createTestApp, scriptedModel, textStep, toolStep, type TestApp } from './helpers.ts'

/** Today's top 3, adding time afterwards (filling a gap), and the day's app use for suggestions. */
let t: TestApp
let me: ReturnType<typeof api>
let other: ReturnType<typeof api>

beforeAll(async () => {
  t = await createTestApp()
  me = api(t, (await approvedMember(t, 'wren')).cookie)
  other = api(t, (await approvedMember(t, 'xavi')).cookie)
})

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

describe("today's top 3", () => {
  it('a task can be picked for a day with its place, and unpicked', async () => {
    const { task } = await (await me.post('/tasks', { title: 'Write proposal' })).json()
    const { task: picked } = await (await me.patch(`/tasks/${task.id}`, { topDay: '2026-11-09', topRank: 1 })).json()
    expect(picked).toMatchObject({ topDay: '2026-11-09', topRank: 1 })
    const { task: cleared } = await (await me.patch(`/tasks/${task.id}`, { topDay: null, topRank: null })).json()
    expect(cleared).toMatchObject({ topDay: null, topRank: null })
  })

  it('refuses a fourth place and a date that does not exist', async () => {
    const { task } = await (await me.post('/tasks', { title: 'X' })).json()
    expect((await me.patch(`/tasks/${task.id}`, { topRank: 4 })).status).toBe(422)
    expect((await me.patch(`/tasks/${task.id}`, { topDay: '2026-02-31' })).status).toBe(422)
  })
})

describe('adding time afterwards', () => {
  it('adds a finished entry with its own start and end, and the task counts for its project', async () => {
    const { project } = await (await me.post('/projects', { name: 'Site' })).json()
    const { task } = await (await me.post('/tasks', { title: 'Hero', projectId: project.id })).json()
    const res = await me.post('/time-entries', { id: 'filled-entry-0001', taskId: task.id, startedAt: hoursAgo(5), endedAt: hoursAgo(4) })
    expect(res.status).toBe(201)
    const { entry } = await res.json()
    expect(entry).toMatchObject({ taskId: task.id, projectId: project.id })
    expect(Date.parse(entry.endedAt) - Date.parse(entry.startedAt)).toBe(3_600_000)
  })

  it('sending it twice adds it once', async () => {
    const body = { id: 'filled-entry-0002', startedAt: hoursAgo(3), endedAt: hoursAgo(2.5) }
    await me.post('/time-entries', body)
    await me.post('/time-entries', body)
    const { entries } = await (await me.get('/time-entries')).json()
    expect(entries.filter((e: { id: string }) => e.id === 'filled-entry-0002')).toHaveLength(1)
  })

  it('refuses an end before the start, more than a day, or someone else\'s id', async () => {
    expect((await me.post('/time-entries', { id: 'filled-entry-0003', startedAt: hoursAgo(2), endedAt: hoursAgo(3) })).status).toBe(422)
    expect((await me.post('/time-entries', { id: 'filled-entry-0004', startedAt: hoursAgo(30), endedAt: hoursAgo(2) })).status).toBe(422)
    expect((await other.post('/time-entries', { id: 'filled-entry-0001', startedAt: hoursAgo(2), endedAt: hoursAgo(1) })).status).toBe(409)
  })
})

describe("the day's app use", () => {
  it('joins slices of the same app and learns which project each app is tracked on', async () => {
    const { project } = await (await me.post('/projects', { name: 'Brand' })).json()
    // A timer on Brand while Figma was in front, a week ago
    const weekAgo = Date.now() - 7 * 86_400_000
    await me.post('/time-entries', { id: 'filled-entry-0005', projectId: project.id, startedAt: new Date(weekAgo).toISOString(), endedAt: new Date(weekAgo + 3_600_000).toISOString() })
    const slice = (id: string, app: string, at: number, seconds: number) => ({ id, app, title: 'secret file', startedAt: new Date(at).toISOString(), seconds })
    const today = Date.now() - 3 * 3_600_000
    await me.post('/activity', {
      samples: [
        slice('tl-sample-0001', 'Figma', weekAgo, 3600),
        slice('tl-sample-0002', 'Figma', today, 600),
        slice('tl-sample-0003', 'Figma', today + 620_000, 600), // 20 s later: the same stretch
        slice('tl-sample-0004', 'Code', today + 1_300_000, 300),
      ],
    })
    const q = `from=${encodeURIComponent(new Date(today - 3_600_000).toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`
    const body = await (await me.get(`/activity/timeline?${q}`)).json()
    expect(body.blocks.map((b: { app: string }) => b.app)).toEqual(['Figma', 'Code'])
    expect(body.blocks[0].end - body.blocks[0].start).toBe(1_220_000)
    expect(body.appProjects).toEqual({ Figma: project.id })
    expect(JSON.stringify(body)).not.toContain('secret file')
    // and nobody else's
    expect((await (await other.get(`/activity/timeline?${q}`)).json()).blocks).toEqual([])
  })

  it('asks for at most two days', async () => {
    const q = `from=2026-11-01T00:00:00Z&to=2026-11-09T00:00:00Z`
    expect((await me.get(`/activity/timeline?${q}`)).status).toBe(422)
  })
})

describe('Tempo sets the top 3', () => {
  it('picks them in order and replaces the day\'s earlier picks', async () => {
    const { model, prompts } = scriptedModel([toolStep('set_top_tasks', { tasks: ['Call bank', 'Invoices'], day: '2026-11-10' }), textStep('Done.')])
    const app = await createTestApp({ models: () => model })
    const u = api(app, (await approvedMember(app, 'yara')).cookie)
    await u.put('/ai/keys/openai', { key: 'sk-openai-test-key-1234567890' })
    const { task: old } = await (await u.post('/tasks', { title: 'Old pick' })).json()
    await u.patch(`/tasks/${old.id}`, { topDay: '2026-11-10', topRank: 1 })
    await u.post('/tasks', { title: 'Call bank' })
    await u.post('/tasks', { title: 'Invoices' })
    await (await u.post('/assistant/chat', { provider: 'openai', model: 'm', messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'set my top 3' }] }] })).text()
    expect(JSON.stringify(prompts[1])).toContain('Call bank')
    const { tasks } = await (await u.get('/tasks')).json()
    const top = tasks.filter((x: { topDay: string | null }) => x.topDay === '2026-11-10').sort((a: { topRank: number }, b: { topRank: number }) => a.topRank - b.topRank)
    expect(top.map((x: { title: string }) => x.title)).toEqual(['Call bank', 'Invoices'])
  })
})
