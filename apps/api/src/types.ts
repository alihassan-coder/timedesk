import type { Db } from '@timedesk/db'
import type { Auth } from './auth.ts'
import type { Env } from './env.ts'

export interface Deps {
  db: Db
  auth: Auth
  env: Pick<Env, 'WEB_ORIGIN' | 'KEY_ENCRYPTION_SECRET'>
}

export interface SessionUser {
  id: string
  email: string
  name: string
  username?: string | null
  role: string
  status: string
}

export interface AppEnv {
  Variables: { user: SessionUser }
}
