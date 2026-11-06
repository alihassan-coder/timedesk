import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, tool, type UIMessage } from 'ai'
import { z } from 'zod'
import {
  addDays,
  buildDigest,
  dailyTotals,
  dueBucketOn,
  formatHours,
  overlapMs,
  periodStart,
  planCandidates,
  startOfWeek,
  toDateKey,
  zonedDateKey,
  zonedDays,
  zonedHour,
  type DigestTask,
} from '@timedesk/shared'
import type { ModelFactory } from '../lib/models.ts'
import { listModels, PROVIDER_NAMES } from '../lib/models.ts'
import type { MemoryProvider } from '../lib/memory.ts'
import type { SessionUser } from '../types.ts'
import { AppError, badRequest } from '../utils/errors.ts'
import type { AiProvider } from '../validators/index.ts'
import { aiProviders } from '../validators/index.ts'
import type { ActivityService } from './activity.service.ts'
import type { FocusService } from './focus.service.ts'
import type { AiKeyService } from './ai-key.service.ts'
import type { GoogleCalendarService } from './google-calendar.service.ts'
import type { ProjectService } from './project.service.ts'
import type { ReviewService } from './review.service.ts'
import type { SettingsService } from './settings.service.ts'
import type { TaskService } from './task.service.ts'
import type { TimeService } from './time.service.ts'

interface Parts {
  aiKeys: AiKeyService
  projects: ProjectService
  tasks: TaskService
  time: TimeService
  /** Google Calendar. When the person has connected it, Tempo gets calendar tools. */
  calendar?: GoogleCalendarService
  /** Weekly reflections, daily goal and app usage feed the summaries. Optional so small tests can leave them out. */
  reviews?: ReviewService
  settings?: SettingsService
  activity?: ActivityService
  /** Focus guard sessions from the desktop app. */
  focus?: FocusService
  models: ModelFactory
  memory: MemoryProvider
  now?: () => Date
}

/** The time zone this server runs in: the fallback when the app did not say which zone the person is in. */
const SERVER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const DEFAULT_GOAL_MINUTES = 360

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date as YYYY-MM-DD in the user's local time")

const timeOfDay = z.string().regex(/^\d{2}:\d{2}$/).describe('Time as HH:mm, 24 hour')

/** Google Calendar tools. Only offered when the person has connected their calendar. */
function calendarTools(user: SessionUser, calendar: GoogleCalendarService) {
  /** A problem from Google or the calendar service goes back to the model as a message, so it can tell the person. */
  const guard = async <T>(run: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await run()
    } catch (e) {
      if (e instanceof AppError) return { error: e.message }
      throw e
    }
  }
  const brief = (e: { id: string; title: string; start: string; end: string; allDay: boolean; description: string }) => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    ...(e.description ? { description: e.description.slice(0, 200) } : {}),
  })
  /** Turns the model's simple fields into the start and end the calendar service wants. */
  function when(a: { date: string; endDate?: string; startTime?: string; endTime?: string; timeZone?: string }) {
    if (!a.startTime) return { start: a.date, end: a.endDate ? addDays(a.endDate, 1) : undefined, allDay: true as const }
    if (!a.timeZone) return null
    return {
      start: `${a.date}T${a.startTime}:00`,
      end: a.endTime ? `${a.endDate ?? a.date}T${a.endTime}:00` : undefined,
      allDay: false as const,
      timeZone: a.timeZone,
    }
  }
  const NEEDS_ZONE = { error: 'A time needs a time zone (for example Europe/London). Ask the user for it, or make the event all-day.' }

  return {
    list_calendar_events: tool({
      description: "List the user's Google Calendar events between two dates (included). Tasks mirrored from timedesk are not listed here: use list_tasks for those.",
      inputSchema: z.object({ from: dateKey, to: dateKey.optional().describe('Defaults to 7 days after from') }),
      execute: ({ from, to }) =>
        guard(async () => {
          const events = await calendar.listEvents(user.id, { from: new Date(`${from}T00:00:00`), to: new Date(`${addDays(to ?? addDays(from, 6), 1)}T00:00:00`) })
          const own = events.filter((e) => !e.timedeskTaskId)
          return { count: own.length, events: own.slice(0, 40).map(brief) }
        }),
    }),

    create_calendar_event: tool({
      description: 'Add an event to the Google Calendar. Without startTime it is an all-day event.',
      inputSchema: z.object({
        title: z.string().min(1),
        date: dateKey,
        endDate: dateKey.optional().describe('Last day of a multi-day event, included'),
        startTime: timeOfDay.optional(),
        endTime: timeOfDay.optional(),
        timeZone: z.string().optional().describe('IANA name such as Europe/London. Required with startTime'),
        description: z.string().optional(),
      }),
      execute: ({ title, description, ...a }) =>
        guard(async () => {
          const w = when(a)
          if (!w) return NEEDS_ZONE
          return { created: brief(await calendar.createEvent(user.id, { title, description: description ?? '', ...w })) }
        }),
    }),

    update_calendar_event: tool({
      description: 'Change a calendar event: its title, description or when it happens. Get the id from list_calendar_events first.',
      inputSchema: z.object({
        event: z.string().describe('Event id from list_calendar_events'),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        date: dateKey.optional().describe('New date. Give it whenever the event moves'),
        endDate: dateKey.optional(),
        startTime: timeOfDay.optional(),
        endTime: timeOfDay.optional(),
        timeZone: z.string().optional(),
      }),
      execute: ({ event, title, description, ...a }) =>
        guard(async () => {
          const patch: { title?: string; description?: string; start?: string; end?: string; allDay?: boolean; timeZone?: string } = {}
          if (title !== undefined) patch.title = title
          if (description !== undefined) patch.description = description
          if (a.date) {
            const w = when({ ...a, date: a.date })
            if (!w) return NEEDS_ZONE
            Object.assign(patch, w)
          }
          return { updated: brief(await calendar.updateEvent(user.id, event, patch)) }
        }),
    }),

    delete_calendar_event: tool({
      description: 'Delete a calendar event. Only call this after the user clearly asked. Get the id from list_calendar_events first.',
      inputSchema: z.object({ event: z.string().describe('Event id from list_calendar_events') }),
      execute: ({ event }) =>
        guard(async () => {
          await calendar.deleteEvent(user.id, event)
          return { deleted: event }
        }),
    }),
  }
}

/** The assistant: a tool-using agent that works on one user's data and nobody else's. */
export function createAssistantService(p: Parts) {
  const now = () => (p.now ?? (() => new Date()))()

  function buildTools(user: SessionUser, calendarOn = false, timeZone = SERVER_ZONE) {
    /** The person's today, in their own time zone. */
    const today = () => zonedDateKey(now().getTime(), timeZone)
    const findProjectId = async (ref?: string | null) => {
      if (!ref) return null
      const r = ref.trim().toLowerCase()
      const all = await p.projects.list(user.id)
      return (all.find((x) => x.id === ref) ?? all.find((x) => x.name.toLowerCase() === r) ?? all.find((x) => x.name.toLowerCase().includes(r)))?.id ?? null
    }
    const findTask = async (ref: string) => {
      const r = ref.trim().toLowerCase()
      const all = await p.tasks.list(user.id)
      return all.find((x) => x.id === ref) ?? all.find((x) => x.title.toLowerCase() === r) ?? all.find((x) => x.title.toLowerCase().includes(r))
    }
    const projectName = async (id: string | null) => (id ? ((await p.projects.list(user.id)).find((x) => x.id === id)?.name ?? null) : null)
    const brief = async (t: Awaited<ReturnType<TaskService['list']>>[number]) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due: t.due,
      bucket: dueBucketOn(t.due, today()),
      project: await projectName(t.projectId),
      repeats: t.recurrence?.freq ?? null,
    })

    // ---- Shared by the daily summary, the weekly review and "plan my day" ----
    const digestTasks = (rows: Awaited<ReturnType<TaskService['list']>>): DigestTask[] =>
      rows.map((t) => ({
        id: t.id,
        title: t.title,
        projectId: t.projectId,
        status: t.status as DigestTask['status'],
        priority: t.priority as DigestTask['priority'],
        due: t.due,
        completedAt: t.completedAt?.getTime() ?? null,
      }))
    const entriesOf = (rows: Awaited<ReturnType<TimeService['list']>>) =>
      rows.map((r) => ({ id: r.id, taskId: r.taskId, projectId: r.projectId, startedAt: r.startedAt.getTime(), endedAt: r.endedAt?.getTime() ?? null }))
    const goalMinutes = async () => {
      const timer = (await p.settings?.get(user.id))?.data.timer as { dailyGoalMinutes?: unknown } | undefined
      const g = Number(timer?.dailyGoalMinutes)
      return Number.isFinite(g) && g >= 0 ? g : DEFAULT_GOAL_MINUTES
    }
    /** App names and totals only. Window titles stay out of what is sent to the AI provider. */
    const topApps = async (from: number, to: number) => {
      if (!p.activity) return []
      const s = await p.activity.summary(user.id, { from: new Date(from), to: new Date(to) })
      return s.byApp.slice(0, 5).map((a) => ({ app: a.app, time: formatHours(a.seconds * 1000) }))
    }
    /** Focus guard results for a range, or null when no session ran in it. Listed names only, never window titles. */
    const focusFacts = async (from: number, to: number) => {
      if (!p.focus) return null
      const f = await p.focus.summary(user.id, { from: new Date(from), to: new Date(to) })
      if (f.sessions === 0) return null
      return {
        sessions: f.sessions,
        scorePercent: f.score,
        focused: formatHours(f.focusedSeconds * 1000),
        distracted: formatHours(f.distractedSeconds * 1000),
        interruptions: f.interruptions,
        topDistractions: f.topDistractions.map((d) => ({ name: d.name, time: formatHours(d.seconds * 1000) })),
      }
    }
    /** Loads what a digest needs. Entries are read from a week before the range, so timers that cross midnight count. */
    const loadRange = async (from: number, to: number) => {
      const [projects, taskRows, entryRows] = await Promise.all([
        p.projects.list(user.id),
        p.tasks.list(user.id),
        p.time.list(user.id, { from: new Date(from - 7 * 86_400_000), to: new Date(to) }),
      ])
      return { projects, tasks: digestTasks(taskRows), entries: entriesOf(entryRows) }
    }
    const projectsBrief = (rows: { name: string; ms: number }[]) => rows.map((r) => ({ project: r.name, time: formatHours(r.ms) }))
    const openTitles = (tasks: DigestTask[], buckets: string[], day: string) =>
      tasks.filter((t) => t.status !== 'done' && buckets.includes(dueBucketOn(t.due, day))).map((t) => t.title)
    const runningNow = async () => {
      const e = await p.time.running(user.id)
      if (!e) return null
      const task = e.taskId ? (await p.tasks.list(user.id)).find((t) => t.id === e.taskId) : undefined
      return { task: task?.title ?? null, project: await projectName(e.projectId), for: formatHours(now().getTime() - e.startedAt.getTime()) }
    }

    return {
      daily_summary: tool({
        description:
          'Facts for a summary of one day: time tracked (total, by project, compared with the day before), tasks finished, what is still due, the daily goal, the apps used most, and focus (Focus guard score, interruptions, top distractions) when the desktop app measured it. Use it for "summarize my day", "how did today go" or "what did I do yesterday".',
        inputSchema: z.object({ date: dateKey.optional().describe('The day. Defaults to today') }),
        execute: async ({ date }) => {
          const day = date ?? today()
          const [d] = zonedDays(day, day, timeZone)
          const [prev] = zonedDays(addDays(day, -1), addDays(day, -1), timeZone)
          const data = await loadRange(prev.start, d.end)
          const g = buildDigest({ days: [d], previousDays: [prev], ...data, now: now().getTime() })
          const goal = await goalMinutes()
          const isToday = day === today()
          return {
            date: day,
            isToday,
            tracked: formatHours(g.totalMs),
            dayBefore: formatHours(g.previousTotalMs ?? 0),
            byProject: projectsBrief(g.byProject),
            timerSessions: g.sessions,
            longestSession: formatHours(g.longestSessionMs),
            dailyGoal: goal > 0 ? { goal: formatHours(goal * 60_000), reached: g.totalMs >= goal * 60_000 } : 'off',
            finished: g.completed.map((t) => t.title),
            stillDueToday: openTitles(data.tasks, ['today'], day),
            overdue: openTitles(data.tasks, ['overdue'], day),
            dueTomorrow: openTitles(data.tasks, ['today'], addDays(day, 1)),
            topApps: await topApps(d.start, d.end),
            focus: await focusFacts(d.start, d.end),
            ...(isToday ? { timerRunning: await runningNow() } : {}),
          }
        },
      }),

      weekly_review: tool({
        description:
          'Facts for a weekly review (Monday to Sunday): time per day and per project, compared with the week before, best day, days the goal was met, tasks finished, what carries over, the apps used most, focus (Focus guard score and top distractions) when measured, and the reflection the user wrote for that week and their plan from the week before. Use it for "weekly review", "how was my week".',
        inputSchema: z.object({ weekOf: dateKey.optional().describe('Any day in the week. Defaults to this week') }),
        execute: async ({ weekOf }) => {
          const monday = startOfWeek(weekOf ?? today())
          const days = zonedDays(monday, addDays(monday, 6), timeZone)
          const prev = zonedDays(addDays(monday, -7), addDays(monday, -1), timeZone)
          const data = await loadRange(prev[0].start, days[6].end)
          const g = buildDigest({ days, previousDays: prev, ...data, now: now().getTime() })
          const goal = await goalMinutes()
          const [review, lastWeek, apps, focusWeek] = await Promise.all([
            p.reviews?.get(user.id, monday),
            p.reviews?.get(user.id, addDays(monday, -7)),
            topApps(days[0].start, days[6].end),
            focusFacts(days[0].start, days[6].end),
          ])
          const change = g.previousTotalMs ? Math.round(((g.totalMs - g.previousTotalMs) / g.previousTotalMs) * 100) : null
          return {
            week: { from: g.from, to: g.to, isThisWeek: monday === startOfWeek(today()) },
            tracked: formatHours(g.totalMs),
            weekBefore: formatHours(g.previousTotalMs ?? 0),
            changePercent: change,
            byDay: g.byDay.map((x) => ({ date: x.date, time: formatHours(x.ms) })),
            bestDay: g.bestDay ? { date: g.bestDay.date, time: formatHours(g.bestDay.ms) } : null,
            daysGoalMet: goal > 0 ? g.byDay.filter((x) => x.ms >= goal * 60_000).length : 'goal off',
            byProject: projectsBrief(g.byProject),
            finished: g.completed.map((t) => (t.project ? `${t.title} (${t.project})` : t.title)),
            carryOver: openTitles(data.tasks, ['overdue', 'today'], today()),
            topApps: apps,
            focus: focusWeek,
            reflection: review && (review.wentWell || review.improve) ? { wentWell: review.wentWell, willChange: review.improve } : null,
            planFromWeekBefore: lastWeek?.improve || null,
          }
        },
      }),

      plan_day: tool({
        description:
          'Facts to plan a day: the open tasks that most need attention (in order, with the reason), calendar events that day when Google Calendar is connected, time already tracked, the daily goal and the current time. Use it for "plan my day", "what should I work on". Then propose a short schedule. Do not create calendar events or change tasks unless the user asks.',
        inputSchema: z.object({ date: dateKey.optional().describe('The day to plan. Defaults to today') }),
        execute: async ({ date }) => {
          const day = date ?? today()
          const [d] = zonedDays(day, day, timeZone)
          const week = zonedDays(addDays(day, -7), addDays(day, -1), timeZone)
          const data = await loadRange(week[0].start, d.end)
          const g = buildDigest({ days: [d], previousDays: week, ...data, now: now().getTime() })
          const workedDays = buildDigest({ days: week, ...data, now: now().getTime() }).byDay.filter((x) => x.ms > 0)
          const goal = await goalMinutes()
          const isToday = day === today()

          let events: { title: string; start: string; end: string; allDay: boolean }[] | string = 'Google Calendar is not connected'
          if (calendarOn && p.calendar) {
            try {
              const list = await p.calendar.listEvents(user.id, { from: new Date(d.start), to: new Date(d.end) })
              events = list.filter((e) => !e.timedeskTaskId).map((e) => ({ title: e.title, start: e.start, end: e.end, allDay: e.allDay }))
            } catch (e) {
              events = e instanceof AppError ? `Could not read the calendar: ${e.message}` : 'Could not read the calendar'
            }
          }
          return {
            date: day,
            timeZone,
            ...(isToday ? { currentTime: `${String(zonedHour(now().getTime(), timeZone)).padStart(2, '0')}:00 (plan from now on)` } : {}),
            trackedSoFar: formatHours(g.totalMs),
            dailyGoal: goal > 0 ? formatHours(goal * 60_000) : 'off',
            leftForGoal: goal > 0 ? formatHours(Math.max(0, goal * 60_000 - g.totalMs)) : null,
            typicalDay: workedDays.length ? formatHours(workedDays.reduce((s, x) => s + x.ms, 0) / workedDays.length) : 'no history yet',
            tasks: planCandidates(data.tasks, data.projects, day, 10).map((t) => ({
              title: t.title,
              why: t.reason,
              priority: t.priority,
              project: t.project,
              ...(t.status === 'in_progress' ? { started: true } : {}),
            })),
            calendar: events,
            ...(isToday ? { timerRunning: await runningNow() } : {}),
          }
        },
      }),

      list_tasks: tool({
        description: 'List tasks. Filter by status, project name, or due category. Call this before changing tasks so you know their exact titles.',
        inputSchema: z.object({
          status: z.enum(['todo', 'in_progress', 'done']).optional(),
          project: z.string().optional().describe('Project name'),
          due: z.enum(['overdue', 'today', 'tomorrow', 'this_week', 'later', 'none']).optional(),
        }),
        execute: async ({ status, project, due }) => {
          const pid = project ? await findProjectId(project) : undefined
          const rows = (await p.tasks.list(user.id, status)).filter((t) => (pid === undefined || t.projectId === pid) && (!due || dueBucketOn(t.due, today()) === due))
          return { count: rows.length, tasks: await Promise.all(rows.slice(0, 40).map(brief)) }
        },
      }),

      create_task: tool({
        description: 'Create a new task.',
        inputSchema: z.object({
          title: z.string().min(1),
          project: z.string().optional().describe('Project name'),
          priority: z.enum(['low', 'medium', 'high']).default('medium'),
          due: dateKey.optional(),
          repeat: z.enum(['daily', 'weekly', 'monthly']).optional(),
        }),
        execute: async ({ title, project, priority, due, repeat }) => {
          const row = await p.tasks.create(user, {
            title,
            projectId: await findProjectId(project),
            priority,
            status: 'todo',
            due: due ?? null,
            recurrence: repeat ? { freq: repeat } : null,
          })
          return { created: await brief(row) }
        },
      }),

      set_task_status: tool({
        description: 'Change a task status to todo, in_progress or done. Completing a recurring task schedules the next one.',
        inputSchema: z.object({ task: z.string().describe('Task title or id'), status: z.enum(['todo', 'in_progress', 'done']) }),
        execute: async ({ task, status }) => {
          const t = await findTask(task)
          if (!t) return { error: `No task matches "${task}".` }
          return { updated: await brief(await p.tasks.update(user.id, t.id, { status })) }
        },
      }),

      update_task: tool({
        description: 'Change a task title, priority, due date or project.',
        inputSchema: z.object({
          task: z.string().describe('Task title or id'),
          title: z.string().optional(),
          priority: z.enum(['low', 'medium', 'high']).optional(),
          due: dateKey.nullable().optional().describe('New due date, or null to clear it'),
          project: z.string().nullable().optional().describe('Project name, or null for none'),
        }),
        execute: async ({ task, title, priority, due, project }) => {
          const t = await findTask(task)
          if (!t) return { error: `No task matches "${task}".` }
          const patch: Record<string, unknown> = {}
          if (title !== undefined) patch.title = title
          if (priority !== undefined) patch.priority = priority
          if (due !== undefined) patch.due = due
          if (project !== undefined) patch.projectId = await findProjectId(project)
          return { updated: await brief(await p.tasks.update(user.id, t.id, patch)) }
        },
      }),

      delete_task: tool({
        description: 'Permanently delete a task. Only call this after the user clearly asked to delete it.',
        inputSchema: z.object({ task: z.string().describe('Task title or id') }),
        execute: async ({ task }) => {
          const t = await findTask(task)
          if (!t) return { error: `No task matches "${task}".` }
          await p.tasks.remove(user.id, t.id)
          return { deleted: t.title }
        },
      }),

      list_projects: tool({
        description: 'List projects with the number of open tasks in each.',
        inputSchema: z.object({}),
        execute: async () => {
          const [projects, tasks] = await Promise.all([p.projects.list(user.id), p.tasks.list(user.id)])
          return projects.map((x) => ({ name: x.name, openTasks: tasks.filter((t) => t.projectId === x.id && t.status !== 'done').length }))
        },
      }),

      create_project: tool({
        description: 'Create a new project.',
        inputSchema: z.object({ name: z.string().min(1), description: z.string().default('') }),
        execute: async ({ name, description }) => {
          const row = await p.projects.create(user, { name, description, color: 1 })
          return { created: row.name }
        },
      }),

      update_project: tool({
        description: 'Rename a project or change its description.',
        inputSchema: z.object({
          project: z.string().describe('Current project name or id'),
          name: z.string().min(1).optional().describe('New name'),
          description: z.string().optional().describe('New description'),
        }),
        execute: async ({ project, name, description }) => {
          const id = await findProjectId(project)
          if (!id) return { error: `No project matches "${project}".` }
          const patch: Record<string, unknown> = {}
          if (name !== undefined) patch.name = name
          if (description !== undefined) patch.description = description
          const row = await p.projects.update(user.id, id, patch)
          return { updated: { name: row.name, description: row.description } }
        },
      }),

      delete_project: tool({
        description: 'Delete a project. Its tasks and tracked time are kept and become "no project". Only call this after the user clearly asked to delete it.',
        inputSchema: z.object({ project: z.string().describe('Project name or id') }),
        execute: async ({ project }) => {
          const id = await findProjectId(project)
          if (!id) return { error: `No project matches "${project}".` }
          const name = await projectName(id)
          await p.projects.remove(user.id, id)
          return { deleted: name }
        },
      }),

      ...(calendarOn && p.calendar ? calendarTools(user, p.calendar) : {}),

      start_timer: tool({
        description: 'Start the time tracker on a task or a project. Stops a timer that is already running.',
        inputSchema: z.object({ task: z.string().optional().describe('Task title or id'), project: z.string().optional().describe('Project name') }),
        execute: async ({ task, project }) => {
          const t = task ? await findTask(task) : undefined
          if (task && !t) return { error: `No task matches "${task}".` }
          await p.time.start(user, { taskId: t?.id ?? null, projectId: t ? t.projectId : await findProjectId(project) })
          return { started: t?.title ?? project ?? 'stopwatch' }
        },
      }),

      stop_timer: tool({
        description: 'Stop the running timer.',
        inputSchema: z.object({}),
        execute: async () => {
          const running = await p.time.running(user.id)
          if (!running) return { message: 'No timer was running.' }
          await p.time.stop(user.id)
          return { stopped: true, tracked: formatHours(now().getTime() - running.startedAt.getTime()) }
        },
      }),

      timer_status: tool({
        description: 'Say whether a timer is running and for what.',
        inputSchema: z.object({}),
        execute: async () => {
          const e = await p.time.running(user.id)
          if (!e) return { running: false }
          const task = e.taskId ? (await p.tasks.list(user.id)).find((t) => t.id === e.taskId) : undefined
          return { running: true, task: task?.title ?? null, project: await projectName(e.projectId), elapsed: formatHours(now().getTime() - e.startedAt.getTime()) }
        },
      }),

      time_report: tool({
        description:
          'How much time was tracked, split by project, plus the last 7 days. Use period for this day, month, quarter or year. For any other span (for example "last week" or "1 to 15 Oct") pass from and to as dates and period is ignored.',
        inputSchema: z.object({
          period: z.enum(['day', 'month', 'quarter', 'year']).default('day'),
          from: dateKey.optional().describe('First day of a custom range'),
          to: dateKey.optional().describe('Last day of a custom range, included'),
        }),
        execute: async ({ period, from: fromKey, to: toKey }) => {
          const nowMs = now().getTime()
          const dayMs = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10))).getTime()
          const custom = fromKey || toKey ? { from: dayMs(fromKey ?? toKey!), to: dayMs(toKey ?? fromKey!) + 86_400_000 } : null
          if (custom && custom.to <= custom.from) return { error: 'The end date must not be before the start date.' }
          const from = custom ? custom.from : periodStart(period, nowMs)
          const until = custom ? custom.to : nowMs + 1
          const [projects, rows] = await Promise.all([p.projects.list(user.id), p.time.list(user.id, {})])
          const entries = rows.map((r) => ({ id: r.id, taskId: r.taskId, projectId: r.projectId, startedAt: r.startedAt.getTime(), endedAt: r.endedAt?.getTime() ?? null }))
          const by = projects
            .map((x) => ({ project: x.name, ms: entries.filter((e) => e.projectId === x.id).reduce((s, e) => s + overlapMs(e, from, until, nowMs), 0) }))
            .filter((r) => r.ms > 0)
            .sort((a, b) => b.ms - a.ms)
          return {
            period: custom ? 'custom' : period,
            ...(custom ? { from: fromKey ?? toKey, to: toKey ?? fromKey } : {}),
            total: formatHours(by.reduce((s, r) => s + r.ms, 0)),
            byProject: by.map((r) => ({ project: r.project, time: formatHours(r.ms) })),
            last7Days: dailyTotals(entries, nowMs, 7).map((d) => ({ date: toDateKey(d.start), time: formatHours(d.ms) })),
          }
        },
      }),
    }
  }

  const lastUserText = (messages: UIMessage[]) => {
    const m = [...messages].reverse().find((x) => x.role === 'user')
    return (m?.parts ?? []).map((part) => (part.type === 'text' ? part.text : '')).join(' ').trim()
  }

  function instructions(user: SessionUser, memories: string[], projects: string[], calendarOn: boolean, timeZone: string) {
    const at = now()
    const spoken = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at)
    return [
      `You are Tempo, the assistant inside timedesk, a time tracking and todo app. You are talking to ${user.name}.`,
      `It is now ${spoken} in the user's time zone (${timeZone}). Today is ${zonedDateKey(at.getTime(), timeZone)}. Resolve words like "tomorrow" or "next Friday" to YYYY-MM-DD dates.`,
      'For a summary of a day, a weekly review, or planning a day, call daily_summary, weekly_review or plan_day first, and use only the numbers they return. Answer with a few short sections using markdown headings or bold labels and bullet lists: what happened (time and finished tasks), what stands out (one or two honest observations), and what to do next. For a plan, give an ordered list of time blocks starting from the current time, fitted around calendar events, with the most important task first, and offer to put the blocks in the calendar or start a timer.',
      'You can read and change the user\'s tasks, projects and timer with your tools. Look things up with a tool before you change them. Never invent task names.',
      'Only delete something when the user clearly asked. When an action is ambiguous, ask one short question first.',
      'After using tools, say plainly what you did. Keep answers short and concrete.',
      calendarOn
        ? "The user's Google Calendar is connected: you can list, create, change and delete calendar events. Pass timeZone for events with a time; when you do not know the user's time zone, ask, or make it an all-day event."
        : 'Google Calendar is not connected. If the user asks about their calendar, say "Google Calendar is not connected" and tell them to connect it in Settings, Calendar.',
      projects.length ? `The user's projects: ${projects.join(', ')}.` : 'The user has no projects yet.',
      memories.length ? `Things you remember about the user:\n- ${memories.join('\n- ')}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  return {
    /** Which providers have a key, with the models each key can use. */
    async modelsFor(userId: string) {
      const keys = await p.aiKeys.allPlain(userId)
      const out = await Promise.all(
        aiProviders
          .filter((id) => keys[id])
          .map(async (id) => ({ provider: id, name: PROVIDER_NAMES[id], models: await listModels(id, keys[id]!) })),
      )
      return { providers: out, memory: { enabled: p.memory.enabled(keys) } }
    },

    async memories(userId: string) {
      return p.memory.list(userId, await p.aiKeys.allPlain(userId))
    },

    async forget(userId: string, id: string) {
      return p.memory.forget(userId, await p.aiKeys.allPlain(userId), id)
    },

    /** Streams the assistant's answer. Tools run on the server against this user's data only. */
    async chat(user: SessionUser, input: { messages: UIMessage[]; provider: AiProvider; model: string; timeZone?: string }): Promise<Response> {
      const timeZone = input.timeZone ?? SERVER_ZONE
      const keys = await p.aiKeys.allPlain(user.id)
      const apiKey = keys[input.provider]
      if (!apiKey) throw badRequest(`Add your ${PROVIDER_NAMES[input.provider]} API key in Settings first.`)

      const query = lastUserText(input.messages)
      const calendarOn = p.calendar ? (await p.calendar.status(user.id)).connected : false
      const [remembered, projects] = await Promise.all([
        query && p.memory.enabled(keys) ? p.memory.search(user.id, keys, query, 5).catch(() => []) : Promise.resolve([]),
        p.projects.list(user.id),
      ])

      const result = streamText({
        model: p.models(input.provider, input.model, apiKey),
        instructions: instructions(user, remembered.map((m) => m.text), projects.map((x) => x.name), calendarOn, timeZone),
        messages: await convertToModelMessages(input.messages),
        tools: buildTools(user, calendarOn, timeZone),
        stopWhen: isStepCount(8),
        onFinish: async ({ text }) => {
          if (query && text && p.memory.enabled(keys)) {
            await p.memory.remember(user.id, keys, [{ role: 'user', content: query }, { role: 'assistant', content: text }]).catch(() => {})
          }
        },
      })

      return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })
    },
  }
}

export type AssistantService = ReturnType<typeof createAssistantService>
