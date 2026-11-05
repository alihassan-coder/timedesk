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

const HOUR = 3_600_000
const DAY = 24 * HOUR
const KEY = 'timedesk:chats'

/** Dummy history so the review shows a populated sidebar. Replaced by real saved chats. */
function seed(now: number): Conversation[] {
  const m = (role: ChatMessage['role'], text: string, tools?: ToolTrace[]): ChatMessage => ({ id: crypto.randomUUID(), role, text, tools })
  return [
    {
      id: 'c1',
      title: 'Plan my week',
      updatedAt: now - 2 * HOUR,
      messages: [
        m('user', 'Plan my week around what is due and keep Friday light.'),
        m(
          'assistant',
          'Here is a plan that keeps Friday light:\n\nMon: finish the pricing table fix and send the Acme invoice (both overdue).\nTue: hero copy and PR reviews.\nWed: Acme sprint demo prep.\nThu: Capacitor Android build.\nFri: weekly review only.\n\nWant me to put these on your task list with due dates?',
          [
            { name: 'list_tasks', summary: 'Looked up 15 open tasks' },
            { name: 'time_report', summary: 'Checked last week: 29h 57m tracked' },
          ],
        ),
        m('user', 'Yes, do it.'),
        m('assistant', 'Done. I set due dates on 5 tasks and added "Weekly review" for Friday.', [
          { name: 'set_task_status', summary: 'Updated 5 tasks' },
          { name: 'create_task', summary: 'Created "Weekly review"' },
        ]),
      ],
    },
    { id: 'c2', title: 'Acme invoice follow-up', updatedAt: now - 1 * DAY - HOUR, messages: [m('user', 'Draft a short follow-up about the Acme invoice.'), m('assistant', 'Hi team, a quick note that invoice #1042 is now due. Let me know if you need anything from our side.')] },
    { id: 'c3', title: 'How much time on the mobile app?', updatedAt: now - 3 * DAY, messages: [m('user', 'How much time on the mobile app this month?'), m('assistant', '10h 34m this month, 36% of everything you tracked.', [{ name: 'time_report', summary: 'Built a monthly report' }])] },
    { id: 'c4', title: 'Remember my working hours', updatedAt: now - 6 * DAY, messages: [m('user', 'I work 9 to 5, Sunday to Thursday.'), m('assistant', 'Saved. I will plan around Sunday to Thursday, 9 to 5.', [{ name: 'remember', summary: 'Saved to memory' }])] },
    { id: 'c5', title: 'Ideas for the dashboard', updatedAt: now - 20 * DAY, messages: [m('user', 'Ideas to make the dashboard more useful?'), m('assistant', 'Show a daily goal ring, streaks, and what is due before your next meeting.')] },
  ]
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    // blocked or corrupt storage
  }
  return { conversations: seed(Date.now()), activeId: null }
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
