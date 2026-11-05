import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema/index.ts'

export { schema }
export * from './schema/index.ts'

/** Any Drizzle Postgres database: Neon in production, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export function createDb(databaseUrl: string): Db {
  return drizzle(neon(databaseUrl), { schema }) as unknown as Db
}
