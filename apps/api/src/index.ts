import { createDb } from '@timedesk/db'
import { createApp } from './app.ts'
import { loadEnv } from './config/env.ts'
import { createAuth } from './lib/auth.ts'
import { createMem0Memory } from './lib/memory.ts'
import { realModelFactory } from './lib/models.ts'

// Vercel runs this file: the default export is the Hono app (Fluid Compute, zero config).
const env = loadEnv()
const db = createDb(env.DATABASE_URL)
const auth = createAuth({
  db,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  webOrigin: env.WEB_ORIGIN,
  adminEmails: env.ADMIN_EMAILS,
  crossSiteCookies: env.CROSS_SITE_COOKIES,
})

export default createApp({ db, auth, env, models: realModelFactory, memory: createMem0Memory(env.DATABASE_URL) })
