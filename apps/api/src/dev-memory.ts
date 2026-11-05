import { serve } from '@hono/node-server'
import { createTestDb } from '@timedesk/db/testing'
import { createApp } from './app.ts'
import { createAuth } from './lib/auth.ts'

/**
 * Local API on a throwaway in-memory Postgres. Nothing is saved and Neon is not touched.
 * Handy for trying the web app, and for browser tests. Admin: admin@local.test
 */
const port = Number(process.env.PORT ?? 3001)
const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
const db = await createTestDb()
const auth = createAuth({ db, secret: 'dev-memory-secret-'.repeat(3), baseURL: `http://localhost:${port}`, webOrigin, adminEmails: ['admin@local.test'] })
const app = createApp({ db, auth, env: { WEB_ORIGIN: webOrigin, KEY_ENCRYPTION_SECRET: 'dev-memory-key-'.repeat(3) } })

serve({ fetch: app.fetch, port }, () => console.log(`timedesk api (in-memory) on http://localhost:${port}`))
