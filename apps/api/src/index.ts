import { createDb } from '@timedesk/db'
import { createApp } from './app.ts'
import { createAuth } from './auth.ts'
import { loadEnv } from './env.ts'

// Vercel runs this file: the default export is the Hono app (Fluid Compute, zero config).
const env = loadEnv()
const db = createDb(env.DATABASE_URL)
const auth = createAuth({
  db,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  webOrigin: env.WEB_ORIGIN,
  adminEmail: env.ADMIN_EMAIL,
})

export default createApp({ db, auth, env })
