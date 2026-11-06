import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { schema } from '@timedesk/db'
import { addDays, startOfWeek, zonedDateKey, zonedDayStart } from '@timedesk/shared'
import { api, approvedMember, createTestApp, scriptedModel, textStep, toolStep } from './helpers.ts'

/**
 * Tempo's daily summary, weekly review and "plan my day". The model is scripted to call the tool; the tests check
 * the facts the tool hands back to the model, which is where the numbers come from.
 */

const H = 3_600_000
const KEY = 'sk-openai-test-key-1234567890'

async function setup(steps: unknown[][]) {
  const { model, prompts } = scriptedModel(steps)
  const t = await createTestApp({ models: () => model })
  const { cookie } = await approvedMember(t, 'tara')
  const me = api(t, cookie)
  await me.put('/ai/keys/openai', { key: KEY })
  const [{ id: userId }] = await t.db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.username, 'tara'))
  return { t, me, prompts, userId }
}

const ask = (text: string, timeZone?: string) => ({
  provider: 'openai',
  model: 'gpt-test',
  ...(timeZone ? { timeZone } : {}),
  messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }],
})

/** What the tool returned, as the model saw it in its next prompt. */
function toolResult(prompts: unknown[]): Record<string, unknown> {
  const second = prompts[1] as { role: string; content: { type: string; output?: { type: string; value: unknown } }[] }[]
  const tool = second.find((m) => m.role === 'tool')
  const part = tool?.content.find((c) => c.type === 'tool-result')
  if (!part?.output) throw new Error('the tool result did not reach the model: ' + JSON.stringify(second).slice(0, 400))
  return part.output.value as Record<string, unknown>
}

async function entry(t: Awaited<ReturnType<typeof setup>>['t'], userId: string, projectId: string | null, start: number, hours: number) {
  await t.db.insert(schema.timeEntries).values({ id: crypto.randomUUID(), userId, workspaceId: userId, projectId, startedAt: new Date(start), endedAt: new Date(start + hours * H) })
}

describe('daily summary', () => {
  it('gives the model exact numbers for the day: time by project, the day before, finished and due tasks, goal, top apps', async () => {
    const { t, me, prompts, userId } = await setup([toolStep('daily_summary', {}), textStep('Here is your day.')])
    const today = zonedDateKey(Date.now(), 'UTC')
    const midnight = zonedDayStart(today, 'UTC')
    const { project } = await (await me.post('/projects', { name: 'Website' })).json()
    await entry(t, userId, project.id, midnight + 1 * H, 2)
    await entry(t, userId, null, midnight + 4 * H, 0.5)
    await entry(t, userId, project.id, midnight - 5 * H, 1) // yesterday
    const { task } = await (await me.post('/tasks', { title: 'Send invoice' })).json()
    await me.patch(`/tasks/${task.id}`, { status: 'done' })
    await me.post('/tasks', { title: 'Call the bank', due: today })
    await me.post('/tasks', { title: 'Renew domain', due: addDays(today, -3) })
    await me.post('/tasks', { title: 'Pack for trip', due: addDays(today, 1) })
    await me.patch('/settings', { timer: { dailyGoalMinutes: 120 } })
    await me.post('/activity', { samples: [{ id: 'sample-0001', app: 'Code', title: 'secret-plans.txt', startedAt: new Date(midnight + 1 * H).toISOString(), seconds: 1800 }] })

    const body = await (await me.post('/assistant/chat', ask('Summarize my day', 'UTC'))).text()
    const r = toolResult(prompts)

    expect(r).toMatchObject({
      date: today,
      isToday: true,
      tracked: '2h 30m',
      dayBefore: '1h 00m',
      byProject: [
        { project: 'Website', time: '2h 00m' },
        { project: 'No project', time: '30m' },
      ],
      timerSessions: 2,
      dailyGoal: { goal: '2h 00m', reached: true },
      finished: ['Send invoice'],
      stillDueToday: ['Call the bank'],
      overdue: ['Renew domain'],
      dueTomorrow: ['Pack for trip'],
      topApps: [{ app: 'Code', time: '30m' }],
      timerRunning: null,
    })
    // Window titles never go to the AI provider.
    expect(JSON.stringify(prompts)).not.toContain('secret-plans.txt')
    expect(body).toContain('Here is your day.')
  }, 30_000)
})

describe('the user\'s own time zone', () => {
  it('tells the model the date where the user is, not where the server is', async () => {
    const { me, prompts } = await setup([textStep('ok')])
    await (await me.post('/assistant/chat', ask('hi', 'Pacific/Kiritimati'))).text()
    const system = JSON.stringify(prompts[0])
    expect(system).toContain('Pacific/Kiritimati')
    expect(system).toContain(`Today is ${zonedDateKey(Date.now(), 'Pacific/Kiritimati')}`)
  }, 30_000)

  it('refuses a time zone it does not know', async () => {
    const { me } = await setup([textStep('ok')])
    expect((await me.post('/assistant/chat', ask('hi', 'Mars/Olympus'))).status).toBe(422)
  })
})

describe('plan my day', () => {
  it('hands the model the tasks in the order they need attention, with the reason and the goal left', async () => {
    const { t, me, prompts, userId } = await setup([toolStep('plan_day', {}), textStep('Plan ready.')])
    const today = zonedDateKey(Date.now(), 'UTC')
    await me.post('/tasks', { title: 'Someday idea', priority: 'low' })
    await me.post('/tasks', { title: 'Ship hotfix', priority: 'high' })
    await me.post('/tasks', { title: 'Tax form', due: addDays(today, -2) })
    await me.post('/tasks', { title: 'Standup notes', due: today })
    await me.post('/tasks', { title: 'Done already', due: addDays(today, -5), status: 'done' })
    await me.patch('/settings', { timer: { dailyGoalMinutes: 240 } })
    await entry(t, userId, null, zonedDayStart(today, 'UTC'), 1)

    await (await me.post('/assistant/chat', ask('Plan my day', 'UTC'))).text()
    const r = toolResult(prompts) as { tasks: { title: string; why: string }[] } & Record<string, unknown>

    expect(r.tasks.map((x) => x.title)).toEqual(['Tax form', 'Standup notes', 'Ship hotfix', 'Someday idea'])
    expect(r.tasks[0].why).toBe(`overdue since ${addDays(today, -2)}`)
    expect(r).toMatchObject({ date: today, timeZone: 'UTC', trackedSoFar: '1h 00m', dailyGoal: '4h 00m', leftForGoal: '3h 00m', calendar: 'Google Calendar is not connected' })
    expect(String(r.currentTime)).toMatch(/^\d{2}:00/)
  }, 30_000)
})

describe('weekly review', () => {
  it('compares the week with the one before and brings in the reflection and last week\'s plan', async () => {
    const { t, me, prompts, userId } = await setup([toolStep('weekly_review', {}), textStep('Your week.')])
    const monday = startOfWeek(zonedDateKey(Date.now(), 'UTC'))
    const start = zonedDayStart(monday, 'UTC')
    await entry(t, userId, null, start + 9 * H, 3) // Monday
    await entry(t, userId, null, start + 24 * H + 9 * H, 1) // Tuesday
    await entry(t, userId, null, start - 6 * 24 * H, 2) // last week
    await me.put(`/reviews/${monday}`, { wentWell: 'Deep work mornings', improve: 'Plan Fridays' })
    await me.put(`/reviews/${addDays(monday, -7)}`, { wentWell: '', improve: 'Fewer meetings' })
    await me.patch('/settings', { timer: { dailyGoalMinutes: 120 } })

    await (await me.post('/assistant/chat', ask('Weekly review', 'UTC'))).text()
    const r = toolResult(prompts)

    expect(r).toMatchObject({
      week: { from: monday, to: addDays(monday, 6), isThisWeek: true },
      tracked: '4h 00m',
      weekBefore: '2h 00m',
      changePercent: 100,
      bestDay: { date: monday, time: '3h 00m' },
      daysGoalMet: 1,
      reflection: { wentWell: 'Deep work mornings', willChange: 'Plan Fridays' },
      planFromWeekBefore: 'Fewer meetings',
    })
    expect((r.byDay as unknown[]).length).toBe(7)
  }, 30_000)
})
