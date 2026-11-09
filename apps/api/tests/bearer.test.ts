import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { schema } from '@timedesk/db'
import { account, createTestApp, DESKTOP_ORIGIN, register, WEB_ORIGIN, type TestApp } from './helpers.ts'

let t: TestApp
let token: string

const headers = (extra: Record<string, string> = {}) => ({ 'Content-Type': 'application/json', Origin: DESKTOP_ORIGIN, ...extra })

beforeAll(async () => {
  t = await createTestApp()
  const dana = account('dana')
  await register(t, dana)
  await t.db.update(schema.user).set({ status: 'approved' }).where(eq(schema.user.email, dana.email))
  const res = await t.app.request('/api/auth/sign-in/username', { method: 'POST', headers: headers(), body: JSON.stringify({ username: dana.username, password: dana.password }) })
  token = res.headers.get('set-auth-token') ?? ''
})

describe('token sign-in for the desktop app', () => {
  it('signing in also returns a token', () => {
    expect(token.length).toBeGreaterThan(20)
  })

  it('the token alone, with no cookie, is enough to use the API', async () => {
    const me = await t.app.request('/v1/me', { headers: headers({ Authorization: `Bearer ${token}` }) })
    expect(me.status).toBe(200)
    expect((await me.json()).user).toMatchObject({ username: 'dana', status: 'approved' })

    const made = await t.app.request('/v1/tasks', { method: 'POST', headers: headers({ Authorization: `Bearer ${token}` }), body: JSON.stringify({ title: 'From the desktop app' }) })
    expect(made.status).toBe(201)
  })

  it('a script with the token but no browser origin may make changes too', async () => {
    const made = await t.app.request('/v1/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ title: 'From a script' }) })
    expect(made.status).toBe(201)
  })

  it('a made-up or damaged token is refused', async () => {
    for (const bad of ['not-a-real-token', token.slice(0, -4) + 'AAAA', '']) {
      const res = await t.app.request('/v1/me', { headers: headers({ Authorization: `Bearer ${bad}` }) })
      expect(res.status).toBe(401)
    }
  })

  it('no token and no cookie is still 401', async () => {
    expect((await t.app.request('/v1/me', { headers: headers() })).status).toBe(401)
  })

  it('signing out ends the token for good', async () => {
    const out = await t.app.request('/api/auth/sign-out', { method: 'POST', headers: headers({ Authorization: `Bearer ${token}` }), body: '{}' })
    expect(out.ok).toBe(true)
    const after = await t.app.request('/v1/me', { headers: headers({ Authorization: `Bearer ${token}` }) })
    expect(after.status).toBe(401)
  })
})

describe('who may call the API from a browser or app', () => {
  const preflight = (origin: string) =>
    t.app.request('/v1/me', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } })

  it('allows the desktop app, and lets it read the token header and send Authorization', async () => {
    const res = await preflight(DESKTOP_ORIGIN)
    expect(res.headers.get('access-control-allow-origin')).toBe(DESKTOP_ORIGIN)
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization')
    const real = await t.app.request('/health', { headers: { Origin: DESKTOP_ORIGIN } })
    expect(real.headers.get('access-control-expose-headers')?.toLowerCase()).toContain('set-auth-token')
  })

  it('still allows the website', async () => {
    expect((await preflight(WEB_ORIGIN)).headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN)
  })

  it('refuses any other site, including one that only looks similar', async () => {
    for (const evil of ['https://evil.example.com', 'app://timedesk.evil.com', 'http://timedesk']) {
      expect((await preflight(evil)).headers.get('access-control-allow-origin')).not.toBe(evil)
    }
  })
})
