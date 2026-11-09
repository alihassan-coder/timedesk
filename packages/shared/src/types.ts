export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type Priority = 'low' | 'medium' | 'high'

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'custom'
  /** custom only: repeat every N days */
  every?: number
}

export interface Project {
  id: string
  name: string
  /** One of the preset colours (see PROJECT_COLOR_COUNT). Used when there is no custom colour. */
  color: number
  /** A colour the person picked, as #rrggbb. Wins over the preset. */
  customColor?: string | null
  description: string
}

/** How many preset project colours there are (numbered from 1). */
export const PROJECT_COLOR_COUNT = 12

/** A custom project colour: #rrggbb. */
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** A todo. Ids are client-generated so records can be created offline. */
export interface Task {
  id: string
  title: string
  projectId: string | null
  status: TaskStatus
  priority: Priority
  /** Local calendar date, YYYY-MM-DD, or null for "no date". */
  due: string | null
  recurrence: Recurrence | null
  createdAt: number // epoch ms
  /** When it was marked done (epoch ms), or null while it is open. */
  completedAt: number | null
  /** One of the day's top 3: the day (YYYY-MM-DD) and its place (1 to 3). Null when it is not picked. */
  topDay?: string | null
  topRank?: number | null
}

/** How many tasks a day's top list holds. */
export const TOP_TASKS = 3

/** One tracked block of time. endedAt === null means the timer is running. */
export interface TimeEntry {
  id: string
  taskId: string | null
  projectId: string | null
  startedAt: number // epoch ms
  endedAt: number | null
  /**
   * Only on pieces made by splitParallel: the part of this time that counts for this timer (1/k while k timers ran
   * at once). Real entries never have it.
   */
  share?: number
}

export type ReportPeriod = 'day' | 'month' | 'quarter' | 'year'

export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'later' | 'none'
