import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { schema } from '@timedesk/db'
import { createTestDb } from '@timedesk/db/testing'
import { createApp } from '../src/app.ts'
import { createAuth } from '../src/lib/auth.ts'
import { noMemory } from '../src/lib/memory.ts'

/** Signs up and signs in on a fresh app and returns the Set-Cookie header of the sign-in. */
async function loginCookie(crossSiteCookies: boolean) {
  const db = await createTestDb()
  const webOrigin = 'https://app.example.com'
  const auth = createAuth({ db, secret: 's'.repeat(40), baseURL: 'https://api.example.com', webOrigin, adminEmails: [], crossSiteCookies })
  const app = createApp({ db, auth, env: { WEB_ORIGIN: webOrigin, KEY_ENCRYPTION_SECRET: 'k'.repeat(40) }, models: () => { throw new Error('unused') }, memory: noMemory })
  const headers = { 'Content-Type': 'application/json', Origin: webOrigin }
  await app.request('/api/auth/sign-up/email', { method: 'POST', headers, body: JSON.stringify({ email: 'c@example.com', name: 'C', username: 'cookie', password: 'correct-horse-battery' }) })
  await db.update(schema.user).set({ status: 'approved' }).where(eq(schema.user.email, 'c@example.com'))
  const res = await app.request('/api/auth/sign-in/username', { method: 'POST', headers, body: JSON.stringify({ username: 'cookie', password: 'correct-horse-battery' }) })
  expect(res.ok).toBe(true)
  return res.headers.getSetCookie().join('\n')
}

describe('login cookie across sites', () => {
  it('by default the cookie is for same-site use (subdomains of one domain)', async () => {
    const cookie = await loginCookie(false)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/HttpOnly/i)
  })

  it('with CROSS_SITE_COOKIES the cookie can travel between two different sites', async () => {
    const cookie = await loginCookie(true)
    expect(cookie).toMatch(/SameSite=None/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/HttpOnly/i)
  })
})
