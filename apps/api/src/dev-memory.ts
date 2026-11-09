import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createTestDb } from '@timedesk/db/testing'
import { createApp } from './app.ts'
import { createAuth } from './lib/auth.ts'
import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createFakeGoogle } from './lib/google-fake.ts'
import { createGoogleClient } from './lib/google.ts'
import { noMemory } from './lib/memory.ts'
import { realModelFactory } from './lib/models.ts'
import { mockModelFactory } from './dev-mock-model.ts'

/**
 * Local API on a throwaway in-memory Postgres. Nothing is saved and Neon is not touched.
 * Handy for trying the web app, and for browser tests. Admin: admin@local.test
 * MOCK_AI=1 swaps the real model for a scripted fake (no network, no key needed).
 */
const port = Number(process.env.PORT ?? 3001)
const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
const db = await createTestDb()
const auth = createAuth({ db, secret: 'dev-memory-secret-'.repeat(3), baseURL: `http://localhost:${port}`, webOrigin, desktopOrigin: 'app://timedesk', adminEmails: ['admin@local.test'] })
// FAKE_GOOGLE=1 switches Google Calendar on with an in-memory fake Google (sign-in connects dev@gmail.test).
const fakeGoogle = process.env.FAKE_GOOGLE ? createFakeGoogle() : undefined
/**
 * REAL_GOOGLE=1: connect your real Google Calendar on this throwaway database (your Neon database is not touched).
 * Only GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are read from apps/api/.env; nothing else from that file is used.
 */
function realGoogleKeys() {
  const file = new URL('../.env', import.meta.url)
  if (!existsSync(file)) return null
  const env = parseEnv(readFileSync(file, 'utf8'))
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : null
}
const wantReal = !!process.env.REAL_GOOGLE || process.argv.includes('--real-google')
const realKeys = !fakeGoogle && wantReal ? realGoogleKeys() : null
if (wantReal && !realKeys) console.warn('Real Google was asked for, but apps/api/.env has no GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET: Google Calendar stays off.')
const redirectUri = `http://localhost:${port}/v1/integrations/google/callback`
const google = fakeGoogle ? { client: fakeGoogle.client, redirectUri } : realKeys ? { client: createGoogleClient(realKeys), redirectUri } : undefined
const app = createApp({ db, auth, env: { WEB_ORIGIN: webOrigin, KEY_ENCRYPTION_SECRET: 'dev-memory-key-'.repeat(3) }, models: process.env.MOCK_AI ? mockModelFactory : realModelFactory, memory: noMemory, google })

// Browser tests look for this route and refuse to run against anything else, so they can never hit a real database.
const root = new Hono()
root.get('/__memory', (c) => c.json({ memory: true }))
// With FAKE_GOOGLE=1, browser tests can play "the person edits their calendar in Google" through these routes.
if (fakeGoogle) {
  const dev = 'dev@gmail.test' // the account a sign-in with the fake Google connects
  root.get('/__fake-google/events', (c) => c.json({ events: fakeGoogle.eventsOf(dev) }))
  root.post('/__fake-google/seed', async (c) => c.json(fakeGoogle.seed(dev, await c.req.json())))
  root.post('/__fake-google/edit/:id', async (c) => {
    fakeGoogle.editInGoogle(dev, c.req.param('id'), await c.req.json())
    return c.json({ ok: true })
  })
}
root.route('/', app)

serve({ fetch: root.fetch, port }, () => console.log(`timedesk api (in-memory) on http://localhost:${port}`))
