import { and, asc, desc, eq, isNull, notInArray, sql } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'
import { batch } from '../utils/batch.ts'
import { notFound } from '../utils/errors.ts'
import type { SaveChat } from '../validators/index.ts'

const c = schema.chats
const m = schema.chatMessages

/** Saved Tempo conversations. Chat ids come from the client, so a chat can exist before the server hears of it. */
export function createChatService(db: Db) {
  const owned = (userId: string, id: string) => and(eq(c.id, id), eq(c.userId, userId), isNull(c.deletedAt))

  return {
    list: (userId: string) =>
      db
        .select({ id: c.id, title: c.title, updatedAt: c.updatedAt })
        .from(c)
        .where(and(eq(c.userId, userId), isNull(c.deletedAt)))
        .orderBy(desc(c.updatedAt)),

    async get(userId: string, id: string) {
      const [chat] = await db.select().from(c).where(owned(userId, id))
      if (!chat) throw notFound('Chat')
      const rows = await db.select().from(m).where(eq(m.chatId, id)).orderBy(asc(m.position))
      return {
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt,
        messages: rows.map((r) => ({ id: r.messageId, role: r.role, parts: r.parts })),
      }
    },

    /**
     * Creates or replaces a chat with its full message list, as one unit. Another person's chat id is reported as not
     * found and nothing of theirs is touched. Two saves of the same chat at once both succeed (the last one wins):
     * messages are updated in place by id, and only the ones no longer in the list are removed.
     */
    async save(userId: string, id: string, input: SaveChat) {
      const now = new Date()
      const mine = sql`exists (select 1 from ${c} where ${c.id} = ${id} and ${c.userId} = ${userId})`
      const rows = input.messages.map((msg, position) => ({ message_id: msg.id, role: msg.role, parts: msg.parts, position }))

      const [saved] = await batch(db, [
        // The update only applies to a chat of this person, so a chat id that belongs to someone else returns no row.
        db
          .insert(c)
          .values({ id, userId, title: input.title, updatedAt: now })
          .onConflictDoUpdate({ target: c.id, set: { title: input.title, updatedAt: now, deletedAt: null }, setWhere: eq(c.userId, userId) })
          .returning({ id: c.id }),
        db.delete(m).where(and(eq(m.chatId, id), notInArray(m.messageId, input.messages.map((x) => x.id)), mine)),
        db.execute(sql`
          insert into ${m} (id, chat_id, message_id, role, parts, position)
          select gen_random_uuid()::text, ${id}, x.message_id, x.role, x.parts, x.position
          from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(message_id text, role text, parts jsonb, position integer)
          where ${mine}
          on conflict (chat_id, message_id) do update set role = excluded.role, parts = excluded.parts, position = excluded.position`),
      ])
      if (saved.length === 0) throw notFound('Chat')
      return { id, updatedAt: now }
    },

    async remove(userId: string, id: string) {
      const now = new Date()
      const [row] = await db.update(c).set({ deletedAt: now, updatedAt: now }).where(owned(userId, id)).returning({ id: c.id })
      if (!row) throw notFound('Chat')
      await db.delete(m).where(eq(m.chatId, id))
    },
  }
}

export type ChatService = ReturnType<typeof createChatService>
