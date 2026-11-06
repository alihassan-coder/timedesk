import { addDays, startOfWeek } from './calendar.ts'
import { toDateKey } from './tasks.ts'
import type { Priority } from './types.ts'

export interface QuickAddResult {
  title: string
  /** YYYY-MM-DD or null. */
  due: string | null
  priority: Priority
  projectId: string | null
  /** What was understood, in words, for showing as chips ("Tomorrow", "High", "#Website"). */
  hints: string[]
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const SHORT: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 }

const PRIORITY_WORDS: Record<string, Priority> = {
  high: 'high', h: 'high', urgent: 'high', '!': 'high',
  medium: 'medium', med: 'medium', m: 'medium',
  low: 'low', l: 'low',
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function weekdayIndex(word: string): number | null {
  const w = word.toLowerCase()
  const full = WEEKDAYS.indexOf(w)
  if (full >= 0) return full
  return w in SHORT ? SHORT[w] : null
}

/** The next date (strictly after today) that falls on `weekday` (0 = Sunday). */
function nextWeekday(today: string, weekday: number): string {
  for (let i = 1; i <= 7; i++) {
    const key = addDays(today, i)
    const [y, m, d] = key.split('-').map(Number)
    if (new Date(y, m - 1, d).getDay() === weekday) return key
  }
  return today
}

const label = (due: string, today: string) => (due === today ? 'Today' : due === addDays(today, 1) ? 'Tomorrow' : due)

/**
 * Turns a line typed in "quick add" into a task. It understands, anywhere in the text:
 *   dates     today, tomorrow, tmr, monday ... sun, next week, in 3 days, in 2 weeks, 2026-11-20
 *   priority  !high  !low  !medium (or !h !l !m)
 *   project   #website  (matches a project name by its start, ignoring case and spaces)
 * Whatever is not understood stays in the title.
 */
export function parseQuickAdd(input: string, ctx: { now: number; projects: { id: string; name: string }[] }): QuickAddResult {
  const today = toDateKey(ctx.now)
  let text = ` ${input.trim()} `
  let due: string | null = null
  let priority: Priority = 'medium'
  let projectId: string | null = null
  const hints: string[] = []
  const take = (re: RegExp, on: (m: RegExpMatchArray) => boolean) => {
    const m = text.match(re)
    if (m && on(m)) text = text.replace(re, ' ')
  }

  // priority: !high
  take(/\s!(\w+|!)(?=\s)/i, (m) => {
    const p = PRIORITY_WORDS[m[1].toLowerCase()]
    if (!p) return false
    priority = p
    if (p !== 'medium') hints.push(p === 'high' ? 'High' : 'Low')
    return true
  })

  // project: #name
  take(/\s#([^\s#]+)(?=\s)/, (m) => {
    const want = norm(m[1])
    if (!want) return false
    const hit = ctx.projects.find((p) => norm(p.name) === want) ?? ctx.projects.find((p) => norm(p.name).startsWith(want))
    if (!hit) return false
    projectId = hit.id
    hints.push(`#${hit.name}`)
    return true
  })

  // dates, most specific first
  take(/\s(\d{4}-\d{2}-\d{2})(?=\s)/, (m) => {
    const [y, mo, d] = m[1].split('-').map(Number)
    const check = new Date(y, mo - 1, d)
    if (check.getFullYear() !== y || check.getMonth() !== mo - 1 || check.getDate() !== d) return false
    due = m[1]
    return true
  })
  if (!due) {
    take(/\sin\s+(\d{1,3})\s+(day|days|week|weeks)(?=\s)/i, (m) => {
      const n = Number(m[1])
      due = addDays(today, /week/i.test(m[2]) ? n * 7 : n)
      return true
    })
  }
  if (!due) {
    take(/\snext\s+week(?=\s)/i, () => {
      due = addDays(startOfWeek(today), 7)
      return true
    })
  }
  if (!due) {
    take(/\s(today|tonight|tomorrow|tmr|tom)(?=\s)/i, (m) => {
      due = /^to(day|night)/i.test(m[1]) ? today : addDays(today, 1)
      return true
    })
  }
  if (!due) {
    // a weekday name, optionally after "on" or "next"
    const words = text.trim().split(/\s+/)
    const i = words.findIndex((w) => weekdayIndex(w) !== null)
    if (i >= 0) {
      due = nextWeekday(today, weekdayIndex(words[i])!)
      const from = i > 0 && /^(on|next)$/i.test(words[i - 1]) ? i - 1 : i
      words.splice(from, i - from + 1)
      text = ` ${words.join(' ')} `
    }
  }
  if (due) hints.unshift(label(due, today))

  const title = text.replace(/\s+/g, ' ').trim()
  return { title, due, priority, projectId, hints }
}
