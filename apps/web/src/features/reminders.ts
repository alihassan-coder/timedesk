import { useEffect } from 'react'
import { dueBucket, toDateKey } from '@timedesk/shared'
import { useStore } from '@/data/store'
import { notify, useNotifyPrefs } from '@/lib/notify'

const FOUR_HOURS = 4 * 3_600_000
const KEY_PREFIX = 'timedesk:notified:'

/** Remembers what was already announced today, so a reminder never repeats and survives a restart. */
function loadSent(day: string): Set<string> {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(KEY_PREFIX) && k !== KEY_PREFIX + day) localStorage.removeItem(k)
    }
    return new Set(JSON.parse(localStorage.getItem(KEY_PREFIX + day) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
function saveSent(day: string, sent: Set<string>) {
  try {
    localStorage.setItem(KEY_PREFIX + day, JSON.stringify([...sent]))
  } catch {
    // ignore
  }
}

/** Due-date reminders and the "timer left running" warning. Works in the browser (with permission) and in the desktop app. */
export function useReminders() {
  const { tasks, entries, ready } = useStore()
  const prefs = useNotifyPrefs()

  useEffect(() => {
    if (!ready) return

    const check = async () => {
      const now = Date.now()
      const day = toDateKey(now)
      const sent = loadSent(day)
      const announce = async (id: string, title: string, body: string) => {
        if (sent.has(id)) return
        if (await notify(title, body)) {
          sent.add(id)
          saveSent(day, sent)
        }
      }

      if (prefs.dueReminders) {
        const open = tasks.filter((t) => t.status !== 'done')
        for (const t of open.filter((x) => dueBucket(x.due, now) === 'today')) await announce(`due:${t.id}`, 'Due today', t.title)
        const overdue = open.filter((x) => dueBucket(x.due, now) === 'overdue')
        if (overdue.length > 0) await announce('overdue-summary', `${overdue.length} overdue ${overdue.length === 1 ? 'task' : 'tasks'}`, overdue.slice(0, 3).map((t) => t.title).join(', '))
      }

      if (prefs.longTimer) {
        const running = entries.find((e) => e.endedAt === null)
        if (running && now - running.startedAt > FOUR_HOURS) await announce(`long:${running.id}`, 'Timer still running', 'Your timer has been running for more than 4 hours.')
      }
    }

    void check()
    const t = setInterval(() => void check(), 60_000)
    return () => clearInterval(t)
  }, [tasks, entries, ready, prefs])
}
