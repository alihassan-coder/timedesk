import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { schema } from '@timedesk/db'
import { startOfWeek, toDateKey } from '@timedesk/shared'
import { EXPORT_ACTIVITY_LIMIT } from '../src/services/account.service.ts'
import { fakeMemory } from './fakes.ts'
import { account, api, approvedMember, createTestApp, DESKTOP_ORIGIN, register, signIn, WEB_ORIGIN, type TestApp } from './helpers.ts'

const SECRET = 'sk-openai-test-key-1234567890'

const deleteAccount = (t: TestApp, auth: { cookie?: string; bearer?: string }, password: string) =>
  t.app.request('/v1/account', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Origin: auth.bearer ? DESKTOP_ORIGIN : WEB_ORIGIN,
      ...(auth.cookie ? { Cookie: auth.cookie } : {}),
      ...(auth.bearer ? { Authorization: `Bearer ${auth.bearer}` } : {}),
    },
    body: JSON.stringify({ password }),
  })

describe('when a task was finished', () => {
  it('is recorded when it is marked done, kept on later edits, and cleared when it is reopened', async () => {
    const t = await createTestApp()
    const me = api(t, (await approvedMember(t, 'finn')).cookie)
    const { task } = await (await me.post('/tasks', { title: 'Write report' })).json()
    expect(task.completedAt).toBeNull()

    const done = (await (await me.patch(`/tasks/${task.id}`, { status: 'done' })).json()).task
    expect(done.completedAt).not.toBeNull()

    const renamed = (await (await me.patch(`/tasks/${task.id}`, { title: 'Write the report' })).json()).task
    expect(renamed.completedAt).toBe(done.completedAt)
    const again = (await (await me.patch(`/tasks/${task.id}`, { status: 'done' })).json()).task
    expect(again.completedAt).toBe(done.completedAt)

    const reopened = (await (await me.patch(`/tasks/${task.id}`, { status: 'todo' })).json()).task
    expect(reopened.completedAt).toBeNull()
  })

  it('is set for a task created as done', async () => {
    const t = await createTestApp()
    const me = api(t, (await approvedMember(t, 'finn')).cookie)
    const { task } = await (await me.post('/tasks', { title: 'Already done', status: 'done' })).json()
    expect(task.completedAt).not.toBeNull()
  })
})

describe('weekly reviews', () => {
  const monday = startOfWeek(toDateKey(Date.now()))

  it('saves and reads back a reflection for a week, one per week', async () => {
    const t = await createTestApp()
    const me = api(t, (await approvedMember(t, 'rhea')).cookie)

    const empty = (await (await me.get(`/reviews/${monday}`)).json()).review
    expect(empty).toMatchObject({ weekStart: monday, wentWell: '', improve: '', updatedAt: null })

    expect((await me.put(`/reviews/${monday}`, { wentWell: ' Shipped the release ', improve: 'Fewer meetings' })).status).toBe(200)
    await me.put(`/reviews/${monday}`, { wentWell: 'Shipped the release', improve: 'No meetings before 11' })
    const saved = (await (await me.get(`/reviews/${monday}`)).json()).review
    expect(saved).toMatchObject({ wentWell: 'Shipped the release', improve: 'No meetings before 11' })

    const rows = await t.db.select().from(schema.weeklyReviews)
    expect(rows).toHaveLength(1)
    expect((await (await me.get('/reviews')).json()).reviews).toHaveLength(1)
  })

  it('names a week by its Monday and refuses other days or junk', async () => {
    const t = await createTestApp()
    const me = api(t, (await approvedMember(t, 'rhea')).cookie)
    expect((await me.put('/reviews/2026-11-04', { wentWell: 'x' })).status).toBe(422) // a Wednesday
    expect((await me.get('/reviews/not-a-date')).status).toBe(422)
    expect((await me.put(`/reviews/${monday}`, { wentWell: 'x'.repeat(4001) })).status).toBe(422)
    expect((await me.put(`/reviews/${monday}`, { wentWell: 'x', extra: 1 })).status).toBe(422)
  })

  it('keeps each person to their own reviews', async () => {
    const t = await createTestApp()
    const rhea = api(t, (await approvedMember(t, 'rhea')).cookie)
    const sam = api(t, (await approvedMember(t, 'sam')).cookie)
    await rhea.put(`/reviews/${monday}`, { wentWell: 'Private thoughts' })
    expect((await (await sam.get(`/reviews/${monday}`)).json()).review.wentWell).toBe('')
    expect((await (await sam.get('/reviews')).json()).reviews).toEqual([])
  })
})

describe('export your data', () => {
  it('downloads everything that is yours as one JSON file, without secrets and without other people', async () => {
    const memory = fakeMemory()
    const t2 = await createTestApp({ memory: memory.memory })
    const ann = await approvedMember(t2, 'anne')
    const me = api(t2, ann.cookie)
    const other = api(t2, (await approvedMember(t2, 'otto')).cookie)

    const { project } = await (await me.post('/projects', { name: 'Website' })).json()
    await me.post('/tasks', { title: 'Write copy', projectId: project.id })
    const gone = (await (await me.post('/tasks', { title: 'Deleted later' })).json()).task
    await me.del(`/tasks/${gone.id}`)
    await me.post('/time-entries/start', { projectId: project.id })
    await me.post('/time-entries/stop', {})
    await me.put(`/reviews/${startOfWeek(toDateKey(Date.now()))}`, { wentWell: 'Good week' })
    await me.patch('/settings', { appearance: { mode: 'dark' } })
    await me.put('/chats/c1', { title: 'Hello', messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] })
    await me.put('/ai/keys/openai', { key: SECRET })
    await me.post('/activity', { samples: [{ id: 'sample-0001', app: 'Code', title: 'main.ts', startedAt: new Date().toISOString(), seconds: 30 }] })
    const [{ id: userId }] = await t2.db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.username, 'anne'))
    memory.add(userId, 'Prefers mornings for deep work')
    await other.post('/tasks', { title: 'Not yours' })

    const res = await me.get('/account/export')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="timedesk-export-\d{4}-\d{2}-\d{2}\.json"/)
    const raw = await res.text()
    const data = JSON.parse(raw)

    expect(data).toMatchObject({ format: 1, app: 'timedesk', user: { username: 'anne', email: 'anne@example.com' } })
    expect(data.projects.map((p: { name: string }) => p.name)).toEqual(['Website'])
    expect(data.tasks.map((x: { title: string }) => x.title)).toEqual(['Write copy'])
    expect(data.timeEntries).toHaveLength(1)
    expect(data.weeklyReviews[0].wentWell).toBe('Good week')
    expect(data.settings.appearance).toEqual({ mode: 'dark' })
    expect(data.chats[0].messages[0].parts[0].text).toBe('hi')
    expect(data.activity[0]).toMatchObject({ app: 'Code', title: 'main.ts', seconds: 30 })
    expect(data.assistantMemories.map((m: { text: string }) => m.text)).toEqual(['Prefers mornings for deep work'])
    expect(data.aiKeysSaved).toEqual(['openai'])
    expect(data.googleCalendar).toEqual({ connected: false })

    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('Not yours')
    expect(raw).not.toContain('"userId"')
    expect(raw).not.toContain('password')
  })

  it('needs you to be signed in', async () => {
    const t = await createTestApp()
    expect((await t.app.request('/v1/account/export', { headers: { Origin: WEB_ORIGIN } })).status).toBe(401)
  })

  it('keeps the file small with months of activity: the latest samples in full, totals per app for all of it', async () => {
    const t3 = await createTestApp()
    const me = api(t3, (await approvedMember(t3, 'busy')).cookie)
    const [{ id: userId }] = await t3.db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.username, 'busy'))
    const total = EXPORT_ACTIVITY_LIMIT + 5
    const base = Date.UTC(2026, 0, 1)
    for (let i = 0; i < total; i += 2_000) {
      const rows = Array.from({ length: Math.min(2_000, total - i) }, (_, j) => ({
        id: `s-${i + j}`,
        userId,
        app: (i + j) % 2 ? 'Code' : 'Browser',
        startedAt: new Date(base + (i + j) * 60_000),
        seconds: 60,
      }))
      await t3.db.insert(schema.activitySamples).values(rows)
    }
    const data = await (await me.get('/account/export')).json()
    expect(data.activity).toHaveLength(EXPORT_ACTIVITY_LIMIT)
    expect(data.activity[0].id).toBe('s-5') // the oldest five are left out, the rest stay in time order
    expect(data.activity.at(-1).id).toBe(`s-${total - 1}`)
    expect(data.activityNote).toContain('latest')
    const seconds = data.activityByApp.reduce((sum: number, a: { seconds: number }) => sum + a.seconds, 0)
    expect(seconds).toBe(total * 60)
    expect(data.activityByApp.map((a: { app: string }) => a.app).sort()).toEqual(['Browser', 'Code'])
  }, 60_000)
})

describe('delete your account', () => {
  it('refuses a wrong password and changes nothing', async () => {
    const t = await createTestApp()
    const { cookie } = await approvedMember(t, 'dora')
    await api(t, cookie).post('/tasks', { title: 'Keep me' })
    const res = await deleteAccount(t, { cookie }, 'wrong-password')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('password')
    expect((await api(t, cookie).get('/me')).status).toBe(200)
    expect(await t.db.select().from(schema.tasks)).toHaveLength(1)
  })

  it('removes the account and everything in it, signs you out, and leaves other people alone', async () => {
    const memory = fakeMemory()
    const t = await createTestApp({ memory: memory.memory })
    const dora = await approvedMember(t, 'dora')
    const me = api(t, dora.cookie)
    const other = api(t, (await approvedMember(t, 'otto')).cookie)

    const { project } = await (await me.post('/projects', { name: 'Gone soon' })).json()
    await me.post('/tasks', { title: 'Mine', projectId: project.id })
    await me.post('/time-entries/start', {})
    await me.put(`/reviews/${startOfWeek(toDateKey(Date.now()))}`, { wentWell: 'x' })
    await me.put('/chats/c1', { title: 'Hello', messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] })
    await me.put('/ai/keys/openai', { key: SECRET })
    await me.patch('/settings', { appearance: { mode: 'dark' } })
    await me.post('/activity', { samples: [{ id: 'sample-0001', app: 'Code', title: '', startedAt: new Date().toISOString(), seconds: 30 }] })
    const [{ id: doraId }] = await t.db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.username, 'dora'))
    memory.add(doraId, 'Likes tea')
    await other.post('/tasks', { title: 'Theirs' })

    expect((await deleteAccount(t, { cookie: dora.cookie }, dora.account.password)).status).toBe(204)

    expect((await me.get('/me')).status).toBe(401)
    expect(await signIn(t, dora.account)).toBeNull()
    for (const table of [schema.projects, schema.timeEntries, schema.weeklyReviews, schema.chats, schema.chatMessages, schema.aiProviderKeys, schema.userSettings, schema.activitySamples, schema.session, schema.account]) {
      const rows = (await t.db.select().from(table)) as { userId?: string }[]
      expect(rows.filter((r) => r.userId === doraId)).toEqual([])
    }
    expect((await t.db.select().from(schema.tasks)).map((r) => r.title)).toEqual(['Theirs'])
    expect(await t.db.select().from(schema.chatMessages)).toEqual([])
    expect(await memory.memory.list(doraId, {})).toEqual([])
    expect((await other.get('/tasks')).status).toBe(200)
  })

  it('works from the desktop app with its token, and the same name can register again afterwards', async () => {
    const t = await createTestApp()
    const a = account('desk')
    await register(t, a)
    await t.db.update(schema.user).set({ status: 'approved' }).where(eq(schema.user.email, a.email))
    const signin = await t.app.request('/api/auth/sign-in/username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: DESKTOP_ORIGIN },
      body: JSON.stringify({ username: a.username, password: a.password }),
    })
    const bearer = signin.headers.get('set-auth-token') ?? ''
    expect(bearer.length).toBeGreaterThan(10)

    expect((await deleteAccount(t, { bearer }, 'nope-nope')).status).toBe(403)
    expect((await deleteAccount(t, { bearer }, a.password)).status).toBe(204)
    expect(await t.db.select().from(schema.user)).toEqual([])
    expect((await register(t, a)).ok).toBe(true)
  })

  it('needs a password in the request', async () => {
    const t = await createTestApp()
    const { cookie } = await approvedMember(t, 'dora')
    expect((await deleteAccount(t, { cookie }, '')).status).toBe(422)
  })
})
