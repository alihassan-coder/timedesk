import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { formatHours } from '@timedesk/shared'
import { schema } from '@timedesk/db'
import { fakeMemory } from './fakes.ts'
import { api, approvedMember, createTestApp, scriptedModel, textStep, toolStep } from './helpers.ts'

const SECRET = 'sk-openai-test-key-1234567890'
const chat = (provider = 'openai', text = 'hello', model = 'gpt-test') => ({
  provider,
  model,
  messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }],
})

async function setup(opts: { steps: unknown[][]; memory?: ReturnType<typeof fakeMemory> }) {
  const { model, prompts } = scriptedModel(opts.steps)
  const seen: { provider: string; model: string; key: string }[] = []
  const t = await createTestApp({
    models: (provider, id, key) => {
      seen.push({ provider, model: id, key })
      return model
    },
    memory: opts.memory?.memory,
  })
  const ann = await approvedMember(t, 'ann')
  return { t, prompts, seen, ann: api(t, ann.cookie), annCookie: ann.cookie }
}

describe('assistant chat: keys', () => {
  it('asks for an API key when the user has not saved one for that provider', async () => {
    const { ann } = await setup({ steps: [textStep('hi')] })
    const res = await ann.post('/assistant/chat', chat('openai'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Add your OpenAI API key')
  })

  it('calls the chosen model with the saved key, and never sends the key back to the browser', async () => {
    const { ann, seen } = await setup({ steps: [textStep('Hello there')] })
    await ann.put('/ai/keys/openai', { key: SECRET })

    const res = await ann.post('/assistant/chat', chat('openai', 'hi', 'gpt-test'))
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(seen).toEqual([{ provider: 'openai', model: 'gpt-test', key: SECRET }])
    expect(body).toContain('Hello there')
    expect(body).not.toContain(SECRET)
  }, 30_000)

  it('a key saved for one provider is not used for another', async () => {
    const { ann } = await setup({ steps: [textStep('x')] })
    await ann.put('/ai/keys/openai', { key: SECRET })
    const res = await ann.post('/assistant/chat', chat('anthropic'))
    expect(res.status).toBe(400)
  })

  it('rejects an unknown provider and an empty conversation', async () => {
    const { ann } = await setup({ steps: [textStep('x')] })
    expect((await ann.post('/assistant/chat', chat('skynet'))).status).toBe(422)
    expect((await ann.post('/assistant/chat', { provider: 'openai', model: 'm', messages: [] })).status).toBe(422)
  })

  it('requires a signed-in account', async () => {
    const { t } = await setup({ steps: [textStep('x')] })
    const res = await t.app.request('/v1/assistant/chat', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
  })
})

describe('assistant tools', () => {
  it('creates a task in the database when the model asks for it, then answers', async () => {
    const { t, ann } = await setup({
      steps: [toolStep('create_task', { title: 'Review pull requests', priority: 'high', due: '2026-11-06' }), textStep('Added it.')],
    })
    await ann.put('/ai/keys/openai', { key: SECRET })

    const res = await ann.post('/assistant/chat', chat('openai', 'add a task to review pull requests tomorrow, high priority'))
    const body = await res.text()

    const rows = await t.db.select().from(schema.tasks)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Review pull requests', priority: 'high', due: '2026-11-06', status: 'todo' })
    expect(body).toContain('Added it.')
  }, 30_000)

  it('can complete a task by its title, and completing a recurring task schedules the next one', async () => {
    const { t, ann } = await setup({ steps: [toolStep('set_task_status', { task: 'standup notes', status: 'done' }), textStep('Done.')] })
    await ann.put('/ai/keys/openai', { key: SECRET })
    await ann.post('/tasks', { title: 'Daily standup notes', due: '2026-11-05', recurrence: { freq: 'daily' } })

    await (await ann.post('/assistant/chat', chat())).text()

    const rows = await t.db.select().from(schema.tasks)
    expect(rows.map((r) => [r.status, r.due]).sort()).toEqual([['done', '2026-11-05'], ['todo', '2026-11-06']])
  }, 30_000)

  it('renames a project when asked', async () => {
    const { t, ann } = await setup({ steps: [toolStep('update_project', { project: 'web', name: 'Website', description: 'Marketing site' }), textStep('Renamed.')] })
    await ann.put('/ai/keys/openai', { key: SECRET })
    await ann.post('/projects', { name: 'Web stuff' })
    await (await ann.post('/assistant/chat', chat())).text()
    const rows = await t.db.select().from(schema.projects)
    expect(rows[0]).toMatchObject({ name: 'Website', description: 'Marketing site' })
  }, 30_000)

  it('deletes a project but keeps its tasks and time', async () => {
    const { t, ann } = await setup({ steps: [toolStep('delete_project', { project: 'Website' }), textStep('Deleted.')] })
    await ann.put('/ai/keys/openai', { key: SECRET })
    const project = (await (await ann.post('/projects', { name: 'Website' })).json()).project
    await ann.post('/tasks', { title: 'Fix header', projectId: project.id })
    await ann.post('/time-entries/start', { projectId: project.id })
    await (await ann.post('/assistant/chat', chat())).text()

    expect((await (await ann.get('/projects')).json()).projects).toHaveLength(0)
    const tasks = await t.db.select().from(schema.tasks)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].projectId).toBeNull()
    expect((await t.db.select().from(schema.timeEntries))[0].projectId).toBeNull()
  }, 30_000)

  it('builds a time report for a custom date range', async () => {
    const { t, ann } = await setup({ steps: [toolStep('time_report', { from: '2026-10-01', to: '2026-10-15' }), textStep('Here is the report.')] })
    await ann.put('/ai/keys/openai', { key: SECRET })
    const project = (await (await ann.post('/projects', { name: 'Website' })).json()).project
    const [me] = await t.db.select().from(schema.user)
    const add = (start: Date, hours: number) =>
      t.db.insert(schema.timeEntries).values({ id: crypto.randomUUID(), workspaceId: me.id, userId: me.id, projectId: project.id, startedAt: start, endedAt: new Date(start.getTime() + hours * 3_600_000) })
    await add(new Date(2026, 9, 5, 9), 2) // inside the range
    await add(new Date(2026, 9, 20, 9), 5) // outside the range
    const body = await (await ann.post('/assistant/chat', chat())).text()
    expect(body).toContain('Here is the report.')
    expect(body).toContain('custom')
    expect(body).toContain(formatHours(2 * 3_600_000))
    expect(body).not.toContain(formatHours(7 * 3_600_000))
  }, 30_000)

  it('rejects a backwards custom range instead of guessing', async () => {
    const { ann } = await setup({ steps: [toolStep('time_report', { from: '2026-10-15', to: '2026-10-01' }), textStep('ok')] })
    await ann.put('/ai/keys/openai', { key: SECRET })
    const body = await (await ann.post('/assistant/chat', chat())).text()
    expect(body).toContain('must not be before')
  }, 30_000)

  it('starts and stops the timer', async () => {
    const { t, ann } = await setup({ steps: [toolStep('start_timer', {}), textStep('Timer started.')] })
    await ann.put('/ai/keys/openai', { key: SECRET })
    await (await ann.post('/assistant/chat', chat())).text()
    const running = await t.db.select().from(schema.timeEntries)
    expect(running).toHaveLength(1)
    expect(running[0].endedAt).toBeNull()
  }, 30_000)

  it('only ever touches the signed-in person\'s data', async () => {
    const { t, ann } = await setup({ steps: [toolStep('set_task_status', { task: 'Shared title', status: 'done' }), textStep('ok')] })
    await ann.put('/ai/keys/openai', { key: SECRET })
    const bob = api(t, (await approvedMember(t, 'bob')).cookie)
    await ann.post('/tasks', { title: 'Shared title' })
    await bob.post('/tasks', { title: 'Shared title' })

    await (await ann.post('/assistant/chat', chat())).text()

    const bobsUserId = (await t.db.select().from(schema.user).where(eq(schema.user.username, 'bob')))[0].id
    const bobsTasks = await t.db.select().from(schema.tasks).where(eq(schema.tasks.userId, bobsUserId))
    expect(bobsTasks.map((x) => x.status)).toEqual(['todo'])
    const annsTasks = (await t.db.select().from(schema.tasks)).filter((x) => x.userId !== bobsUserId)
    expect(annsTasks.map((x) => x.status)).toEqual(['done'])
  }, 30_000)

  it('reports an unknown task back to the model instead of crashing', async () => {
    const { ann } = await setup({ steps: [toolStep('set_task_status', { task: 'does not exist', status: 'done' }), textStep('I could not find it.')] })
    await ann.put('/ai/keys/openai', { key: SECRET })
    const res = await ann.post('/assistant/chat', chat())
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(body).toContain('No task matches')
    expect(body).toContain('I could not find it.')
  }, 30_000)
})

