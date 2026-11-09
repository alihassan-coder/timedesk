import { useEffect, useRef } from 'react'
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

// One check at a time across the app: two overlapping checks would both see a reminder as unsent and show it twice.
let checking = false

/** Due-date reminders and the "timer left running" warning. Works in the browser (with permission) and in the desktop app. */
export function useReminders() {
  const { tasks, entries, ready } = useStore()
  const prefs = useNotifyPrefs()
  // The check reads the latest data through a ref, so it runs once a minute instead of on every change.
  const latest = useRef({ tasks, entries, prefs })
  useEffect(() => {
    latest.current = { tasks, entries, prefs }
  })

  useEffect(() => {
    if (!ready) return
    const run = { cancelled: false }

    const check = async () => {
      if (checking) return
      checking = true
      try {
        const { tasks, entries, prefs } = latest.current
        const now = Date.now()
        const day = toDateKey(now)
        const sent = loadSent(day)
        const announce = async (id: string, title: string, body: string) => {
          if (run.cancelled || sent.has(id)) return
          // Marked before the await, so nothing else can announce it in the meantime.
          sent.add(id)
          if (await notify(title, body)) saveSent(day, sent)
          else sent.delete(id) // not allowed to show it: try again later
        }

        if (prefs.dueReminders) {
          const open = tasks.filter((t) => t.status !== 'done')
          for (const t of open.filter((x) => dueBucket(x.due, now) === 'today')) await announce(`due:${t.id}`, 'Due today', t.title)
          const overdue = open.filter((x) => dueBucket(x.due, now) === 'overdue')
          if (overdue.length > 0) await announce('overdue-summary', `${overdue.length} overdue ${overdue.length === 1 ? 'task' : 'tasks'}`, overdue.slice(0, 3).map((t) => t.title).join(', '))
        }

        if (prefs.longTimer) {
          // Several timers can run at once: warn about each one left on.
          for (const running of entries.filter((e) => e.endedAt === null && now - e.startedAt > FOUR_HOURS)) {
            await announce(`long:${running.id}`, 'Timer still running', 'Your timer has been running for more than 4 hours.')
          }
        }
      } finally {
        checking = false
      }
    }

    void check()
    const t = setInterval(() => void check(), 60_000)
    return () => {
      run.cancelled = true
      clearInterval(t)
    }
  }, [ready])
}
