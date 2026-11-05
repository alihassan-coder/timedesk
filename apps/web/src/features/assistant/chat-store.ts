import { useSyncExternalStore } from 'react'

/** Product name of the assistant. Change it here and it changes everywhere. */
export const ASSISTANT_NAME = 'Tempo'

export interface ToolTrace {
  name: string
  summary: string
}
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools?: ToolTrace[]
}
export interface Conversation {
  id: string
  title: string
  updatedAt: number
  messages: ChatMessage[]
}

interface State {
  conversations: Conversation[]
  /** null = a new, empty chat that is not saved until the first message. */
  activeId: string | null
}

const DAY = 24 * 3_600_000
const KEY = 'timedesk:chats'

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
  /** Adds the user's message to the active chat (creating one if needed). Returns the chat id. */
  addUserMessage(text: string): string {
    const msg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text }
    const active = state.conversations.find((c) => c.id === state.activeId)
    if (active) {
      set({ ...state, conversations: state.conversations.map((c) => (c.id === active.id ? { ...c, updatedAt: Date.now(), messages: [...c.messages, msg] } : c)) })
      return active.id
    }
    const id = crypto.randomUUID()
    const title = text.length > 44 ? `${text.slice(0, 44)}...` : text
    set({ conversations: [{ id, title, updatedAt: Date.now(), messages: [msg] }, ...state.conversations], activeId: id })
    return id
  },
  addAssistantMessage(chatId: string, text: string, tools?: ToolTrace[]) {
    const msg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', text, tools }
    set({ ...state, conversations: state.conversations.map((c) => (c.id === chatId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, msg] } : c)) })
  },
}

/** Groups chats like ChatGPT and Claude: Today, Yesterday, Previous 7 days, Older. */
export function groupChats(chats: Conversation[], now = Date.now()) {
  const startOfToday = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime()
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
