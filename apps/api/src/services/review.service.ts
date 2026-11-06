import { and, desc, eq } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'

const r = schema.weeklyReviews

export interface Review {
  weekStart: string
  wentWell: string
  improve: string
  updatedAt: Date | null
}

/** Weekly reflections, one per person per week (named by its Monday). */
export function createReviewService(db: Db) {
  const shape = (row: typeof r.$inferSelect): Review => ({ weekStart: row.weekStart, wentWell: row.wentWell, improve: row.improve, updatedAt: row.updatedAt })

  return {
    /** The review for that week, or an empty one when nothing was written yet. */
    async get(userId: string, weekStart: string): Promise<Review> {
      const [row] = await db.select().from(r).where(and(eq(r.userId, userId), eq(r.weekStart, weekStart)))
      return row ? shape(row) : { weekStart, wentWell: '', improve: '', updatedAt: null }
    },

    /** The most recent reviews, newest week first. */
    async recent(userId: string, limit = 12): Promise<Review[]> {
      return (await db.select().from(r).where(eq(r.userId, userId)).orderBy(desc(r.weekStart)).limit(limit)).map(shape)
    },

    async save(userId: string, weekStart: string, input: { wentWell: string; improve: string }): Promise<Review> {
      const now = new Date()
      const values = { wentWell: input.wentWell.trim(), improve: input.improve.trim(), updatedAt: now }
      const [row] = await db
        .insert(r)
        .values({ userId, weekStart, ...values })
        .onConflictDoUpdate({ target: [r.userId, r.weekStart], set: values })
        .returning()
      return shape(row)
    },
  }
}

export type ReviewService = ReturnType<typeof createReviewService>
