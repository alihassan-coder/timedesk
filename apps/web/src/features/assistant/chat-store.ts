import { useSyncExternalStore } from 'react'
import type { UIMessage } from 'ai'

/** Product name of the assistant. Change it here and it changes everywhere. */
export const ASSISTANT_NAME = 'Tempo'

export interface Conversation {
  id: string
  title: string
  updatedAt: number
  messages: UIMessage[]
}

interface State {
  conversations: Conversation[]
  /** null = a new chat that is saved after its first answer. */
  activeId: string | null
}

const DAY = 24 * 3_600_000
// v2: messages are now AI SDK UI messages. Chats are kept on this device for now.
const KEY = 'timedesk:chats:v2'

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    // blocked or corrupt storage
  }
  return { conversations: [], activeId: null }
}

let state = load()
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

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

export const chatActions = {
  newChat() {
    set({ ...state, activeId: null })
  },
  open(id: string) {
    set({ ...state, activeId: id })
  },
  remove(id: string) {
    set({ conversations: state.conversations.filter((c) => c.id !== id), activeId: state.activeId === id ? null : state.activeId })
  },
  /** Saves (or creates) a conversation. The title comes from the first thing the user said. */
  save(id: string, messages: UIMessage[]) {
    if (messages.length === 0) return
    const existing = state.conversations.find((c) => c.id === id)
    const first = textOf(messages.find((m) => m.role === 'user') ?? messages[0])
    const title = existing?.title ?? (first.length > 44 ? `${first.slice(0, 44)}...` : first || 'New chat')
    const convo: Conversation = { id, title, updatedAt: Date.now(), messages }
    set({
      conversations: existing ? state.conversations.map((c) => (c.id === id ? convo : c)) : [convo, ...state.conversations],
      activeId: id,
    })
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
