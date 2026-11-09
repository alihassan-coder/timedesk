import { eq } from 'drizzle-orm'
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

describe('a stored key that can no longer be decrypted', () => {
  it('is listed as invalid, and the export, the model list and the rest keep working', async () => {
    await me.put('/ai/keys/groq', { key: 'gsk-good-key-12345678' })
    await me.put('/ai/keys/xai', { key: 'xai-will-break-1234' })
    await t.db.update(schema.aiProviderKeys).set({ encryptedKey: 'v1.broken.broken.broken' }).where(eq(schema.aiProviderKeys.provider, 'xai'))

    const keys = (await (await me.get('/ai/keys')).json()).keys
    expect(keys).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'groq', last4: '5678' }), expect.objectContaining({ provider: 'xai', invalid: true })]))

    const exported = await me.get('/account/export')
    expect(exported.status).toBe(200)
    expect((await exported.json()).aiKeysSaved).toEqual(expect.arrayContaining(['groq', 'xai']))

    // saving it again repairs it
    await me.put('/ai/keys/xai', { key: 'xai-fixed-key-9999' })
    const fixed = (await (await me.get('/ai/keys')).json()).keys.find((k: { provider: string }) => k.provider === 'xai')
    expect(fixed).toMatchObject({ last4: '9999' })
    expect(fixed.invalid).toBeUndefined()
  })
})
