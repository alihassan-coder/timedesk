import { createDb } from '@timedesk/db'
import { createApp } from './app.ts'
import { loadEnv } from './config/env.ts'
import { createAuth } from './lib/auth.ts'

// Vercel runs this file: the default export is the Hono app (Fluid Compute, zero config).
const env = loadEnv()
const db = createDb(env.DATABASE_URL)
const auth = createAuth({
  db,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  webOrigin: env.WEB_ORIGIN,
  adminEmails: env.ADMIN_EMAILS,
})

export default createApp({ db, auth, env })
