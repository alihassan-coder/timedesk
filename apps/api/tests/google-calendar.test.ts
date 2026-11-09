import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { schema } from '@timedesk/db'
import { createFakeGoogle, type FakeGoogle } from '../src/lib/google-fake.ts'
import { GoogleApiError, GoogleUnreachableError, type GoogleClient } from '../src/lib/google.ts'
import { api, approvedMember, chatAllowingAll, createTestApp, scriptedModel, textStep, toolStep, WEB_ORIGIN, type TestApp } from './helpers.ts'

const REDIRECT = 'http://localhost:3001/v1/integrations/google/callback'
type Api = ReturnType<typeof api>
const SECRET = 'sk-openai-test-key-1234567890'

async function appWith(g?: { client: GoogleClient }, extra: Parameters<typeof createTestApp>[0] = {}) {
  return createTestApp({ ...extra, google: g ? { client: g.client, redirectUri: REDIRECT } : undefined })
}

/** The callback address (without /v1) Google would send the browser back to, with a sign-in code for `name`'s Google account. */
async function startConnect(a: Api, name: string, opts: { desktop?: boolean } = {}) {
  const res = await a.post('/integrations/google/connect', { desktop: opts.desktop ?? false })
  expect(res.status).toBe(200)
  const url = new URL((await res.json()).url)
  url.searchParams.set('code', `code-${name}`)
  return url.pathname.replace(/^\/v1/, '') + url.search
}

/**
 * Starts the connect flow, then plays Google's part: the browser returns to the callback with a sign-in code, carrying
 * the person's login cookie as a real browser does. The desktop flow comes back in the system browser, with no login.
 */
async function connect(t: TestApp, a: Api, name: string, opts: { desktop?: boolean } = {}) {
  const back = await startConnect(a, name, opts)
  return opts.desktop ? t.app.request('/v1' + back) : a.get(back)
}

const ISO = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).toISOString()

describe('Google Calendar: switched off', () => {
  let t: TestApp
  let ann: Api
  beforeAll(async () => {
    t = await appWith()
    ann = api(t, (await approvedMember(t, 'ann')).cookie)
  }, 60_000)

  it('says it is not set up, and refuses to connect or read events', async () => {
    expect(await (await ann.get('/integrations/google')).json()).toMatchObject({ configured: false, connected: false })
    expect((await ann.post('/integrations/google/connect', {})).status).toBe(400)
    expect((await ann.get('/calendar/events?from=2026-11-01&to=2026-11-30')).status).toBe(400)
  })

  it('tasks still work normally without Google', async () => {
    expect((await ann.post('/tasks', { title: 'Plain task', due: '2026-11-10' })).status).toBe(201)
  })

  it('needs a signed-in account for everything but the callback', async () => {
    expect((await t.app.request('/v1/integrations/google')).status).toBe(401)
    expect((await t.app.request('/v1/calendar/events?from=2026-11-01&to=2026-11-30')).status).toBe(401)
    const callback = await t.app.request('/v1/integrations/google/callback?code=x&state=y')
    expect(callback.status).toBe(302) // public, but a bad state just goes back to the app with an error
    expect(callback.headers.get('location')).toBe(`${WEB_ORIGIN}/settings?tab=calendar&google=error`)
  })
})

describe('Google Calendar: connecting', () => {
  let t: TestApp
  let fake: FakeGoogle
  let ann: Api
  let bob: Api
  beforeAll(async () => {
    fake = createFakeGoogle()
    t = await appWith(fake)
    ann = api(t, (await approvedMember(t, 'ann')).cookie)
    bob = api(t, (await approvedMember(t, 'bob')).cookie)
  }, 60_000)

  it('starts disconnected, and gives a Google address with a signed state', async () => {
    expect(await (await ann.get('/integrations/google')).json()).toEqual({ configured: true, connected: false, email: null, pushTasks: true, lastSyncAt: null })
    const { url } = await (await ann.post('/integrations/google/connect', {})).json()
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe(REDIRECT)
    expect(u.searchParams.get('state')).toMatch(/^[\w-]+\.[\w-]+$/)
  })

  it('connecting stores the account, encrypted, and never shows a token', async () => {
    const res = await connect(t, ann, 'ann')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${WEB_ORIGIN}/settings?tab=calendar&google=connected`)

    const status = await (await ann.get('/integrations/google')).json()
    expect(status).toMatchObject({ configured: true, connected: true, email: 'ann@gmail.test', pushTasks: true })
    expect(JSON.stringify(status)).not.toMatch(/token|refresh/i)

    const [row] = await t.db.select().from(schema.googleConnections)
    expect(row.encryptedRefreshToken).toMatch(/^v1\./)
    expect(row.encryptedRefreshToken).not.toContain('refresh-ann@gmail.test')
    expect(row.encryptedAccessToken).not.toContain('access-')
  })

  it('a tampered, truncated or missing state is refused and connects nothing', async () => {
    const { url } = await (await bob.post('/integrations/google/connect', {})).json()
    const good = new URL(url).searchParams.get('state')!
    const [payload, mac] = good.split('.')
    const forged = Buffer.from(JSON.stringify({ u: 'someone-else', d: false, e: Date.now() + 600_000, n: 'x' })).toString('base64url')
    for (const state of [`${forged}.${mac}`, `${payload}.AAAA`, payload, '', 'garbage.garbage']) {
      const res = await t.app.request(`/v1/integrations/google/callback?code=code-bob&state=${encodeURIComponent(state)}`)
      expect(res.headers.get('location')).toBe(`${WEB_ORIGIN}/settings?tab=calendar&google=error`)
    }
    expect((await t.app.request('/v1/integrations/google/callback?code=code-bob')).headers.get('location')).toContain('google=error')
    expect((await (await bob.get('/integrations/google')).json()).connected).toBe(false)
  })

  it('a refused permission or a bad code connects nothing', async () => {
    const { url } = await (await bob.post('/integrations/google/connect', {})).json()
    const state = new URL(url).searchParams.get('state')!
    const denied = await t.app.request(`/v1/integrations/google/callback?error=access_denied&state=${encodeURIComponent(state)}`)
    expect(denied.headers.get('location')).toContain('google=error')
    const bad = await t.app.request(`/v1/integrations/google/callback?code=nonsense&state=${encodeURIComponent(state)}`)
    expect(bad.headers.get('location')).toContain('google=error')
    expect((await (await bob.get('/integrations/google')).json()).connected).toBe(false)
  })

  it('from the desktop app the callback shows a small "you can return" page instead of redirecting', async () => {
    const res = await connect(t, bob, 'bob', { desktop: true })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Connected')
    expect(html).toContain('return to timedesk')
    expect((await (await bob.get('/integrations/google')).json()).email).toBe('bob@gmail.test')
  })

  it('a state is tied to the person who started it, so a code can only be attached to their own account', async () => {
    // ann starts the flow, but the code is for carol's Google: it lands on ANN'S timedesk account, never anyone else's.
    await connect(t, ann, 'carol')
    expect((await (await ann.get('/integrations/google')).json()).email).toBe('carol@gmail.test')
    expect((await (await bob.get('/integrations/google')).json()).email).toBe('bob@gmail.test')
    await connect(t, ann, 'ann')
  })

  it('disconnecting revokes the permission, deletes every token and link, and cannot be undone by anyone else', async () => {
    await ann.post('/tasks', { title: 'Mirrored', due: '2026-11-10' })
    expect(await t.db.select().from(schema.googleTaskLinks)).toHaveLength(1)
    expect((await bob.del('/integrations/google')).status).toBe(204) // bob only ever disconnects bob
    expect((await (await ann.get('/integrations/google')).json()).connected).toBe(true)

    fake.log.length = 0
    expect((await ann.del('/integrations/google')).status).toBe(204)
    expect(fake.log).toContain('revoke')
    expect((await (await ann.get('/integrations/google')).json()).connected).toBe(false)
    expect(await t.db.select().from(schema.googleConnections).where(eq(schema.googleConnections.userId, (await t.db.select().from(schema.user).where(eq(schema.user.email, 'ann@example.com')))[0].id))).toHaveLength(0)
    expect(await t.db.select().from(schema.googleTaskLinks)).toHaveLength(0)
    expect((await ann.get('/calendar/events?from=2026-11-01&to=2026-11-30')).status).toBe(409)
  })
})

describe('Google Calendar: events', () => {
  let t: TestApp
  let fake: FakeGoogle
  let ann: Api
  let bob: Api
  beforeAll(async () => {
    fake = createFakeGoogle()
    t = await appWith(fake)
    ann = api(t, (await approvedMember(t, 'ann')).cookie)
    bob = api(t, (await approvedMember(t, 'bob')).cookie)
    await connect(t, ann, 'ann')
    await connect(t, bob, 'bob')
  }, 60_000)

  const range = '?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z'

  it('lists events in a range, in one simple shape, without cancelled ones', async () => {
    fake.seed('ann@gmail.test', { summary: 'Team lunch', start: { date: '2026-11-12' }, end: { date: '2026-11-13' } })
    fake.seed('ann@gmail.test', { summary: 'Standup', description: 'daily', start: { dateTime: '2026-11-12T09:00:00Z' }, end: { dateTime: '2026-11-12T09:15:00Z' } })
    const gone = fake.seed('ann@gmail.test', { summary: 'Cancelled', start: { date: '2026-11-14' }, end: { date: '2026-11-15' } })
    fake.deleteInGoogle('ann@gmail.test', gone.id)
    fake.seed('ann@gmail.test', { summary: 'December', start: { date: '2026-12-05' }, end: { date: '2026-12-06' } })

    const { events } = await (await ann.get('/calendar/events' + range)).json()
    expect(events.map((e: { title: string }) => e.title).sort()).toEqual(['Standup', 'Team lunch'])
    const lunch = events.find((e: { title: string }) => e.title === 'Team lunch')
    expect(lunch).toMatchObject({ start: '2026-11-12', end: '2026-11-13', allDay: true, description: '' })
    expect(lunch.link).toMatch(/^https:\/\/calendar\.test\//)
    const standup = events.find((e: { title: string }) => e.title === 'Standup')
    expect(standup).toMatchObject({ allDay: false, description: 'daily', start: '2026-11-12T09:00:00Z' })
  })

  it('rejects a missing, backwards or enormous range', async () => {
    expect((await ann.get('/calendar/events')).status).toBe(422)
    expect((await ann.get('/calendar/events?from=2026-12-01&to=2026-11-01')).status).toBe(422)
    expect((await ann.get('/calendar/events?from=2020-01-01&to=2026-11-01')).status).toBe(422)
  })

  it("never shows another person's calendar", async () => {
    const { events } = await (await bob.get('/calendar/events' + range)).json()
    expect(events).toEqual([])
  })

  it('creates all-day and timed events, and they exist in Google', async () => {
    const day = await ann.post('/calendar/events', { title: 'Offsite', start: '2026-11-20', end: '2026-11-22' })
    expect(day.status).toBe(201)
    expect((await day.json()).event).toMatchObject({ title: 'Offsite', start: '2026-11-20', end: '2026-11-22', allDay: true })

    const timed = await ann.post('/calendar/events', { title: 'Call', start: '2026-11-20T14:00:00Z', end: '2026-11-20T15:30:00Z', description: 'agenda' })
    expect((await timed.json()).event).toMatchObject({ allDay: false, description: 'agenda' })

    const oneDay = await (await ann.post('/calendar/events', { title: 'Single', start: '2026-11-25' })).json()
    expect(oneDay.event.end).toBe('2026-11-26') // an all-day event with no end lasts one day

    const titles = fake.eventsOf('ann@gmail.test').map((e) => e.summary)
    expect(titles).toEqual(expect.arrayContaining(['Offsite', 'Call', 'Single']))
    expect(fake.eventsOf('bob@gmail.test')).toHaveLength(0)
  })

  it('refuses nonsense: a mix of dates and times, an end before the start, an empty title', async () => {
    expect((await ann.post('/calendar/events', { title: 'Mixed', start: '2026-11-20', end: '2026-11-20T10:00:00Z' })).status).toBe(422)
    expect((await ann.post('/calendar/events', { title: 'Backwards', start: '2026-11-20T10:00:00Z', end: '2026-11-20T09:00:00Z' })).status).toBe(422)
    expect((await ann.post('/calendar/events', { title: '   ', start: '2026-11-20' })).status).toBe(422)
    expect((await ann.post('/calendar/events', { title: 'Odd', start: 'tomorrow-ish' })).status).toBe(422)
  })

  it('edits an event: rename, and move it between all-day and a time', async () => {
    const id = (await (await ann.post('/calendar/events', { title: 'Review', start: '2026-11-18' })).json()).event.id
    const renamed = await (await ann.patch(`/calendar/events/${id}`, { title: 'Design review' })).json()
    expect(renamed.event).toMatchObject({ title: 'Design review', start: '2026-11-18', allDay: true })

    const moved = await (await ann.patch(`/calendar/events/${id}`, { start: '2026-11-19T10:00:00Z', end: '2026-11-19T11:00:00Z' })).json()
    expect(moved.event).toMatchObject({ allDay: false, start: '2026-11-19T10:00:00Z' })
  })

  it('deletes an event', async () => {
    const id = (await (await ann.post('/calendar/events', { title: 'Temp', start: '2026-11-18' })).json()).event.id
    expect((await ann.del(`/calendar/events/${id}`)).status).toBe(204)
    expect(fake.eventsOf('ann@gmail.test').some((e) => e.id === id)).toBe(false)
    expect((await ann.del(`/calendar/events/${id}`)).status).toBe(404)
  })

  it("cannot edit or delete somebody else's event", async () => {
    const id = (await (await ann.post('/calendar/events', { title: 'Private', start: '2026-11-18' })).json()).event.id
    expect((await bob.patch(`/calendar/events/${id}`, { title: 'Hacked' })).status).toBe(404)
    expect((await bob.del(`/calendar/events/${id}`)).status).toBe(404)
    expect(fake.eventsOf('ann@gmail.test').find((e) => e.id === id)?.summary).toBe('Private')
  })

  it('an event that mirrors a task is changed through the task, not the calendar', async () => {
    await ann.post('/tasks', { title: 'Write report', due: '2026-11-16' })
    const mirror = fake.eventsOf('ann@gmail.test').find((e) => e.extendedProperties?.private?.timedeskTaskId)!
    expect((await ann.patch(`/calendar/events/${mirror.id}`, { title: 'x' })).status).toBe(409)
    expect((await ann.del(`/calendar/events/${mirror.id}`)).status).toBe(409)
    const listed = (await (await ann.get('/calendar/events' + range)).json()).events.find((e: { id: string }) => e.id === mirror.id)
    expect(listed.timedeskTaskId).toBeTruthy() // the browser uses this to show the task instead
  })

  it('refreshes an expired access token by itself, and reuses a good one', async () => {
    const before = fake.refreshCount
    await ann.get('/calendar/events' + range)
    await ann.get('/calendar/events' + range)
    expect(fake.refreshCount).toBe(before) // the saved token is still good

    fake.expireAccessTokens() // Google forgot them (they last an hour)
    expect((await ann.get('/calendar/events' + range)).status).toBe(200)
    expect(fake.refreshCount).toBe(before + 1)
    expect((await ann.get('/calendar/events' + range)).status).toBe(200)
    expect(fake.refreshCount).toBe(before + 1)
  })

  it('when Google no longer accepts the permission, the connection is dropped with a clear message', async () => {
    fake.revokeAccess('bob@gmail.test')
    const res = await bob.get('/calendar/events' + range)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('Connect Google Calendar again')
    expect(body.details).toEqual({ code: 'google_reconnect' })
    expect((await (await bob.get('/integrations/google')).json()).connected).toBe(false)
    expect((await (await ann.get('/integrations/google')).json()).connected).toBe(true) // ann is untouched
  })

  it('answers 502 with a calm message when Google itself fails', async () => {
    const broken: GoogleClient = { ...fake.client, listEvents: async () => { throw new GoogleApiError(500, 'boom') } }
    const t2 = await appWith({ client: broken })
    const dan = api(t2, (await approvedMember(t2, 'dan')).cookie)
    await connect(t2, dan, 'dan')
    const res = await dan.get('/calendar/events' + range)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('did not answer')
  }, 60_000)
})

describe('Google Calendar: tasks and events stay in step', () => {
  let t: TestApp
  let fake: FakeGoogle
  let ann: Api
  const mirrors = () => fake.eventsOf('ann@gmail.test').filter((e) => e.extendedProperties?.private?.timedeskTaskId)
  const taskId = async (title: string) => (await (await ann.get('/tasks')).json()).tasks.find((x: { title: string }) => x.title === title).id
  const links = () => t.db.select().from(schema.googleTaskLinks)

  beforeAll(async () => {
    fake = createFakeGoogle()
    t = await appWith(fake)
    ann = api(t, (await approvedMember(t, 'ann')).cookie)
    await connect(t, ann, 'ann')
  }, 60_000)

  it('a task with a due date appears as an all-day event, and one without does not', async () => {
    const task = (await (await ann.post('/tasks', { title: 'Send invoice', due: '2026-11-10', priority: 'high' })).json()).task
    await ann.post('/tasks', { title: 'Someday', due: null })
    expect(mirrors()).toHaveLength(1)
    const e = mirrors()[0]
    expect(e).toMatchObject({ summary: 'Send invoice', start: { date: '2026-11-10' }, end: { date: '2026-11-11' }, transparency: 'transparent' })
    expect(e.extendedProperties?.private).toEqual({ timedeskTaskId: task.id, timedeskManaged: '1' })
    expect(await links()).toHaveLength(1)
  })

  it('moving or renaming the task updates the same event', async () => {
    const id = await taskId('Send invoice')
    const eventId = mirrors()[0].id
    await ann.patch(`/tasks/${id}`, { due: '2026-11-12' })
    await ann.patch(`/tasks/${id}`, { title: 'Send the invoice' })
    expect(mirrors()).toHaveLength(1)
    expect(mirrors()[0]).toMatchObject({ id: eventId, summary: 'Send the invoice', start: { date: '2026-11-12' }, end: { date: '2026-11-13' } })
  })

  it('completing marks it with a check, reopening removes it, and a finished task is not newly added', async () => {
    const id = await taskId('Send the invoice')
    await ann.patch(`/tasks/${id}`, { status: 'done' })
    expect(mirrors()[0].summary).toBe('✓ Send the invoice')
    await ann.patch(`/tasks/${id}`, { status: 'todo' })
    expect(mirrors()[0].summary).toBe('Send the invoice')

    await ann.post('/tasks', { title: 'Already done', due: '2026-11-11', status: 'done' })
    expect(mirrors().map((e) => e.summary)).toEqual(['Send the invoice'])
  })

  it('clearing the date, or deleting the task, removes the event and the link', async () => {
    const a = (await (await ann.post('/tasks', { title: 'Temp A', due: '2026-11-14' })).json()).task.id
    const b = (await (await ann.post('/tasks', { title: 'Temp B', due: '2026-11-15' })).json()).task.id
    expect(mirrors()).toHaveLength(3)
    await ann.patch(`/tasks/${a}`, { due: null })
    expect(mirrors().map((e) => e.summary)).not.toContain('Temp A')
    await ann.del(`/tasks/${b}`)
    expect(mirrors().map((e) => e.summary)).not.toContain('Temp B')
    expect(await links()).toHaveLength(1)
  })

  it('finishing a recurring task mirrors the next occurrence too', async () => {
    const id = (await (await ann.post('/tasks', { title: 'Weekly sync', due: '2026-11-16', recurrence: { freq: 'weekly' } })).json()).task.id
    await ann.patch(`/tasks/${id}`, { status: 'done' })
    const days = mirrors().filter((e) => e.summary?.endsWith('Weekly sync')).map((e) => `${e.summary}@${e.start?.date}`).sort()
    expect(days).toEqual(['Weekly sync@2026-11-23', '✓ Weekly sync@2026-11-16'])
  })

  it('a rename or move made in Google comes back with "Sync now"', async () => {
    const id = await taskId('Send the invoice')
    const event = mirrors().find((e) => e.extendedProperties?.private?.timedeskTaskId === id)!
    fake.editInGoogle('ann@gmail.test', event.id, { summary: 'Invoice client', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } })

    const res = await (await ann.post('/calendar/sync')).json()
    expect(res).toMatchObject({ updatedTasks: 1, unlinked: 0 })
    const task = (await (await ann.get('/tasks')).json()).tasks.find((x: { id: string }) => x.id === id)
    expect(task).toMatchObject({ title: 'Invoice client', due: '2026-11-20' })
    expect((await (await ann.get('/integrations/google')).json()).lastSyncAt).not.toBeNull()
  })

  it("timedesk's own writes do not echo back as changes", async () => {
    const res = await (await ann.post('/calendar/sync')).json()
    expect(res.updatedTasks).toBe(0)
    await ann.patch(`/tasks/${await taskId('Invoice client')}`, { title: 'Invoice the client' })
    expect((await (await ann.post('/calendar/sync')).json()).updatedTasks).toBe(0)
    expect((await (await ann.get('/tasks')).json()).tasks.find((x: { title: string }) => x.title === 'Invoice the client')).toBeTruthy()
  })

  it('a ✓ added in Google is not kept in the task title', async () => {
    const id = await taskId('Invoice the client')
    const event = mirrors().find((e) => e.extendedProperties?.private?.timedeskTaskId === id)!
    fake.editInGoogle('ann@gmail.test', event.id, { summary: '✓ Invoice the client' })
    await ann.post('/calendar/sync')
    expect((await (await ann.get('/tasks')).json()).tasks.find((x: { id: string }) => x.id === id).title).toBe('Invoice the client')
  })

  it('an event deleted in Google keeps the task and is not put back by a sync', async () => {
    const id = await taskId('Invoice the client')
    const event = mirrors().find((e) => e.extendedProperties?.private?.timedeskTaskId === id)!
    fake.deleteInGoogle('ann@gmail.test', event.id)
    const res = await (await ann.post('/calendar/sync')).json()
    expect(res.unlinked).toBe(1)
    expect((await (await ann.get('/tasks')).json()).tasks.some((x: { id: string }) => x.id === id)).toBe(true)
    expect(mirrors().some((e) => e.extendedProperties?.private?.timedeskTaskId === id)).toBe(false)
    expect((await links()).find((l) => l.taskId === id)?.googleEventId).toBe(`deleted:${id}`)
    // a second sync does not recreate it either
    await ann.post('/calendar/sync')
    expect(mirrors().some((e) => e.extendedProperties?.private?.timedeskTaskId === id)).toBe(false)
  })

  it('a task edited after its event was deleted in Google gets a fresh event', async () => {
    const id = await taskId('Invoice the client')
    await ann.patch(`/tasks/${id}`, { due: '2026-11-25' })
    const event = mirrors().find((e) => e.extendedProperties?.private?.timedeskTaskId === id)!
    expect(event.start?.date).toBe('2026-11-25')
  })

  it('turning "push tasks" off stops mirroring, and turning it on adds the open tasks that are missing', async () => {
    const off = await (await ann.patch('/integrations/google', { pushTasks: false })).json()
    expect(off.pushTasks).toBe(false)
    const before = mirrors().length
    await ann.post('/tasks', { title: 'Added while off', due: '2026-11-30' })
    expect(mirrors()).toHaveLength(before)

    const on = await (await ann.patch('/integrations/google', { pushTasks: true })).json()
    expect(on.pushTasks).toBe(true)
    expect(mirrors().map((e) => e.summary)).toContain('Added while off')
    expect(mirrors()).toHaveLength(before + 1)
  })

  it('an unsupported setting is refused', async () => {
    expect((await ann.patch('/integrations/google', { calendarId: 'other' })).status).toBe(422)
    expect((await ann.patch('/integrations/google', {})).status).toBe(422)
  })

  it('a Google outage never stops a task from being saved', async () => {
    const flaky: GoogleClient = { ...fake.client, insertEvent: async () => { throw new GoogleApiError(500, 'down') }, patchEvent: async () => { throw new GoogleApiError(500, 'down') } }
    const t2 = await appWith({ client: flaky })
    const eve = api(t2, (await approvedMember(t2, 'eve')).cookie)
    await connect(t2, eve, 'eve')
    const res = await eve.post('/tasks', { title: 'Still saved', due: '2026-11-10' })
    expect(res.status).toBe(201)
    expect((await (await eve.get('/tasks')).json()).tasks).toHaveLength(1)
  }, 60_000)

  it('people with the feature off, or never connected, are not affected at all', async () => {
    const t2 = await appWith(fake)
    const fay = api(t2, (await approvedMember(t2, 'fay')).cookie)
    fake.log.length = 0
    expect((await fay.post('/tasks', { title: 'No calendar', due: '2026-11-10' })).status).toBe(201)
    expect(fake.log).toEqual([]) // not one call to Google
    expect((await fay.post('/calendar/sync')).status).toBe(409)
  }, 60_000)
})

describe('Google Calendar: Tempo', () => {
  const chat = (text: string) => ({ provider: 'openai', model: 'gpt-test', messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }] })

  async function setup(stepsOf: unknown[][] | ((fake: FakeGoogle) => unknown[][]), connected: boolean) {
    const fake = createFakeGoogle()
    const { model, prompts } = scriptedModel(typeof stepsOf === 'function' ? stepsOf(fake) : stepsOf)
    const t = await appWith(fake, { models: () => model })
    const ann = api(t, (await approvedMember(t, 'ann')).cookie)
    await ann.put('/ai/keys/openai', { key: SECRET })
    if (connected) await connect(t, ann, 'ann')
    return { fake, prompts, ann, t }
  }

  it('lists and creates calendar events when the calendar is connected', async () => {
    const { fake, ann } = await setup(
      [
        toolStep('create_calendar_event', { title: 'Dentist', date: '2026-11-18', startTime: '15:00', endTime: '16:00', timeZone: 'Europe/London' }, 'c1'),
        toolStep('list_calendar_events', { from: '2026-11-16', to: '2026-11-20' }, 'c2'),
        textStep('Done.'),
      ],
      true,
    )
    fake.seed('ann@gmail.test', { summary: 'Existing', start: { date: '2026-11-17' }, end: { date: '2026-11-18' } })
    const body = await chatAllowingAll(ann, chat('book the dentist'))
    expect(body).toContain('Done.')
    const dentist = fake.eventsOf('ann@gmail.test').find((e) => e.summary === 'Dentist')!
    expect(dentist.start).toEqual({ dateTime: '2026-11-18T15:00:00', date: null, timeZone: 'Europe/London' })
    expect(body).toContain('Existing') // the listing result reached the model
  }, 30_000)

  it("lists the person's own days, in their time zone, not the server's", async () => {
    const { fake, ann } = await setup([toolStep('list_calendar_events', { from: '2026-11-16', to: '2026-11-16' }), textStep('Done.')], true)
    // 01:00 on 16 Nov in Kiritimati (UTC+14) is still 15 Nov in UTC and in any server zone
    fake.seed('ann@gmail.test', { summary: 'Early call', start: { dateTime: '2026-11-15T11:00:00Z' }, end: { dateTime: '2026-11-15T11:30:00Z' } })
    fake.seed('ann@gmail.test', { summary: 'Day before', start: { dateTime: '2026-11-15T08:00:00Z' }, end: { dateTime: '2026-11-15T08:30:00Z' } })
    const body = await (await ann.post('/assistant/chat', { ...chat('what is on the 16th'), timeZone: 'Pacific/Kiritimati' })).text()
    expect(body).toContain('Early call')
    expect(body).not.toContain('Day before') // 22:00 on 15 Nov there
  }, 30_000)

  it('asks for a time zone instead of guessing, and can all-day, change and delete', async () => {
    const { fake, ann } = await setup(
      [
        toolStep('create_calendar_event', { title: 'Call', date: '2026-11-18', startTime: '10:00' }, 'c1'),
        toolStep('create_calendar_event', { title: 'Holiday', date: '2026-11-23', endDate: '2026-11-25' }, 'c2'),
        textStep('ok'),
      ],
      true,
    )
    const body = await chatAllowingAll(ann, chat('x'))
    expect(body).toContain('needs a time zone')
    const holiday = fake.eventsOf('ann@gmail.test').find((e) => e.summary === 'Holiday')!
    expect(holiday).toMatchObject({ start: { date: '2026-11-23' }, end: { date: '2026-11-26' } }) // the last day is included
    expect(fake.eventsOf('ann@gmail.test').some((e) => e.summary === 'Call')).toBe(false)
  }, 60_000)

  it('changes an event, then deletes it', async () => {
    let id = ''
    const { fake, ann } = await setup((f) => {
      id = f.seed('ann@gmail.test', { summary: 'Holiday', start: { date: '2026-11-23' }, end: { date: '2026-11-24' } }).id
      return [
        toolStep('update_calendar_event', { event: id, title: 'Time off', date: '2026-11-24' }, 'c1'),
        toolStep('delete_calendar_event', { event: id }, 'c2'),
        textStep('ok'),
      ]
    }, true)
    // the first tool call renames and moves it, the second removes it
    const body = await chatAllowingAll(ann, chat('move my holiday, then cancel it'))
    expect(body).toContain('ok')
    expect(fake.eventsOf('ann@gmail.test').some((e) => e.id === id)).toBe(false)
    expect(fake.log).toEqual(expect.arrayContaining(['patch', 'delete']))
  }, 30_000)

  it('reports a Google problem to the model instead of crashing the chat', async () => {
    const { ann } = await setup([toolStep('update_calendar_event', { event: 'does-not-exist', title: 'X' }), textStep('Could not find it.')], true)
    const body = await chatAllowingAll(ann, chat('rename it'))
    expect(body).toContain('Could not find it.')
  }, 30_000)

  it('when the calendar is not connected it says so and offers no calendar tools', async () => {
    const { prompts, ann } = await setup([toolStep('list_calendar_events', { from: '2026-11-16' }), textStep('You need to connect it.')], false)
    const body = await (await ann.post('/assistant/chat', chat('what is on my calendar?'))).text()
    expect(JSON.stringify(prompts[0])).toContain('Google Calendar is not connected')
    expect(body).not.toContain('Looked up')
  }, 30_000)

  it('the connected model is told the calendar is available', async () => {
    const { prompts, ann } = await setup([textStep('hi')], true)
    await (await ann.post('/assistant/chat', chat('hello'))).text()
    expect(JSON.stringify(prompts[0])).toContain('Google Calendar is connected')
  }, 30_000)
})

describe('Google Calendar: connecting safely', () => {
  let t: TestApp
  let ann: Api
  let mallory: Api
  beforeAll(async () => {
    t = await appWith(createFakeGoogle())
    ann = api(t, (await approvedMember(t, 'ann')).cookie)
    mallory = api(t, (await approvedMember(t, 'mallory')).cookie)
  }, 60_000)

  const connected = async (a: Api) => (await (await a.get('/integrations/google')).json()).connected

  it("someone else's connect link cannot attach your Google account to their timedesk account", async () => {
    // mallory starts the flow and sends the link to ann, who is signed in to timedesk in her browser
    const back = await startConnect(mallory, 'ann')
    const res = await ann.get(back)
    expect(res.headers.get('location')).toContain('google=error')
    expect(await connected(mallory)).toBe(false)
    expect(await connected(ann)).toBe(false)
  })

  it('the browser flow needs the login of the person who started it', async () => {
    const back = await startConnect(ann, 'ann')
    expect((await t.app.request('/v1' + back)).headers.get('location')).toContain('google=error')
    expect(await connected(ann)).toBe(false)
  })

  it('a state works only once', async () => {
    const back = await startConnect(ann, 'ann')
    expect((await ann.get(back)).headers.get('location')).toContain('google=connected')
    await ann.del('/integrations/google')
    expect((await ann.get(back)).headers.get('location')).toContain('google=error')
    expect(await connected(ann)).toBe(false)
  })

  it('the desktop flow works without a login in the browser, but not with somebody else signed in there', async () => {
    const theirs = await startConnect(mallory, 'ann', { desktop: true })
    expect((await ann.get(theirs)).status).toBe(400)
    expect(await connected(mallory)).toBe(false)

    expect((await connect(t, mallory, 'mallory', { desktop: true })).status).toBe(200)
    expect(await connected(mallory)).toBe(true)
  })
})

describe('Google Calendar: when Google misbehaves', () => {
  const range = '?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z'
  const failing = async (error: Error) => {
    const fake = createFakeGoogle()
    const t = await appWith({ client: { ...fake.client, listEvents: async () => { throw error } } })
    const a = api(t, (await approvedMember(t, 'gil')).cookie)
    await connect(t, a, 'gil')
    return a.get('/calendar/events' + range)
  }

  it.each([
    [new GoogleApiError(400, 'bad'), 422],
    [new GoogleApiError(403, 'quota'), 503],
    [new GoogleApiError(429, 'slow down'), 503],
    [new GoogleApiError(500, 'boom'), 502],
    [new GoogleUnreachableError(false), 502],
    [new GoogleUnreachableError(true), 504],
  ])('%s becomes a clear %i', async (error, status) => {
    const res = await failing(error)
    expect(res.status).toBe(status)
    expect((await res.json()).error).toMatch(/Google Calendar/)
  }, 60_000)

  it('refuses an unknown time zone for an event', async () => {
    const fake = createFakeGoogle()
    const t = await appWith(fake)
    const a = api(t, (await approvedMember(t, 'hal')).cookie)
    await connect(t, a, 'hal')
    expect((await a.post('/calendar/events', { title: 'Call', start: '2026-11-20T10:00:00', timeZone: 'Mars/Olympus' })).status).toBe(422)
    expect((await a.post('/calendar/events', { title: 'Call', start: '2026-11-20T10:00:00', timeZone: 'Europe/London' })).status).toBe(201)
  }, 60_000)

  it('one task Google refuses does not stop the others, and a big backlog goes a batch at a time', async () => {
    const fake = createFakeGoogle()
    const picky: GoogleClient = {
      ...fake.client,
      insertEvent: async (token, cal, input) => {
        if (input.summary === 'Refused') throw new GoogleApiError(400, 'no')
        return fake.client.insertEvent(token, cal, input)
      },
    }
    const t = await appWith({ client: picky })
    const a = api(t, (await approvedMember(t, 'ida')).cookie)
    await connect(t, a, 'ida')
    await a.patch('/integrations/google', { pushTasks: false })
    await a.post('/tasks', { title: 'Refused', due: '2026-11-01' })
    for (let i = 0; i < 30; i++) await a.post('/tasks', { title: `Task ${i}`, due: '2026-11-02' })
    await a.patch('/integrations/google', { pushTasks: true }) // mirrors the first batch

    const first = await (await a.post('/calendar/sync')).json()
    expect(first.remaining).toBeGreaterThanOrEqual(1) // the refused one stays waiting
    const mirrored = fake.eventsOf('ida@gmail.test').filter((e) => e.summary?.startsWith('Task '))
    expect(mirrored).toHaveLength(30)
  }, 120_000)

  it('a sync cut off by Google does not skip the changes it did not read', async () => {
    const fake = createFakeGoogle()
    const cutOff: GoogleClient = {
      ...fake.client,
      listEvents: async (token, cal, q) => {
        const list = await fake.client.listEvents(token, cal, q)
        return q.updatedMin ? Object.assign([...list], { more: true }) : list
      },
    }
    const t = await appWith({ client: cutOff })
    const a = api(t, (await approvedMember(t, 'jan')).cookie)
    await connect(t, a, 'jan')
    await a.post('/tasks', { title: 'Mirrored', due: '2026-11-10' })
    const before = Date.now()
    expect((await a.post('/calendar/sync')).status).toBe(200)
    const { lastSyncAt } = await (await a.get('/integrations/google')).json()
    // only as far as the last change read (the task's event), not "now"
    expect(Date.parse(lastSyncAt)).toBeLessThanOrEqual(before)
  }, 60_000)

  it('a task save does not wait long for a slow Google', async () => {
    const fake = createFakeGoogle()
    const slow: GoogleClient = { ...fake.client, insertEvent: () => new Promise(() => {}) } // never answers
    const t = await appWith({ client: slow })
    const a = api(t, (await approvedMember(t, 'kim')).cookie)
    await connect(t, a, 'kim')
    const started = Date.now()
    expect((await a.post('/tasks', { title: 'Saved anyway', due: '2026-11-10' })).status).toBe(201)
    expect(Date.now() - started).toBeLessThan(8_000)
  }, 60_000)
})
