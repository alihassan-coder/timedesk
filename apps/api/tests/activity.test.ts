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
