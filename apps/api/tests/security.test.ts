import { beforeAll, describe, expect, it } from 'vitest'
import { api, approvedMember, createTestApp, DESKTOP_ORIGIN, WEB_ORIGIN, type TestApp } from './helpers.ts'

let t: TestApp
let ann: ReturnType<typeof api>

beforeAll(async () => {
  t = await createTestApp()
  ann = api(t, (await approvedMember(t, 'ann')).cookie)
})

describe('browser protections', () => {
  it('sends the standard security headers', async () => {
    const res = await t.app.request('/health')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toMatch(/sameorigin|deny/i)
    expect(res.headers.get('referrer-policy')).toBeTruthy()
  })

  it('lets the web app origin call the API with its login cookie', async () => {
    const res = await t.app.request('/v1/me', { method: 'OPTIONS', headers: { Origin: WEB_ORIGIN, 'Access-Control-Request-Method': 'GET' } })
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN)
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('does not give any other website CORS access', async () => {
    const res = await t.app.request('/v1/me', { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'GET' } })
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://evil.example.com')
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*')
  })
})

describe('request limits and errors', () => {
  it('refuses a request body that is far too large', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024)
    const res = await ann.post('/tasks', { title: big })
    expect(res.status).toBe(413)
    expect((await res.json()).error).toContain('too large')
  })

  it('answers unknown paths with a clean JSON 404', async () => {
    const res = await t.app.request('/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found.' })
  })

  it('never leaks internals when something unexpected breaks', async () => {
    // a path parameter that cannot be a date makes zod reject it: a 422 with a message, no stack trace
    const res = await ann.get('/time-entries?from=not-a-date')
    expect(res.status).toBe(422)
    const text = await res.text()
    expect(text).not.toMatch(/at .*\.ts:\d+/)
  })
})

describe('other websites cannot act as the signed-in person (CSRF)', () => {
  let cookie: string
  beforeAll(async () => {
    cookie = (await approvedMember(t, 'csrf')).cookie
  })
  const send = (method: string, path: string, headers: Record<string, string>, body?: string) =>
    t.app.request(`/v1${path}`, { method, headers: { Cookie: cookie, ...headers }, body })

  it('refuses a change sent as a form or plain text, which any website can make a browser send', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const res = await send('POST', '/tasks', { Origin: WEB_ORIGIN, 'Content-Type': type }, JSON.stringify({ title: 'Forged' }))
      expect(res.status).toBe(415)
    }
    expect((await (await ann.get('/tasks')).json()).tasks.map((x: { title: string }) => x.title)).not.toContain('Forged')
  })

  it('refuses a change from another site, or with no origin and only a cookie', async () => {
    const json = { 'Content-Type': 'application/json' }
    expect((await send('POST', '/tasks', { ...json, Origin: 'https://evil.example.com' }, JSON.stringify({ title: 'Forged' }))).status).toBe(403)
    expect((await send('DELETE', '/activity', { Origin: 'https://evil.example.com' })).status).toBe(403)
    expect((await send('POST', '/tasks', json, JSON.stringify({ title: 'Forged' }))).status).toBe(403)
  })

  it('still allows the website and the desktop app, and reading without an origin', async () => {
    const json = { 'Content-Type': 'application/json; charset=utf-8' }
    expect((await send('POST', '/tasks', { ...json, Origin: WEB_ORIGIN }, JSON.stringify({ title: 'From the web' }))).status).toBe(201)
    expect((await send('POST', '/tasks', { ...json, Origin: DESKTOP_ORIGIN }, JSON.stringify({ title: 'From the app' }))).status).toBe(201)
    expect((await send('GET', '/tasks', {})).status).toBe(200)
  })

  it('a bare POST with no body and no content type still works where every field is optional', async () => {
    expect((await send('PATCH', '/settings', { Origin: WEB_ORIGIN })).status).toBe(200)
  })

  it('a body that is not valid JSON is a 400, not quietly ignored', async () => {
    const res = await send('PATCH', '/settings', { Origin: WEB_ORIGIN, 'Content-Type': 'application/json' }, '{"appearance": {')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('The request body is not valid JSON.')
  })
})

describe('database refusals', () => {
  it.each([
    ['23505', 409],
    ['23503', 422],
    ['22P02', 422],
    ['22001', 422],
  ])('Postgres %s becomes %i, without the SQL', async (code, status) => {
    const app = (await createTestApp()).app
    app.get('/test-db-error', () => {
      throw Object.assign(new Error('Failed query: insert into "tasks" values ($1)'), { cause: Object.assign(new Error('secret detail'), { code }) })
    })
    const res = await app.request('/test-db-error')
    expect(res.status).toBe(status)
    const text = await res.text()
    expect(text).not.toMatch(/insert into|secret detail/)
  })
})
