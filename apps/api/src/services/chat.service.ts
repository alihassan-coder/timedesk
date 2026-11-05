import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { schema, type Db } from '@timedesk/db'
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

    /** Creates or replaces a chat with its full message list. Another person's chat id is reported as not found. */
    async save(userId: string, id: string, input: SaveChat) {
      const [existing] = await db.select({ userId: c.userId }).from(c).where(eq(c.id, id))
      if (existing && existing.userId !== userId) throw notFound('Chat')

      const now = new Date()
      await db
        .insert(c)
        .values({ id, userId, title: input.title, updatedAt: now })
        .onConflictDoUpdate({ target: c.id, set: { title: input.title, updatedAt: now, deletedAt: null } })

      await db.delete(m).where(eq(m.chatId, id))
      if (input.messages.length > 0) {
        await db.insert(m).values(
          input.messages.map((msg, position) => ({
            id: crypto.randomUUID(),
            chatId: id,
            messageId: msg.id,
            role: msg.role,
            parts: msg.parts,
            position,
          })),
        )
      }
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
