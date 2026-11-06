import { beforeAll, describe, expect, it } from 'vitest'
import { api, approvedMember, createTestApp, type TestApp } from './helpers.ts'

let t: TestApp
let ann: ReturnType<typeof api>
let bob: ReturnType<typeof api>

beforeAll(async () => {
  t = await createTestApp()
  ann = api(t, (await approvedMember(t, 'ann')).cookie)
  bob = api(t, (await approvedMember(t, 'bob')).cookie)
})

const sample = (id: string, app: string, seconds: number, at: string, title = '') => ({ id, app, title, seconds, startedAt: at })

describe('desktop activity tracking', () => {
  it('stores uploaded samples and totals them per app, biggest first', async () => {
    const res = await ann.post('/activity', {
      samples: [
        sample('sample-00000001', 'VS Code', 600, '2026-11-05T09:00:00Z', 'api.ts'),
        sample('sample-00000002', 'Chrome', 120, '2026-11-05T09:10:00Z', 'Docs'),
        sample('sample-00000003', 'VS Code', 300, '2026-11-05T09:12:00Z', 'tests.ts'),
      ],
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ received: 3, stored: 3 })

    const summary = await (await ann.get('/activity/summary')).json()
    expect(summary.totalSeconds).toBe(1020)
    expect(summary.byApp).toEqual([
      { app: 'VS Code', seconds: 900 },
      { app: 'Chrome', seconds: 120 },
    ])
    expect(summary.recent[0]).toMatchObject({ app: 'VS Code', title: 'tests.ts' })
  })

  it('a retried upload does not count the same samples twice', async () => {
    const batch = { samples: [sample('sample-retry-0001', 'Slack', 60, '2026-11-05T10:00:00Z')] }
    expect(await (await ann.post('/activity', batch)).json()).toEqual({ received: 1, stored: 1 })
    expect(await (await ann.post('/activity', batch)).json()).toEqual({ received: 1, stored: 0 })

    const slack = (await (await ann.get('/activity/summary')).json()).byApp.find((r: { app: string }) => r.app === 'Slack')
    expect(slack.seconds).toBe(60)
  })

  it('limits the summary to a date range', async () => {
    const from = encodeURIComponent('2026-11-05T09:30:00Z')
    const summary = await (await ann.get('/activity/summary?from=' + from)).json()
    expect(summary.byApp.map((r: { app: string }) => r.app)).toEqual(['Slack'])
  })

  it('keeps window titles private: nobody else sees them', async () => {
    const theirs = await (await bob.get('/activity/summary')).json()
    expect(theirs).toEqual({ totalSeconds: 0, byApp: [], recent: [] })
  })

  it('rejects bad samples: no seconds, absurd length, empty app, empty batch', async () => {
    expect((await ann.post('/activity', { samples: [sample('sample-bad-00001', 'X', 0, '2026-11-05T10:00:00Z')] })).status).toBe(422)
    expect((await ann.post('/activity', { samples: [sample('sample-bad-00002', 'X', 99999, '2026-11-05T10:00:00Z')] })).status).toBe(422)
    expect((await ann.post('/activity', { samples: [sample('sample-bad-00003', ' ', 5, '2026-11-05T10:00:00Z')] })).status).toBe(422)
    expect((await ann.post('/activity', { samples: [] })).status).toBe(422)
  })

  it('lets you erase everything that was recorded about you, and only you', async () => {
    await bob.post('/activity', { samples: [sample('sample-bobs-0001', 'Figma', 90, '2026-11-05T11:00:00Z')] })

    const cleared = await (await ann.del('/activity')).json()
    expect(cleared.deleted).toBeGreaterThan(0)

    expect((await (await ann.get('/activity/summary')).json()).totalSeconds).toBe(0)
    expect((await (await bob.get('/activity/summary')).json()).totalSeconds).toBe(90)
  })

  it('needs a signed-in account', async () => {
    expect((await t.app.request('/v1/activity/summary')).status).toBe(401)
  })
})

describe('notification and desktop settings', () => {
  it('are stored with the other preferences', async () => {
    await ann.patch('/settings', { notifications: { dueReminders: true }, desktop: { autoStart: true, trackApps: false } })
    const { data } = await (await ann.get('/settings')).json()
    expect(data.notifications).toEqual({ dueReminders: true })
    expect(data.desktop).toEqual({ autoStart: true, trackApps: false })
  })
})

describe('browsing recorded sessions', () => {
  let cy: ReturnType<typeof api>
  beforeAll(async () => {
    cy = api(t, (await approvedMember(t, 'cyrus')).cookie)
    const samples = Array.from({ length: 25 }, (_, i) =>
      sample(`sample-page-${String(i).padStart(4, '0')}`, i % 5 === 0 ? 'Figma' : 'Code', 60 + i, `2026-11-0${(i % 4) + 1}T0${i % 10}:00:00Z`, i === 7 ? 'Quarterly 100%_plan' : 'work'),
    )
    await cy.post('/activity', { samples })
  }, 30_000)

  it('returns pages with a total, newest first, and never repeats a row', async () => {
    const one = await (await cy.get('/activity/sessions?pageSize=10&page=1')).json()
    expect(one).toMatchObject({ total: 25, page: 1, pageSize: 10, pages: 3 })
    expect(one.items).toHaveLength(10)
    const three = await (await cy.get('/activity/sessions?pageSize=10&page=3')).json()
    expect(three.items).toHaveLength(5)
    const two = await (await cy.get('/activity/sessions?pageSize=10&page=2')).json()
    const ids = [...one.items, ...two.items, ...three.items].map((r: { id: string }) => r.id)
    expect(new Set(ids).size).toBe(25)
    const times = one.items.map((r: { startedAt: string }) => r.startedAt)
    expect([...times].sort().reverse()).toEqual(times)
  })

  it('filters by app and searches app and window titles, treating % and _ literally', async () => {
    expect((await (await cy.get('/activity/sessions?app=Figma')).json()).total).toBe(5)
    expect((await (await cy.get('/activity/sessions?q=quarterly')).json()).total).toBe(1)
    expect((await (await cy.get('/activity/sessions?q=' + encodeURIComponent('100%_'))).json()).total).toBe(1)
    expect((await (await cy.get('/activity/sessions?q=' + encodeURIComponent('%'))).json()).total).toBe(1) // only the literal %
    expect((await (await cy.get('/activity/sessions?q=nothing-matches')).json()).total).toBe(0)
  })

  it('limits sessions to a date range and rejects absurd page sizes', async () => {
    const from = encodeURIComponent('2026-11-02T00:00:00Z')
    const to = encodeURIComponent('2026-11-03T00:00:00Z')
    const day = await (await cy.get(`/activity/sessions?from=${from}&to=${to}`)).json()
    expect(day.total).toBeGreaterThan(0)
    expect(day.total).toBeLessThan(25)
    expect((await cy.get('/activity/sessions?pageSize=500')).status).toBe(422)
    expect((await cy.get('/activity/sessions?page=0')).status).toBe(422)
  })

  it('deletes one session, and only your own', async () => {
    const first = (await (await cy.get('/activity/sessions?pageSize=1')).json()).items[0]
    expect((await ann.del('/activity/' + first.id)).status).toBe(404) // not ann's
    expect((await cy.del('/activity/' + first.id)).status).toBe(204)
    expect((await (await cy.get('/activity/sessions')).json()).total).toBe(24)
    expect((await cy.del('/activity/' + first.id)).status).toBe(404)
  })
})
