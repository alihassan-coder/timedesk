import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'
import { providerErrorMessage } from '../src/services/assistant.service.ts'
import { api, approvedMember, createTestApp, scriptedModel, textStep, toolStep } from './helpers.ts'

/** Tempo asks before it deletes, asks instead of guessing, and explains provider errors. */

const KEY = 'sk-openai-test-key-1234567890'
const ask = (text: string, extra: unknown[] = []) => ({
  provider: 'openai',
  model: 'gpt-test',
  timeZone: 'UTC',
  messages: [...extra, { id: `m${extra.length + 1}`, role: 'user', parts: [{ type: 'text', text }] }],
})

async function setup(steps: unknown[][]) {
  const { model, prompts } = scriptedModel(steps)
  const t = await createTestApp({ models: () => model })
  const me = api(t, (await approvedMember(t, 'tess')).cookie)
  await me.put('/ai/keys/openai', { key: KEY })
  return { me, prompts }
}

/** What the tool returned, as the model saw it in the next step. */
function toolResult(prompts: unknown[], call = 1): Record<string, unknown> {
  const msgs = prompts[call] as { role: string; content: { type: string; output?: { value: unknown } }[] }[]
  const part = msgs.find((m) => m.role === 'tool')?.content.find((c) => c.type === 'tool-result')
  return part?.output?.value as Record<string, unknown>
}

describe('Tempo asks before it deletes', () => {
  it('a delete stops at an approval request naming the real task, and nothing is deleted yet', async () => {
    const { me } = await setup([toolStep('delete_task', { task: 'old draft' }), textStep('Deleted.')])
    await me.post('/tasks', { title: 'Old draft' })
    const body = await (await me.post('/assistant/chat', ask('Delete my old draft'))).text()
    expect(body).toContain('tool-approval-request')
    expect(body).toContain('Delete the task \\"Old draft\\"')
    expect((await (await me.get('/tasks')).json()).tasks.map((t: { title: string }) => t.title)).toContain('Old draft')
  })

  it('creating a calendar event would ask too (when the calendar is connected); reading never asks', async () => {
    const { me } = await setup([toolStep('list_tasks', {}), textStep('Here.')])
    const body = await (await me.post('/assistant/chat', ask('What is on my list?'))).text()
    expect(body).not.toContain('tool-approval-request')
  })
})

describe('Tempo never guesses which task', () => {
  it('several matches: it gets the list back and is told to ask the user', async () => {
    const { me, prompts } = await setup([toolStep('set_task_status', { task: 'report', status: 'done' }), textStep('Which one?')])
    await me.post('/tasks', { title: 'Q3 report' })
    await me.post('/tasks', { title: 'Send report to Sam' })
    await (await me.post('/assistant/chat', ask('Mark the report done'))).text()
    const r = toolResult(prompts)
    expect(r.error).toMatch(/Several tasks match/)
    expect((r.candidates as { title: string }[]).map((c) => c.title).sort()).toEqual(['Q3 report', 'Send report to Sam'])
    expect((await (await me.get('/tasks')).json()).tasks.every((t: { status: string }) => t.status === 'todo')).toBe(true)
  })

  it('a recurring task: the open copy is changed, not the finished one with the same title', async () => {
    const { me, prompts } = await setup([toolStep('set_task_status', { task: 'Daily standup', status: 'in_progress' }), textStep('OK.')])
    const { task: done } = await (await me.post('/tasks', { title: 'Daily standup' })).json()
    await me.patch(`/tasks/${done.id}`, { status: 'done' })
    const { task: open } = await (await me.post('/tasks', { title: 'Daily standup' })).json()
    await (await me.post('/assistant/chat', ask('Start the standup'))).text()
    expect((toolResult(prompts).updated as { id: string }).id).toBe(open.id)
  })

  it('an empty task name matches nothing (it used to match the first task)', async () => {
    const { me, prompts } = await setup([toolStep('start_timer', { project: 'Nope' }), textStep('Hmm.')])
    await me.post('/projects', { name: 'Website' })
    await (await me.post('/assistant/chat', ask('Start a timer on Nope'))).text()
    const r = toolResult(prompts)
    expect(r.error).toMatch(/No project is called "Nope"/)
    expect(r.candidates).toEqual(['Website'])
    expect((await (await me.get('/time-entries/running')).json()).entries).toEqual([])
  })

  it('a project name with a typo is an error, never a task quietly created without its project', async () => {
    const { me, prompts } = await setup([toolStep('create_task', { title: 'Logo', project: 'Wbsite' }), textStep('Hmm.')])
    await me.post('/projects', { name: 'Website' })
    await (await me.post('/assistant/chat', ask('Add Logo to Wbsite'))).text()
    expect(toolResult(prompts).error).toMatch(/No project is called/)
    expect((await (await me.get('/tasks')).json()).tasks).toEqual([])
  })
})

describe('chats that were cut off', () => {
  it('a tool call that never finished (stopped, offline) no longer breaks the next message', async () => {
    const { me } = await setup([textStep('Still here.')])
    const cutOff = { id: 'a1', role: 'assistant', parts: [{ type: 'tool-list_tasks', toolCallId: 'c1', state: 'input-available', input: {} }] }
    const res = await me.post('/assistant/chat', ask('Hello again', [{ id: 'u0', role: 'user', parts: [{ type: 'text', text: 'hi' }] }, cutOff]))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Still here.')
  })

  it('a question Tempo asked can be answered from the app', async () => {
    const { me, prompts } = await setup([textStep('You picked Q3.')])
    const asked = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'tool-ask_user', toolCallId: 'q1', state: 'output-available', input: { question: 'Which?', options: ['Q3 report'] }, output: { answer: 'Q3 report' } }],
    }
    const res = await me.post('/assistant/chat', { provider: 'openai', model: 'gpt-test', messages: [{ id: 'u0', role: 'user', parts: [{ type: 'text', text: 'which task' }] }, asked] })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('You picked Q3.')
    expect(JSON.stringify(prompts[0])).toContain('Q3 report')
  })
})

describe('provider errors in plain words', () => {
  const apiError = (statusCode: number, message = 'x') => new APICallError({ message, url: 'https://x', requestBodyValues: {}, statusCode, isRetryable: false })
  it('says what went wrong and what to do', () => {
    expect(providerErrorMessage(apiError(401))).toMatch(/refused your API key/)
    expect(providerErrorMessage(apiError(429))).toMatch(/rate limit/)
    expect(providerErrorMessage(apiError(404))).toMatch(/model is not available/)
    expect(providerErrorMessage(apiError(400, 'maximum context length is 128000 tokens'))).toMatch(/too long/)
    expect(providerErrorMessage(new Error('boom'))).toBe('Tempo could not answer. Try again.')
  })
})
