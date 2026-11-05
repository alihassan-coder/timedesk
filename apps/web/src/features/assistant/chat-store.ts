import { useSyncExternalStore } from 'react'
import type { UIMessage } from 'ai'
import { api } from '@/lib/api'
import { readCache, writeCache } from '@/lib/cache'

/** Product name of the assistant. Change it here and it changes everywhere. */
export const ASSISTANT_NAME = 'Tempo'

export interface Conversation {
  id: string
  title: string
  updatedAt: number
  messages: UIMessage[]
  /** False until the messages are fetched (the list only brings titles). */
  loaded: boolean
  /** True when this device has changes the server has not confirmed yet. */
  dirty: boolean
  /** True once the server has this chat, so a missing one means it was deleted elsewhere. */
  synced: boolean
}

interface State {
  conversations: Conversation[]
  /** null = a new chat that is saved after its first answer. */
  activeId: string | null
}

interface ServerChat {
  id: string
  title: string
  updatedAt: string
}

const DAY = 24 * 3_600_000
const EMPTY: State = { conversations: [], activeId: null }

let userId: string | null = null
let state: State = EMPTY
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  if (userId) writeCache('chats', userId, state)
  listeners.forEach((l) => l())
}
const update = (id: string, patch: Partial<Conversation>) =>
  set({ ...state, conversations: state.conversations.map((c) => (c.id === id ? { ...c, ...patch } : c)) })

export function useChats(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export const textOf = (m: UIMessage) => m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('').trim()

const push = (c: Conversation) =>
  api(`/chats/${c.id}`, { method: 'PUT', body: { title: c.title, messages: c.messages.map((m) => ({ id: m.id, role: m.role, parts: m.parts })) } })

/**
 * Shows the cached chats at once, then reconciles with the server:
 *  - chats only the server has are added (messages load when opened)
 *  - chats the server changed more recently are marked stale
 *  - chats this device made offline are uploaded
 *  - chats deleted on another device disappear here
 */
export async function bindChats(id: string) {
  if (userId === id && state !== EMPTY) return
  userId = id
  const cached = readCache<State>('chats', id)
  set(cached ?? EMPTY)

  try {
    const { chats } = await api<{ chats: ServerChat[] }>('/chats')
    const onServer = new Map(chats.map((c) => [c.id, c]))
    const merged: Conversation[] = []

    for (const s of chats) {
      const local = state.conversations.find((c) => c.id === s.id)
      const serverTime = new Date(s.updatedAt).getTime()
      if (!local) merged.push({ id: s.id, title: s.title, updatedAt: serverTime, messages: [], loaded: false, dirty: false, synced: true })
      else if (!local.dirty && serverTime > local.updatedAt) merged.push({ ...local, title: s.title, updatedAt: serverTime, loaded: false, synced: true })
      else merged.push({ ...local, synced: true })
    }
    for (const local of state.conversations) {
      if (onServer.has(local.id)) continue
      if (!local.synced || local.dirty) merged.push(local) // made here, not uploaded yet
    }
    set({ ...state, conversations: merged })

    for (const c of merged.filter((x) => x.dirty || !x.synced)) {
      await push(c)
        .then(() => update(c.id, { dirty: false, synced: true }))
        .catch(() => {})
    }
  } catch {
    // offline or server down: keep working from the cache
  }
}

export function resetChats() {
  userId = null
  state = EMPTY
  listeners.forEach((l) => l())
}

export const chatActions = {
  newChat() {
    set({ ...state, activeId: null })
  },

  /** Opens a chat, fetching its messages first if this device only knows the title. */
  async open(id: string) {
    set({ ...state, activeId: id })
    const chat = state.conversations.find((c) => c.id === id)
    if (!chat || chat.loaded) return
    try {
      const { chat: full } = await api<{ chat: { messages: UIMessage[]; title: string } }>(`/chats/${id}`)
      update(id, { messages: full.messages, title: full.title, loaded: true })
    } catch {
      // not on the server any more: drop it
      set({ conversations: state.conversations.filter((c) => c.id !== id), activeId: null })
    }
  },

  remove(id: string) {
    set({ conversations: state.conversations.filter((c) => c.id !== id), activeId: state.activeId === id ? null : state.activeId })
    void api(`/chats/${id}`, { method: 'DELETE' }).catch(() => {})
  },

  /** Saves (or creates) a conversation on this device at once, then on the server. */
  save(id: string, messages: UIMessage[]) {
    if (messages.length === 0) return
    const existing = state.conversations.find((c) => c.id === id)
    const first = textOf(messages.find((m) => m.role === 'user') ?? messages[0])
    const title = existing?.title ?? (first.length > 44 ? `${first.slice(0, 44)}...` : first || 'New chat')
    const convo: Conversation = { id, title, updatedAt: Date.now(), messages, loaded: true, dirty: true, synced: existing?.synced ?? false }
    set({
      conversations: existing ? state.conversations.map((c) => (c.id === id ? convo : c)) : [convo, ...state.conversations],
      activeId: id,
    })
    void push(convo)
      .then(() => update(id, { dirty: false, synced: true }))
      .catch(() => {}) // stays dirty; uploaded on the next start
  },
}

/** Groups chats like ChatGPT and Claude: Today, Yesterday, Previous 7 days, Older. */
export function groupChats(chats: Conversation[], now = Date.now()) {
  const d = new Date(now)
  const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const groups: { label: string; items: Conversation[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ]
  for (const c of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (c.updatedAt >= startOfToday) groups[0].items.push(c)
    else if (c.updatedAt >= startOfToday - DAY) groups[1].items.push(c)
    else if (c.updatedAt >= startOfToday - 7 * DAY) groups[2].items.push(c)
    else groups[3].items.push(c)
  }
  return groups.filter((g) => g.items.length > 0)
}
