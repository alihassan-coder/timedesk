import { beforeAll, describe, expect, it } from 'vitest'
import { api, approvedMember, createTestApp, WEB_ORIGIN, type TestApp } from './helpers.ts'

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
