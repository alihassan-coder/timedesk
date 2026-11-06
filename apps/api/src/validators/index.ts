import { z } from 'zod'
import { isValidTimeZone, startOfWeek } from '@timedesk/shared'

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const recurrence = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'custom']),
  every: z.number().int().min(1).max(365).optional(),
})

export const idParam = z.object({ id: z.string().min(1) })
export const eventIdParam = z.object({ id: z.string().min(1).max(256) })

/**
 * Create and update schemas share the same field rules but NOT the defaults. An update must only change
 * the fields that were sent: a partial() of a schema with .default() would quietly reset every missing
 * field (the due date, priority, project...) to its default on every PATCH.
 */
const projectFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500),
  color: z.number().int().min(1).max(5),
}
export const createProject = z.object({
  id: z.string().min(1).optional(),
  name: projectFields.name,
  description: projectFields.description.default(''),
  color: projectFields.color.default(1),
})
export const updateProject = z.object(projectFields).partial()

const taskFields = {
  title: z.string().trim().min(1).max(300),
  projectId: z.string().nullable(),
  status: z.enum(['todo', 'in_progress', 'done']),
  priority: z.enum(['low', 'medium', 'high']),
  due: dateKey.nullable(),
  recurrence: recurrence.nullable(),
}
export const createTask = z.object({
  id: z.string().min(1).optional(),
  title: taskFields.title,
  projectId: taskFields.projectId.default(null),
  status: taskFields.status.default('todo'),
  priority: taskFields.priority.default('medium'),
  due: taskFields.due.default(null),
  recurrence: taskFields.recurrence.default(null),
})
export const updateTask = z.object(taskFields).partial()
export const taskQuery = z.object({ status: z.enum(['todo', 'in_progress', 'done']).optional() })

export const startTimer = z.object({
  taskId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
})
/** Stopping can name the moment the work really ended (for example when the person went idle). */
export const stopTimer = z.object({ endedAt: z.coerce.date().optional() })
export const timeRange = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })

export const userStatusQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending') })

export const aiProviders = ['openai', 'anthropic', 'google', 'groq', 'xai'] as const
export const aiProviderParam = z.object({ provider: z.enum(aiProviders) })
export const saveAiKey = z.object({ key: z.string().trim().min(8).max(500) })

export const chatBody = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
  provider: z.enum(aiProviders),
  model: z.string().min(1).max(120),
  /** The person's IANA time zone, so Tempo knows their today. The server's own zone is used without it. */
  timeZone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone.').optional(),
})

export const saveChat = z.object({
  title: z.string().trim().min(1).max(200),
  messages: z
    .array(z.object({ id: z.string().min(1), role: z.enum(['user', 'assistant', 'system']), parts: z.array(z.unknown()) }))
    .max(500),
})

/** Only known preference groups, each a plain object, so a client cannot park arbitrary data here. */
export const settingsPatch = z
  .object({
    appearance: z.record(z.string(), z.unknown()).optional(),
    aiPrefs: z.record(z.string(), z.unknown()).optional(),
    notifications: z.record(z.string(), z.unknown()).optional(),
    desktop: z.record(z.string(), z.unknown()).optional(),
    timer: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((v) => JSON.stringify(v).length < 20_000, 'Settings are too large.')

export const activitySessionsQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  app: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
})

export const activityBatch = z.object({
  samples: z
    .array(
      z.object({
        id: z.string().min(8).max(64),
        app: z.string().trim().min(1).max(120),
        title: z.string().max(300).default(''),
        startedAt: z.coerce.date(),
        seconds: z.number().int().min(1).max(3600),
      }),
    )
    .min(1)
    .max(500),
})

const seconds = z.number().int().min(0).max(86_400)
/** Finished Focus guard sessions from the desktop app. A session ends after it starts, within a week (a timer left running overnight still counts). */
export const focusBatch = z.object({
  sessions: z
    .array(
      z
        .object({
          id: z.string().min(8).max(64),
          startedAt: z.coerce.date(),
          endedAt: z.coerce.date(),
          label: z.string().max(200).default(''),
          focusedSeconds: seconds,
          distractedSeconds: seconds,
          awaySeconds: seconds.default(0),
          interruptions: z.number().int().min(0).max(10_000).default(0),
          distractions: z
            .array(z.object({ name: z.string().trim().min(1).max(120), seconds }))
            .max(10)
            .default([]),
        })
        .refine((s) => s.endedAt >= s.startedAt && s.endedAt.getTime() - s.startedAt.getTime() <= 7 * 86_400_000, 'A session must end after it starts, within a week.'),
    )
    .min(1)
    .max(100),
})

export type ActivityBatch = z.infer<typeof activityBatch>
export type FocusBatch = z.infer<typeof focusBatch>
export type SaveChat = z.infer<typeof saveChat>
export type CreateProject = z.infer<typeof createProject>
export type UpdateProject = z.infer<typeof updateProject>
export type CreateTask = z.infer<typeof createTask>
export type UpdateTask = z.infer<typeof updateTask>
export type StartTimer = z.infer<typeof startTimer>
export type AiProvider = (typeof aiProviders)[number]

// ---- Google Calendar ----
const dayOnly = /^\d{4}-\d{2}-\d{2}$/
const calendarWhen = z.string().refine((v) => dayOnly.test(v) || !Number.isNaN(Date.parse(v)), 'Use a date (YYYY-MM-DD) or a date and time')

export const googleConnectBody = z.object({ desktop: z.boolean().default(false) })
export const googleSettingsPatch = z.object({ pushTasks: z.boolean() }).strict()

export const calendarRange = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((r) => r.to > r.from && r.to.getTime() - r.from.getTime() <= 400 * 86_400_000, 'Ask for a range of up to about a year.')

const eventFields = {
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000),
  /** A date (YYYY-MM-DD) for an all-day event, or a date and time. For all-day events the end is the first day after the event. */
  start: calendarWhen,
  end: calendarWhen,
  /** Optional. Inferred from the format of `start` when left out. */
  allDay: z.boolean(),
  /** IANA name such as Europe/London, for times written without an offset. */
  timeZone: z.string().max(64),
}
const endAfterStart = (start: string, end: string) => (dayOnly.test(start) ? end > start : Date.parse(end) > Date.parse(start))
const consistent = (v: { start?: string; end?: string; allDay?: boolean }) => {
  const kind = (s?: string) => (s === undefined ? undefined : dayOnly.test(s))
  const dates = [kind(v.start), kind(v.end)].filter((k) => k !== undefined)
  if (dates.length === 2 && dates[0] !== dates[1]) return false
  if (v.allDay !== undefined && dates.some((d) => d !== v.allDay)) return false
  return true
}
export const createCalendarEvent = z
  .object({ title: eventFields.title, description: eventFields.description.default(''), start: eventFields.start, end: eventFields.end.optional(), allDay: eventFields.allDay.optional(), timeZone: eventFields.timeZone.optional() })
  .refine(consistent, 'Use dates for all-day events and date-times for timed ones, not a mix.')
  .refine((v) => !v.end || endAfterStart(v.start, v.end), 'The end must be after the start.')
export const updateCalendarEvent = z
  .object({ title: eventFields.title.optional(), description: eventFields.description.optional(), start: eventFields.start.optional(), end: eventFields.end.optional(), allDay: eventFields.allDay.optional(), timeZone: eventFields.timeZone.optional() })
  .refine(consistent, 'Use dates for all-day events and date-times for timed ones, not a mix.')
  .refine((v) => v.end === undefined || v.start !== undefined, 'Give a start when you give an end.')
  .refine((v) => !v.start || !v.end || endAfterStart(v.start, v.end), 'The end must be after the start.')

export type CreateCalendarEvent = z.infer<typeof createCalendarEvent>
export type UpdateCalendarEvent = z.infer<typeof updateCalendarEvent>

// ---- Weekly reviews and the account ----
const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/
export const weekParam = z.object({
  week: z
    .string()
    .regex(dateKeyRe, 'Use the Monday of the week as YYYY-MM-DD.')
    .refine((k) => !Number.isNaN(Date.parse(k)) && startOfWeek(k) === k, 'A week is named by its Monday (YYYY-MM-DD).'),
})
export const saveReview = z
  .object({
    wentWell: z.string().max(4000).default(''),
    improve: z.string().max(4000).default(''),
  })
  .strict()
export const reviewsQuery = z.object({ limit: z.coerce.number().int().min(1).max(52).default(12) })
export const deleteAccount = z.object({ password: z.string().min(1).max(200) }).strict()
