import { toDateKey, type Project, type Task, type TimeEntry } from '@timedesk/shared'

/**
 * DUMMY DATA for design review. Everything is generated relative to "now" so the charts
 * always look alive. Replaced by real synced data in phase 2.
 */

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const projects: Project[] = [
  { id: 'p1', name: 'Website redesign', color: 3, description: 'New marketing site and pricing page' },
  { id: 'p2', name: 'Mobile app', color: 2, description: 'Capacitor build of the web app' },
  { id: 'p3', name: 'Client: Acme', color: 4, description: 'Dashboard work for Acme Ltd' },
  { id: 'p4', name: 'Learning', color: 1, description: 'Courses, reading and side experiments' },
  { id: 'p5', name: 'Admin and meetings', color: 5, description: 'Planning, calls and email' },
]

const dateIn = (days: number, now: number) => toDateKey(now + days * DAY)

export function buildTasks(now: number): Task[] {
  const t = (
    id: string,
    title: string,
    projectId: string | null,
    status: Task['status'],
    priority: Task['priority'],
    due: number | null,
    recurrence: Task['recurrence'] = null,
  ): Task => ({
    id,
    title,
    projectId,
    status,
    priority,
    due: due === null ? null : dateIn(due, now),
    recurrence,
    createdAt: now - 6 * DAY,
  })
  return [
    t('t1', 'Send invoice to Acme', 'p3', 'todo', 'high', -2),
    t('t2', 'Fix pricing table on mobile', 'p1', 'in_progress', 'high', -1),
    t('t3', 'Write homepage hero copy', 'p1', 'in_progress', 'medium', 0),
    t('t4', 'Daily standup notes', 'p5', 'todo', 'low', 0, { freq: 'daily' }),
    t('t5', 'Review pull requests', 'p2', 'todo', 'medium', 0),
    t('t6', 'Plan push notification flow', 'p2', 'todo', 'medium', 1),
    t('t7', 'Prepare Acme sprint demo', 'p3', 'todo', 'high', 1),
    t('t8', 'Weekly review', 'p5', 'todo', 'medium', 4, { freq: 'weekly' }),
    t('t9', 'Set up Capacitor Android build', 'p2', 'todo', 'medium', 3),
    t('t10', 'Finish React Aria course module 4', 'p4', 'todo', 'low', 5),
    t('t11', 'Pay monthly hosting', 'p5', 'todo', 'medium', 6, { freq: 'monthly' }),
    t('t12', 'Design empty states', 'p1', 'todo', 'low', 10),
    t('t13', 'Research PowerSync pricing', 'p4', 'todo', 'low', 16),
    t('t14', 'Book dentist', null, 'todo', 'low', null),
    t('t15', 'Ideas: keyboard shortcuts', null, 'todo', 'low', null),
    t('t16', 'Update README', 'p2', 'done', 'low', -3),
    t('t17', 'Fix login redirect bug', 'p3', 'done', 'high', -1),
    t('t18', 'Reply to design feedback', 'p1', 'done', 'medium', 0),
  ]
}

/** About 8 weeks of believable work blocks, ending with a few blocks earlier today. */
export function buildEntries(now: number): TimeEntry[] {
  const rand = rng(7)
  const tasks = buildTasks(now)
  const weights: [string, number][] = [['p1', 3], ['p2', 3], ['p3', 3], ['p4', 1], ['p5', 1.5]]
  const pick = () => {
    const total = weights.reduce((s, [, w]) => s + w, 0)
    let r = rand() * total
    for (const [id, w] of weights) if ((r -= w) <= 0) return id
    return 'p1'
  }
  const entries: TimeEntry[] = []
  let n = 0
  const add = (projectId: string, start: number, end: number) => {
    const forProject = tasks.filter((t) => t.projectId === projectId)
    const task = forProject.length ? forProject[Math.floor(rand() * forProject.length)] : null
    entries.push({ id: `e${n++}`, taskId: task?.id ?? null, projectId, startedAt: start, endedAt: end })
  }

  const today = new Date(now)
  for (let back = 56; back >= 1; back--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)
    const dow = day.getDay()
    if (dow === 0 || (dow === 6 && rand() > 0.15)) continue
    const blocks = 3 + Math.floor(rand() * 3)
    let cursor = day.getTime() + (8.5 + rand() * 1.5) * HOUR
    for (let i = 0; i < blocks; i++) {
      const len = (35 + Math.floor(rand() * 90)) * MIN
      add(pick(), cursor, cursor + len)
      cursor += len + (10 + Math.floor(rand() * 50)) * MIN
    }
  }

  // Earlier today, ending before now, only when they fit inside today.
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const todayBlocks: [string, number, number][] = [
    ['p1', 200, 75],
    ['p5', 110, 25],
    ['p2', 70, 40],
  ] // [project, minutes before now when it ENDS, length in minutes]
  for (const [p, endsAgo, len] of todayBlocks) {
    const end = now - endsAgo * MIN
    const start = end - len * MIN
    if (start > startOfDay) add(p, start, end)
  }
  return entries
}

export const team = [
  { id: 'u1', name: 'You', initials: 'YO' },
  { id: 'u2', name: 'Sara Khan', initials: 'SK' },
  { id: 'u3', name: 'Omar Ali', initials: 'OA' },
  { id: 'u4', name: 'Hina Malik', initials: 'HM' },
]

export interface ChatMessage {
  id: string
  channelId: string
  userId: string
  text: string
  at: number
}

export const channels = [
  { id: 'general', name: 'general' },
  { id: 'p1', name: 'website-redesign' },
  { id: 'p2', name: 'mobile-app' },
]

export function buildMessages(now: number): ChatMessage[] {
  const m = (id: string, channelId: string, userId: string, text: string, minsAgo: number): ChatMessage => ({
    id, channelId, userId, text, at: now - minsAgo * MIN,
  })
  return [
    m('m1', 'general', 'u2', 'Morning all. Standup at 10:00, notes go in the shared task.', 190),
    m('m2', 'general', 'u3', 'I will be 5 minutes late, joining from the train.', 175),
    m('m3', 'general', 'u1', 'No problem. I will start with the website update.', 170),
    m('m4', 'general', 'u4', 'Reminder: Acme invoice is due, can someone confirm the hours?', 95),
    m('m5', 'p1', 'u2', 'Pricing table is overflowing on small phones. I logged it as a high priority task.', 300),
    m('m6', 'p1', 'u1', 'On it. I will use a stacked layout under 640px.', 280),
    m('m7', 'p1', 'u4', 'Hero copy draft is in the doc. Feedback welcome.', 60),
    m('m8', 'p2', 'u3', 'Android build passes locally. iOS needs the developer account first.', 420),
    m('m9', 'p2', 'u1', 'Let us keep push notifications for the next sprint.', 400),
  ]
}

export const activity = (now: number) => [
  { id: 'a1', who: 'Sara Khan', text: 'completed', target: 'Reply to design feedback', at: now - 25 * MIN },
  { id: 'a2', who: 'You', text: 'tracked 1h 15m on', target: 'Website redesign', at: now - 50 * MIN },
  { id: 'a3', who: 'Omar Ali', text: 'commented on', target: 'Set up Capacitor Android build', at: now - 2 * HOUR },
  { id: 'a4', who: 'Hina Malik', text: 'created task', target: 'Design empty states', at: now - 5 * HOUR },
  { id: 'a5', who: 'You', text: 'completed', target: 'Fix login redirect bug', at: now - 1 * DAY },
  { id: 'a6', who: 'Sara Khan', text: 'moved to In progress', target: 'Fix pricing table on mobile', at: now - 1 * DAY - 2 * HOUR },
  { id: 'a7', who: 'Omar Ali', text: 'tracked 2h 40m on', target: 'Mobile app', at: now - 2 * DAY },
  { id: 'a8', who: 'You', text: 'completed', target: 'Update README', at: now - 3 * DAY },
]

export const calendarEvents = (now: number) => {
  const d = new Date(now)
  const at = (dayOffset: number, h: number, min = 0) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, h, min).getTime()
  return [
    { id: 'c1', title: 'Team standup', start: at(0, 10), end: at(0, 10, 15), kind: 'meeting' as const },
    { id: 'c2', title: 'Design review with Sara', start: at(0, 14), end: at(0, 15), kind: 'meeting' as const },
    { id: 'c3', title: 'Acme sprint demo', start: at(1, 11), end: at(1, 12), kind: 'meeting' as const },
    { id: 'c4', title: 'Team standup', start: at(1, 10), end: at(1, 10, 15), kind: 'meeting' as const },
    { id: 'c5', title: 'Dentist', start: at(2, 17), end: at(2, 18), kind: 'personal' as const },
    { id: 'c6', title: 'Weekly review', start: at(4, 16), end: at(4, 17), kind: 'focus' as const },
    { id: 'c7', title: 'Deep work: hero copy', start: at(0, 16, 30), end: at(0, 18), kind: 'focus' as const },
  ].sort((a, b) => a.start - b.start)
}

/** What the desktop app would report. Shown on web as a locked preview. */
export const appUsage = [
  { name: 'VS Code', category: 'Coding', minutes: 168 },
  { name: 'Chrome', category: 'Browsing', minutes: 112 },
  { name: 'Figma', category: 'Design', minutes: 55 },
  { name: 'Slack', category: 'Communication', minutes: 36 },
  { name: 'Windows Terminal', category: 'Coding', minutes: 31 },
  { name: 'Google Meet', category: 'Meetings', minutes: 24 },
]

export const siteUsage = [
  { name: 'github.com', minutes: 41 },
  { name: 'developer.mozilla.org', minutes: 22 },
  { name: 'figma.com', minutes: 19 },
  { name: 'youtube.com', minutes: 12 },
  { name: 'mail.google.com', minutes: 9 },
]

export const notifications = (now: number) => [
  { id: 'n1', title: 'Fix pricing table on mobile is overdue', at: now - 20 * MIN, unread: true },
  { id: 'n2', title: 'Standup in 15 minutes', at: now - 2 * HOUR, unread: true },
  { id: 'n3', title: 'Sara commented on Update README', at: now - 1 * DAY, unread: false },
]
