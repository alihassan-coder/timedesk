/** A todo item. Ids are client-generated so records can be created offline. */
export interface Task {
  id: string
  title: string
  done: boolean
  createdAt: number // epoch ms
}

/** One tracked block of time. endedAt === null means the timer is running. */
export interface TimeEntry {
  id: string
  taskId: string | null // null = free stopwatch, not attached to a task
  startedAt: number // epoch ms
  endedAt: number | null
}

export type ReportPeriod = 'day' | 'month' | 'quarter' | 'year'
