import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { Db } from './index.ts'
import { migrationsFolder } from './migrations-path.ts'
import * as schema from './schema/index.ts'

/** A fresh in-memory Postgres with every migration applied. Real SQL, no Neon needed. */
export async function createTestDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema })
  await migrate(db, { migrationsFolder })
  return db as unknown as Db
}
