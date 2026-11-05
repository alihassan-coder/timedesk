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
  /** One of the chart palette slots, 1 to 5. */
  color: 1 | 2 | 3 | 4 | 5
  description: string
}

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
}

/** One tracked block of time. endedAt === null means the timer is running. */
export interface TimeEntry {
  id: string
  taskId: string | null
  projectId: string | null
  startedAt: number // epoch ms
  endedAt: number | null
}

export type ReportPeriod = 'day' | 'month' | 'quarter' | 'year'

export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'later' | 'none'
