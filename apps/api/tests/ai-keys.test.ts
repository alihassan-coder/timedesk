import { beforeAll, describe, expect, it } from 'vitest'
import { schema } from '@timedesk/db'
import { api, approvedMember, createTestApp, type TestApp } from './helpers.ts'

let t: TestApp
let me: ReturnType<typeof api>
const SECRET_KEY = 'sk-test-1234567890abcdef'

beforeAll(async () => {
  t = await createTestApp()
  me = api(t, (await approvedMember(t, 'zed')).cookie)
}, 60_000)

describe('AI provider keys', () => {
  it('saves a key and only ever shows the last 4 characters', async () => {
    expect((await me.put('/ai/keys/openai', { key: SECRET_KEY })).status).toBe(200)

    const res = await me.get('/ai/keys')
    const text = await res.text()
    expect(text).not.toContain(SECRET_KEY)
    expect(JSON.parse(text).keys).toEqual([expect.objectContaining({ provider: 'openai', last4: 'cdef' })])
  })

  it('stores the key encrypted, never as plain text', async () => {
    const rows = await t.db.select().from(schema.aiProviderKeys)
    expect(rows).toHaveLength(1)
    expect(rows[0].encryptedKey).not.toContain(SECRET_KEY)
    expect(rows[0].encryptedKey.startsWith('v1.')).toBe(true)
  })

  it('saving again replaces the key instead of adding a second one', async () => {
    await me.put('/ai/keys/openai', { key: 'sk-second-key-0000aaaa' })
    const keys = (await (await me.get('/ai/keys')).json()).keys
    expect(keys).toHaveLength(1)
    expect(keys[0].last4).toBe('aaaa')
  })

  it('rejects an unknown provider and a too-short key', async () => {
    expect((await me.put('/ai/keys/skynet', { key: SECRET_KEY })).status).toBe(422)
    expect((await me.put('/ai/keys/groq', { key: 'x' })).status).toBe(422)
  })

  it('removes a key', async () => {
    expect((await me.del('/ai/keys/openai')).status).toBe(204)
    expect((await (await me.get('/ai/keys')).json()).keys).toEqual([])
  })
})
