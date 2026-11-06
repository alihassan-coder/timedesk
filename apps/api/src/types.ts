import type { Db } from '@timedesk/db'
import type { Auth } from './lib/auth.ts'
import type { Env } from './config/env.ts'
import type { MemoryProvider } from './lib/memory.ts'
import type { GoogleConfig } from './lib/google.ts'
import type { ModelFactory } from './lib/models.ts'

/** Everything the app needs from the outside world. Tests pass an in-memory database here. */
export interface Deps {
  db: Db
  auth: Auth
  /** Builds the language model for a provider. Tests pass a mock. */
  models: ModelFactory
  /** Long-term assistant memory (mem0 in production, a fake in tests). */
  memory: MemoryProvider
  env: Pick<Env, 'WEB_ORIGIN' | 'KEY_ENCRYPTION_SECRET'> & { DESKTOP_ORIGIN?: string }
  /** Google Calendar. Absent when the server has no Google client id and secret (the feature is then off). */
  google?: GoogleConfig
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
