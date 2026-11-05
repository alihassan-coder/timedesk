import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { schema } from '@timedesk/db'
import { fakeMemory } from './fakes.ts'
import { api, approvedMember, createTestApp, scriptedModel, textStep } from './helpers.ts'

const SECRET = 'sk-openai-test-key-1234567890'
const chat = (text: string, provider = 'openai') => ({
  provider,
  model: 'gpt-test',
  messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }],
})

async function setup(reply = 'Noted.') {
  const mem = fakeMemory()
  const { model, prompts } = scriptedModel([textStep(reply)])
  const t = await createTestApp({ models: () => model, memory: mem.memory })
  const userId = async (username: string) => (await t.db.select().from(schema.user).where(eq(schema.user.username, username)))[0].id
  return { t, mem, prompts, userId }
}

describe('assistant memory', () => {
  it('puts what it remembers about the user into the model prompt', async () => {
    const { t, mem, prompts, userId } = await setup()
    const ann = api(t, (await approvedMember(t, 'ann')).cookie)
    mem.add(await userId('ann'), 'Works 9 to 5, Sunday to Thursday')
    await ann.put('/ai/keys/openai', { key: SECRET })

    await (await ann.post('/assistant/chat', chat('plan my day'))).text()

    expect(JSON.stringify(prompts)).toContain('Works 9 to 5, Sunday to Thursday')
  }, 30_000)

  it('never shows one person another person\'s memories', async () => {
    const { t, mem, prompts, userId } = await setup()
    const ann = api(t, (await approvedMember(t, 'ann')).cookie)
    await approvedMember(t, 'bob')
    mem.add(await userId('bob'), 'Bob secretly hates mornings')
    await ann.put('/ai/keys/openai', { key: SECRET })

    await (await ann.post('/assistant/chat', chat('plan my day'))).text()

    expect(JSON.stringify(prompts)).not.toContain('Bob secretly hates mornings')
  }, 30_000)

  it('saves the exchange to memory after the answer is done', async () => {
    const { t, mem, userId } = await setup('Got it, standup at 10.')
    const ann = api(t, (await approvedMember(t, 'ann')).cookie)
    await ann.put('/ai/keys/openai', { key: SECRET })

    await (await ann.post('/assistant/chat', chat('my standup is at 10'))).text()
    await new Promise((r) => setTimeout(r, 50))

    expect(mem.saved).toEqual([
      {
        userId: await userId('ann'),
        turns: [
          { role: 'user', content: 'my standup is at 10' },
          { role: 'assistant', content: 'Got it, standup at 10.' },
        ],
      },
    ])
  }, 30_000)

  it('leaves memory off, but still answers, when there is no OpenAI key', async () => {
    const { t, mem } = await setup()
    const ann = api(t, (await approvedMember(t, 'ann')).cookie)
    await ann.put('/ai/keys/groq', { key: 'gsk_test_key_123456789' })

    const res = await ann.post('/assistant/chat', chat('hello', 'groq'))
    expect(await res.text()).toContain('Noted.')
    await new Promise((r) => setTimeout(r, 50))

    expect(mem.searchCount()).toBe(0)
    expect(mem.saved).toEqual([])
  }, 30_000)

  it('lists and forgets only your own memories', async () => {
    const { t, mem, userId } = await setup()
    const ann = api(t, (await approvedMember(t, 'ann')).cookie)
    const bob = api(t, (await approvedMember(t, 'bob')).cookie)
    const annMemory = mem.add(await userId('ann'), 'Likes short answers')
    const bobMemory = mem.add(await userId('bob'), 'Bob private fact')

    const mine = (await (await ann.get('/assistant/memories')).json()).memories
    expect(mine.map((m: { text: string }) => m.text)).toEqual(['Likes short answers'])

    expect((await ann.del(`/assistant/memories/${bobMemory}`)).status).toBe(404)
    expect((await bob.get('/assistant/memories')).status).toBe(200)
    expect((await ann.del(`/assistant/memories/${annMemory}`)).status).toBe(204)
    expect((await (await ann.get('/assistant/memories')).json()).memories).toEqual([])
  }, 30_000)
})
