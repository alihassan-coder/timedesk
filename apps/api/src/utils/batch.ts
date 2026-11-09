import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
import type { Db } from '@timedesk/db'

type Queries = readonly [BatchItem<'pg'>, ...BatchItem<'pg'>[]]

/**
 * Runs several statements as one unit. Neon's HTTP driver (production) sends them in one request and runs them in a
 * single transaction, so either all of them happen or none. The in-memory test database (PGlite) has no batch; there
 * they run one after another on its single connection.
 */
export async function batch<T extends Queries>(db: Db, queries: T): Promise<BatchResponse<T>> {
  const withBatch = db as unknown as { batch?: (q: T) => Promise<BatchResponse<T>> }
  if (typeof withBatch.batch === 'function') return withBatch.batch(queries)
  const results: unknown[] = []
  for (const q of queries) results.push(await q)
  return results as BatchResponse<T>
}
