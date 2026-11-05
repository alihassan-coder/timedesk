import { eq } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'
import { badRequest, notFound } from '../utils/errors.ts'

const u = schema.user

/** Reviewing registrations. New accounts are pending until an admin approves them here. */
export function createAdminService(db: Db) {
  return {
    listUsers: (status: 'pending' | 'approved' | 'rejected' | 'all') =>
      db
        .select({ id: u.id, name: u.name, email: u.email, username: u.username, role: u.role, status: u.status, createdAt: u.createdAt })
        .from(u)
        .where(status === 'all' ? undefined : eq(u.status, status)),

    async decide(adminId: string, userId: string, status: 'approved' | 'rejected') {
      if (userId === adminId) throw badRequest('You cannot change your own status.')
      const [row] = await db.update(u).set({ status, updatedAt: new Date() }).where(eq(u.id, userId)).returning({ id: u.id, status: u.status })
      if (!row) throw notFound('User')
      return row
    },
  }
}

export type AdminService = ReturnType<typeof createAdminService>
