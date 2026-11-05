import { eq } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'
import { createTestDb } from '@timedesk/db/testing'
import { createApp } from '../src/app.ts'
import { createAuth } from '../src/lib/auth.ts'
import { noMemory, type MemoryProvider } from '../src/lib/memory.ts'
import type { ModelFactory } from '../src/lib/models.ts'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'

export const WEB_ORIGIN = 'http://localhost:5173'
export const ADMIN_EMAIL = 'boss@example.com'
export const DESKTOP_ORIGIN = 'app://timedesk'

export interface TestApp {
  app: ReturnType<typeof createApp>
  db: Db
}

/** The real app on a fresh in-memory Postgres with every migration applied. */
export async function createTestApp(overrides: { models?: ModelFactory; memory?: MemoryProvider } = {}): Promise<TestApp> {
  const db = await createTestDb()
  const env = { WEB_ORIGIN, KEY_ENCRYPTION_SECRET: 'k'.repeat(40) }
  const auth = createAuth({ db, secret: 's'.repeat(40), baseURL: 'http://localhost:3001', webOrigin: WEB_ORIGIN, desktopOrigin: DESKTOP_ORIGIN, adminEmails: [ADMIN_EMAIL] })
  return { app: createApp({ db, auth, env, models: overrides.models ?? (() => { throw new Error('no model configured for this test') }), memory: overrides.memory ?? noMemory }), db }
}

const json = (body: unknown, cookie?: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
})

export interface Account {
  email: string
  username: string
  password: string
}

export const account = (name: string): Account => ({ email: `${name}@example.com`, username: name, password: 'correct-horse-battery' })

export async function register(t: TestApp, a: Account) {
  return t.app.request('/api/auth/sign-up/email', json({ email: a.email, name: a.username, username: a.username, password: a.password }))
}

/** Signs in by username and returns the session cookie, or null if sign-in was refused. */
export async function signIn(t: TestApp, a: Pick<Account, 'username' | 'password'>): Promise<string | null> {
  const res = await t.app.request('/api/auth/sign-in/username', json({ username: a.username, password: a.password }))
  if (!res.ok) return null
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

export async function signInResponse(t: TestApp, a: Pick<Account, 'username' | 'password'>) {
  return t.app.request('/api/auth/sign-in/username', json({ username: a.username, password: a.password }))
}

/** Registers, approves directly in the database, signs in. For tests that are not about approval. */
export async function approvedMember(t: TestApp, name: string): Promise<{ cookie: string; account: Account }> {
  const a = account(name)
  await register(t, a)
  await t.db.update(schema.user).set({ status: 'approved' }).where(eq(schema.user.email, a.email))
  const cookie = await signIn(t, a)
  if (!cookie) throw new Error(`could not sign in ${name}`)
  return { cookie, account: a }
}

export async function admin(t: TestApp): Promise<string> {
  const a = { email: ADMIN_EMAIL, username: 'boss', password: 'correct-horse-battery' }
  await register(t, a)
  const cookie = await signIn(t, a)
  if (!cookie) throw new Error('admin could not sign in')
  return cookie
}

export function api(t: TestApp, cookie: string) {
  const call = (method: string, path: string, body?: unknown) =>
    t.app.request(`/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN, Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    put: (p: string, b: unknown) => call('PUT', p, b),
    del: (p: string) => call('DELETE', p),
  }
}

// ---- fakes for the assistant ----

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

/** A step where the model calls a tool. */
export const toolStep = (toolName: string, input: unknown, id = 'call-1') => [
  { type: 'tool-call' as const, toolCallId: id, toolName, input: JSON.stringify(input) },
  { type: 'finish' as const, finishReason: { unified: 'tool-calls' as const, raw: undefined }, logprobs: undefined, usage },
]

/** A step where the model answers with text. */
export const textStep = (text: string) => [
  { type: 'text-start' as const, id: 't1' },
  { type: 'text-delta' as const, id: 't1', delta: text },
  { type: 'text-end' as const, id: 't1' },
  { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: undefined }, logprobs: undefined, usage },
]

/** A language model that plays back scripted steps and records every prompt it was sent. */
export function scriptedModel(steps: unknown[][]) {
  const prompts: unknown[] = []
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.push(options.prompt)
      const chunks = steps[Math.min(prompts.length - 1, steps.length - 1)]
      return { stream: simulateReadableStream({ chunks: chunks as never }) }
    },
  })
  return { model, prompts }
}
