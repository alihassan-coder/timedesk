/**
 * Focus guard: while a timer runs, the desktop app checks which program is in front and nudges the person when it is
 * one they listed as distracting. These are the pure rules, shared by the desktop app (matching), the API (checking
 * uploads, Tempo) and the web app (settings, the dashboard score).
 */

export interface FocusRules {
  /** Program names, for example "Discord" or "Steam". */
  apps: string[]
  /** Words in a browser tab title, for example "YouTube" or "reddit.com". */
  sites: string[]
}

export type FocusVerdict = { kind: 'distracting'; match: string } | { kind: 'ok' }

/** One finished focus session, as the desktop app uploads it. Only names from the person's own lists, never window titles. */
export interface FocusSession {
  /** Made by the desktop app, so a retried upload never stores it twice. */
  id: string
  startedAt: string
  endedAt: string
  /** What the timer was on: the task or project name. */
  label: string
  focusedSeconds: number
  distractedSeconds: number
  /** Time away from the computer during the session. Not counted against the score. */
  awaySeconds: number
  /** How many times a distraction lasted long enough to get a nudge. */
  interruptions: number
  /** The listed apps or sites that took time, largest first. */
  distractions: { name: string; seconds: number }[]
}

/** What the floating timer and the page show while a session runs. */
export interface FocusState {
  /** A focus session is running (Focus guard is on and so is a timer). */
  active: boolean
  /** A Pomodoro break: nothing is counted. */
  onBreak: boolean
  distracted: boolean
  /** The listed app or site in front right now. */
  match: string | null
  /** Seconds on it without a break. */
  streakSeconds: number
  focusedSeconds: number
  distractedSeconds: number
  interruptions: number
  /** Finished sessions waiting to be uploaded. */
  pending: number
}

export const IDLE_FOCUS_STATE: FocusState = {
  active: false,
  onBreak: false,
  distracted: false,
  match: null,
  streakSeconds: 0,
  focusedSeconds: 0,
  distractedSeconds: 0,
  interruptions: 0,
  pending: 0,
}

/** A starting point people can change. Chat and game apps that are often (not always) a distraction. */
export const DEFAULT_FOCUS_APPS = ['Discord', 'Steam', 'WhatsApp', 'Telegram']
export const DEFAULT_FOCUS_SITES = ['YouTube', 'Reddit', 'Instagram', 'Facebook', 'TikTok', 'Netflix']
/** Offered as one-click additions in Settings. */
export const SUGGESTED_FOCUS_APPS = [...DEFAULT_FOCUS_APPS, 'Slack', 'Spotify', 'Epic Games Launcher', 'Battle.net', 'Netflix']
export const SUGGESTED_FOCUS_SITES = [...DEFAULT_FOCUS_SITES, 'Twitch', 'LinkedIn', 'Amazon', 'Hacker News', 'Prime Video', '9GAG']

export const FOCUS_NUDGE_CHOICES = [10, 15, 30, 60, 120] as const
export const DEFAULT_FOCUS_NUDGE_SECONDS = 15
const MAX_ITEMS = 50
const MAX_ITEM_LENGTH = 60

/** Browsers, by words in their program name. Site words are only looked for in a browser's window title. */
const BROWSERS = ['chrome', 'chromium', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc', 'safari', 'zen', 'librewolf', 'waterfox', 'yandex', 'floorp']

const lower = (s: string) => s.trim().toLowerCase()
const programName = (s: string) => lower(s).replace(/\.(exe|app|appimage)$/, '')
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Whole-word match, so "Arc" is not found inside "Search" and "Steam" not inside "Steamroller docs". */
const hasWord = (text: string, word: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(word)}($|[^\\p{L}\\p{N}])`, 'u').test(text)

export function isBrowser(app: string): boolean {
  const name = programName(app)
  return BROWSERS.some((b) => hasWord(name, b) || name === `ms${b}`)
}

/** timedesk itself is never a distraction. */
const isTimedesk = (app: string) => /\btimedesk\b/i.test(app)

/**
 * The words to look for in a tab title for one listed site. "https://www.YouTube.com/feed" and "YouTube" both become
 * ["youtube.com", "youtube"]. A name shorter than 3 letters ("x" from x.com) is only matched as the full address,
 * because a single letter would match far too much.
 */
export function siteWords(site: string): string[] {
  const s = lower(site)
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
  if (!s) return []
  if (!s.includes('.')) return s.length >= 2 ? [s] : []
  const name = s.slice(0, s.lastIndexOf('.'))
  return name.length >= 3 ? [s, name] : [s]
}

/** Is the window in front one of the listed distractions? Returns the listed name it matched, as the person wrote it. */
export function classifyWindow(win: { app: string; title: string }, rules: FocusRules): FocusVerdict {
  if (!win.app || isTimedesk(win.app)) return { kind: 'ok' }
  const app = programName(win.app)
  for (const listed of rules.apps) {
    const want = programName(listed)
    if (want && (app === want || (want.length >= 3 && hasWord(app, want)))) return { kind: 'distracting', match: listed.trim() }
  }
  if (isBrowser(win.app)) {
    const title = lower(win.title)
    for (const listed of rules.sites) {
      if (siteWords(listed).some((w) => hasWord(title, w))) return { kind: 'distracting', match: listed.trim() }
    }
  }
  return { kind: 'ok' }
}

/** Cleans a list from settings: trimmed, no blanks or repeats (ignoring case), short items, a sensible maximum. */
export function sanitizeFocusList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string') continue
    const item = v.trim().replace(/\s+/g, ' ').slice(0, MAX_ITEM_LENGTH)
    if (!item || seen.has(item.toLowerCase())) continue
    seen.add(item.toLowerCase())
    out.push(item)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

/** Share of the session spent on work rather than listed distractions, 0 to 100. Time away does not count. Null when nothing was measured. */
export function focusScore(focusedSeconds: number, distractedSeconds: number): number | null {
  const total = focusedSeconds + distractedSeconds
  return total > 0 ? Math.round((focusedSeconds / total) * 100) : null
}

export interface FocusSummary {
  sessions: number
  focusedSeconds: number
  distractedSeconds: number
  awaySeconds: number
  interruptions: number
  score: number | null
  /** The listed apps and sites that took the most time, largest first. */
  topDistractions: { name: string; seconds: number }[]
}

type SummaryInput = Pick<FocusSession, 'focusedSeconds' | 'distractedSeconds' | 'awaySeconds' | 'interruptions' | 'distractions'>

/** Adds sessions up, for a day, a week or any range. */
export function summarizeFocus(sessions: SummaryInput[], top = 5): FocusSummary {
  const by = new Map<string, { name: string; seconds: number }>()
  let focused = 0
  let distracted = 0
  let away = 0
  let interruptions = 0
  for (const s of sessions) {
    focused += s.focusedSeconds
    distracted += s.distractedSeconds
    away += s.awaySeconds
    interruptions += s.interruptions
    for (const d of s.distractions) {
      const key = d.name.toLowerCase()
      const cur = by.get(key)
      if (cur) cur.seconds += d.seconds
      else by.set(key, { name: d.name, seconds: d.seconds })
    }
  }
  return {
    sessions: sessions.length,
    focusedSeconds: focused,
    distractedSeconds: distracted,
    awaySeconds: away,
    interruptions,
    score: focusScore(focused, distracted),
    topDistractions: [...by.values()].sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name)).slice(0, top),
  }
}
