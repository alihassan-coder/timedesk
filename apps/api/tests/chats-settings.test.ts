import { beforeAll, describe, expect, it } from 'vitest'
import { memorySetup } from '../src/lib/memory.ts'
import { api, approvedMember, createTestApp, type TestApp } from './helpers.ts'

let t: TestApp
let ann: ReturnType<typeof api>
let bob: ReturnType<typeof api>

beforeAll(async () => {
  t = await createTestApp()
  ann = api(t, (await approvedMember(t, 'ann')).cookie)
  bob = api(t, (await approvedMember(t, 'bob')).cookie)
})

const userMsg = (id: string, text: string) => ({ id, role: 'user', parts: [{ type: 'text', text }] })
const botMsg = (id: string, text: string) => ({
  id,
  role: 'assistant',
  parts: [
    { type: 'tool-create_task', state: 'output-available', input: { title: 'Buy milk' }, output: { created: { title: 'Buy milk' } } },
    { type: 'text', text },
  ],
})

describe('saved chats', () => {
  it('saves a chat under a client-made id and returns every message in order, tool results included', async () => {
    const messages = [userMsg('m1', 'add a task: Buy milk'), botMsg('m2', 'Done.'), userMsg('m3', 'thanks')]
    const saved = await ann.put('/chats/chat-aaa', { title: 'Buy milk', messages })
    expect(saved.status).toBe(200)

    const { chat } = await (await ann.get('/chats/chat-aaa')).json()
    expect(chat.title).toBe('Buy milk')
    expect(chat.messages).toEqual(messages)
  })

  it('lists chats newest first', async () => {
    await ann.put('/chats/chat-older', { title: 'Older', messages: [userMsg('a', 'hi')] })
    await new Promise((r) => setTimeout(r, 20))
    await ann.put('/chats/chat-newer', { title: 'Newer', messages: [userMsg('b', 'hi')] })

    const { chats } = await (await ann.get('/chats')).json()
    const titles = chats.map((c: { title: string }) => c.title)
    expect(titles.indexOf('Newer')).toBeLessThan(titles.indexOf('Older'))
  })

  it('saving again replaces the messages and the title instead of duplicating', async () => {
    await ann.put('/chats/chat-bbb', { title: 'First title', messages: [userMsg('x1', 'one')] })
    await ann.put('/chats/chat-bbb', { title: 'Second title', messages: [userMsg('x1', 'one'), botMsg('x2', 'two')] })

    const { chat } = await (await ann.get('/chats/chat-bbb')).json()
    expect(chat.title).toBe('Second title')
    expect(chat.messages).toHaveLength(2)
  })

  it('keeps one person\'s chats away from everyone else', async () => {
    await ann.put('/chats/chat-private', { title: 'Ann private', messages: [userMsg('p1', 'secret plan')] })

    const bobList = await (await bob.get('/chats')).json()
    expect(bobList.chats.map((c: { id: string }) => c.id)).not.toContain('chat-private')
    expect((await bob.get('/chats/chat-private')).status).toBe(404)
    expect((await bob.put('/chats/chat-private', { title: 'taken over', messages: [userMsg('z', 'x')] })).status).toBe(404)
    expect((await bob.del('/chats/chat-private')).status).toBe(404)

    const { chat } = await (await ann.get('/chats/chat-private')).json()
    expect(chat.title).toBe('Ann private')
    expect(chat.messages[0].parts[0].text).toBe('secret plan')
  })

  it('deleting removes it from the list and from direct access', async () => {
    await ann.put('/chats/chat-gone', { title: 'Temporary', messages: [userMsg('g1', 'bye')] })
    expect((await ann.del('/chats/chat-gone')).status).toBe(204)
    expect((await ann.get('/chats/chat-gone')).status).toBe(404)
    const { chats } = await (await ann.get('/chats')).json()
    expect(chats.map((c: { id: string }) => c.id)).not.toContain('chat-gone')
  })

  it('two saves of the same chat at the same moment both succeed, and the chat keeps one copy of each message', async () => {
    const first = [userMsg('c1', 'hello')]
    const second = [userMsg('c1', 'hello'), botMsg('c2', 'hi there')]
    const results = await Promise.all([ann.put('/chats/chat-race', { title: 'Race', messages: first }), ann.put('/chats/chat-race', { title: 'Race', messages: second })])
    expect(results.map((r) => r.status)).toEqual([200, 200])
    const { chat } = await (await ann.get('/chats/chat-race')).json()
    const ids = chat.messages.map((x: { id: string }) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe('c1')
  })

  it('a shorter list removes the messages that are gone and keeps the order', async () => {
    await ann.put('/chats/chat-trim', { title: 'Trim', messages: [userMsg('t1', 'a'), botMsg('t2', 'b'), userMsg('t3', 'c')] })
    await ann.put('/chats/chat-trim', { title: 'Trim', messages: [userMsg('t3', 'c'), userMsg('t1', 'a')] })
    const { chat } = await (await ann.get('/chats/chat-trim')).json()
    expect(chat.messages.map((x: { id: string }) => x.id)).toEqual(['t3', 't1'])
  })

  it('refuses two messages with the same id, or an absurdly long id, and keeps what was saved', async () => {
    await ann.put('/chats/chat-dup', { title: 'Dup', messages: [userMsg('d1', 'keep me')] })
    expect((await ann.put('/chats/chat-dup', { title: 'Dup', messages: [userMsg('d1', 'a'), userMsg('d1', 'b')] })).status).toBe(422)
    expect((await ann.put('/chats/chat-dup', { title: 'Dup', messages: [userMsg('x'.repeat(201), 'a')] })).status).toBe(422)
    const { chat } = await (await ann.get('/chats/chat-dup')).json()
    expect(chat.messages).toEqual([userMsg('d1', 'keep me')])
  })

  it('a deleted chat of someone else still cannot be taken over by its id', async () => {
    await ann.put('/chats/chat-ann-deleted', { title: 'Mine', messages: [userMsg('q1', 'x')] })
    await ann.del('/chats/chat-ann-deleted')
    expect((await bob.put('/chats/chat-ann-deleted', { title: 'taken', messages: [userMsg('q2', 'y')] })).status).toBe(404)
    expect((await bob.get('/chats/chat-ann-deleted')).status).toBe(404)
  })

  it('rejects an empty title and an unknown message role', async () => {
    expect((await ann.put('/chats/chat-bad', { title: '  ', messages: [] })).status).toBe(422)
    expect((await ann.put('/chats/chat-bad', { title: 'ok', messages: [{ id: '1', role: 'robot', parts: [] }] })).status).toBe(422)
  })
})

describe('saved settings', () => {
  it('starts empty', async () => {
    const res = await (await ann.get('/settings')).json()
    expect(res.data).toEqual({})
  })

  it('stores appearance and merges later changes without erasing earlier ones', async () => {
    await ann.patch('/settings', { appearance: { accent: 'violet', mode: 'dark' } })
    await ann.patch('/settings', { aiPrefs: { selected: { provider: 'openai', model: 'gpt-4.1' } } })

    const { data } = await (await ann.get('/settings')).json()
    expect(data.appearance).toEqual({ accent: 'violet', mode: 'dark' })
    expect(data.aiPrefs.selected).toEqual({ provider: 'openai', model: 'gpt-4.1' })
  })

  it('changes sent at the same moment are all kept', async () => {
    await Promise.all([
      ann.patch('/settings', { notifications: { sound: true } }),
      ann.patch('/settings', { desktop: { tray: true } }),
      ann.patch('/settings', { timer: { dailyGoalMinutes: 300 } }),
    ])
    const { data } = await (await ann.get('/settings')).json()
    expect(data).toMatchObject({ notifications: { sound: true }, desktop: { tray: true }, timer: { dailyGoalMinutes: 300 }, appearance: { accent: 'violet', mode: 'dark' } })
  })

  it('a group sent again replaces that group only', async () => {
    const res = await (await ann.patch('/settings', { appearance: { mode: 'light' } })).json()
    expect(res.data.appearance).toEqual({ mode: 'light' })
    expect(res.data.timer).toEqual({ dailyGoalMinutes: 300 })
  })

  it('keeps each person\'s settings separate', async () => {
    expect((await (await bob.get('/settings')).json()).data).toEqual({})
  })

  it('refuses unknown groups so nobody can park arbitrary data here', async () => {
    expect((await ann.patch('/settings', { apiKeys: { openai: 'sk-secret' } })).status).toBe(422)
    expect((await ann.patch('/settings', { appearance: 'not an object' })).status).toBe(422)
  })

  it('requires a signed-in account', async () => {
    expect((await t.app.request('/v1/settings')).status).toBe(401)
  })
})

describe('which provider powers memory', () => {
  it('prefers OpenAI, falls back to Gemini, and is off with neither', () => {
    expect(memorySetup({ openai: 'k', google: 'g' })).toMatchObject({ embedder: 'openai', dims: 1536 })
    expect(memorySetup({ google: 'g' })).toMatchObject({ embedder: 'gemini', dims: 768 })
    expect(memorySetup({ groq: 'x', anthropic: 'y', xai: 'z' })).toBeNull()
    expect(memorySetup({})).toBeNull()
  })
})
