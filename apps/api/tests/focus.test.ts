import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { schema } from '@timedesk/db'
import { zonedDateKey, zonedDayStart } from '@timedesk/shared'
import { api, approvedMember, createTestApp, scriptedModel, textStep, toolStep, WEB_ORIGIN, type TestApp } from './helpers.ts'

const H = 3_600_000

const session = (id: string, startedAt: string, minutes: number, extra: Record<string, unknown> = {}) => ({
  id,
  startedAt,
  endedAt: new Date(Date.parse(startedAt) + minutes * 60_000).toISOString(),
  label: 'Write docs',
  focusedSeconds: 1500,
  distractedSeconds: 300,
  awaySeconds: 0,
  interruptions: 2,
  distractions: [
    { name: 'YouTube', seconds: 240 },
    { name: 'Discord', seconds: 60 },
  ],
  ...extra,
})

describe('focus sessions', () => {
  let t: TestApp
  let ann: ReturnType<typeof api>
  let bob: ReturnType<typeof api>

  beforeAll(async () => {
    t = await createTestApp()
    ann = api(t, (await approvedMember(t, 'ann')).cookie)
    bob = api(t, (await approvedMember(t, 'bob')).cookie)
  })

  it('stores uploaded sessions and lists them newest first', async () => {
    const res = await ann.post('/focus/sessions', {
      sessions: [session('focus-00000001', '2026-11-05T09:00:00Z', 30), session('focus-00000002', '2026-11-05T14:00:00Z', 30, { distractions: [] })],
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ received: 2, stored: 2 })
    const { sessions } = await (await ann.get('/focus/sessions')).json()
    expect(sessions.map((s: { id: string }) => s.id)).toEqual(['focus-00000002', 'focus-00000001'])
    expect(sessions[1]).toMatchObject({ label: 'Write docs', focusedSeconds: 1500, interruptions: 2, distractions: [{ name: 'YouTube', seconds: 240 }, { name: 'Discord', seconds: 60 }] })
  })

  it('a retried upload does not store the same session twice', async () => {
    const batch = { sessions: [session('focus-retry-0001', '2026-11-04T09:00:00Z', 30)] }
    expect(await (await ann.post('/focus/sessions', batch)).json()).toEqual({ received: 1, stored: 1 })
    expect(await (await ann.post('/focus/sessions', batch)).json()).toEqual({ received: 1, stored: 0 })
  })

  it('sums a range into a score and the top distractions', async () => {
    const from = encodeURIComponent('2026-11-05T00:00:00Z')
    const to = encodeURIComponent('2026-11-06T00:00:00Z')
    const summary = await (await ann.get(`/focus/summary?from=${from}&to=${to}`)).json()
    expect(summary).toEqual({
      sessions: 2,
      focusedSeconds: 3000,
      distractedSeconds: 600,
      awaySeconds: 0,
      interruptions: 4,
      score: 83,
      topDistractions: [
        { name: 'YouTube', seconds: 240 },
        { name: 'Discord', seconds: 60 },
      ],
    })
  })

  it('is private: nobody else sees your sessions', async () => {
    expect((await (await bob.get('/focus/sessions')).json()).sessions).toEqual([])
    expect((await (await bob.get('/focus/summary')).json()).score).toBeNull()
  })

  it('rejects bad sessions', async () => {
    const bad = (extra: Record<string, unknown>) => ann.post('/focus/sessions', { sessions: [session('focus-bad-000001', '2026-11-05T10:00:00Z', 30, extra)] })
    expect((await bad({ focusedSeconds: -5 })).status).toBe(422)
    expect((await bad({ endedAt: '2026-11-05T09:00:00Z' })).status).toBe(422) // ends before it starts
    expect((await bad({ endedAt: '2026-11-15T09:00:00Z' })).status).toBe(422) // longer than a week
    expect((await bad({ distractions: Array.from({ length: 11 }, (_, i) => ({ name: `a${i}`, seconds: 1 })) })).status).toBe(422)
    expect((await bad({ id: 'short' })).status).toBe(422)
    expect((await ann.post('/focus/sessions', { sessions: [] })).status).toBe(422)
  })

  it('needs a signed-in account', async () => {
    const anon = api(t, '')
    expect((await anon.get('/focus/summary')).status).toBe(401)
    expect((await anon.post('/focus/sessions', { sessions: [session('focus-anon-00001', '2026-11-05T10:00:00Z', 30)] })).status).toBe(401)
  })

  it('is in the data export, and can be cleared', async () => {
    const data = await (await ann.get('/account/export')).json()
    expect(data.focusSessions).toHaveLength(3)
    expect(data.focusSessions[0]).not.toHaveProperty('userId')
    expect(await (await ann.del('/focus/sessions')).json()).toEqual({ deleted: 3 })
    expect((await (await ann.get('/focus/sessions')).json()).sessions).toEqual([])
  })
})

describe('Tempo and focus', () => {
  const ask = (text: string) => ({ provider: 'openai', model: 'gpt-test', timeZone: 'UTC', messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }] })
  const toolResult = (prompts: unknown[], call = 1) => {
    const second = prompts[call] as { role: string; content: { type: string; output?: { value: unknown } }[] }[]
    return second.find((m) => m.role === 'tool')?.content.find((c) => c.type === 'tool-result')?.output?.value as Record<string, unknown>
  }

  it('the daily summary and weekly review include the focus score and top distractions', async () => {
    const { model, prompts } = scriptedModel([toolStep('daily_summary', {}), textStep('Your day.'), toolStep('weekly_review', {}), textStep('Your week.')])
    const t = await createTestApp({ models: () => model })
    const me = api(t, (await approvedMember(t, 'fay')).cookie)
    await me.put('/ai/keys/openai', { key: 'sk-openai-test-key-1234567890' })
    const midnight = zonedDayStart(zonedDateKey(Date.now(), 'UTC'), 'UTC')
    await me.post('/focus/sessions', { sessions: [session('focus-today-0001', new Date(midnight + 1 * H).toISOString(), 30)] })

    await (await me.post('/assistant/chat', ask('Summarize my day'))).text()
    expect(toolResult(prompts).focus).toEqual({
      sessions: 1,
      scorePercent: 83,
      focused: '25m',
      distracted: '5m',
      interruptions: 2,
      topDistractions: [
        { name: 'YouTube', time: '4m' },
        { name: 'Discord', time: '1m' },
      ],
    })

    await (await me.post('/assistant/chat', ask('Weekly review'))).text()
    expect(toolResult(prompts, 3).focus).toMatchObject({ sessions: 1, scorePercent: 83 })
  })

  it('says nothing about focus when no session ran', async () => {
    const { model, prompts } = scriptedModel([toolStep('daily_summary', {}), textStep('Your day.')])
    const t = await createTestApp({ models: () => model })
    const me = api(t, (await approvedMember(t, 'gus')).cookie)
    await me.put('/ai/keys/openai', { key: 'sk-openai-test-key-1234567890' })
    await (await me.post('/assistant/chat', ask('Summarize my day'))).text()
    expect(toolResult(prompts).focus).toBeNull()
  })

  it('deleting the account deletes its focus sessions', async () => {
    const t = await createTestApp()
    const { cookie, account } = await approvedMember(t, 'hal')
    const me = api(t, cookie)
    await me.post('/focus/sessions', { sessions: [session('focus-gone-00001', '2026-11-05T09:00:00Z', 30)] })
    const res = await t.app.request('/v1/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN, Cookie: cookie },
      body: JSON.stringify({ password: account.password }),
    })
    expect(res.status).toBe(204)
    expect(await t.db.select().from(schema.focusSessions).where(eq(schema.focusSessions.id, 'focus-gone-00001'))).toEqual([])
  })
})
