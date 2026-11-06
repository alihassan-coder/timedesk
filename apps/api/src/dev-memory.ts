import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createTestDb } from '@timedesk/db/testing'
import { createApp } from './app.ts'
import { createAuth } from './lib/auth.ts'
import { createFakeGoogle } from './lib/google-fake.ts'
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
const google = fakeGoogle ? { client: fakeGoogle.client, redirectUri: `http://localhost:${port}/v1/integrations/google/callback` } : undefined
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
