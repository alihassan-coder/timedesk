import { tool } from 'ai'
import { z } from 'zod'
import {
  dailyTotals,
  dueBucket,
  formatHours,
  overlapMs,
  periodStart,
  toDateKey,
  type Task,
} from '@timedesk/shared'
import { actions, getState } from '@/data/store'
import { memory } from './memory'

/** Finds a task by id, or by (partial, case-insensitive) title. */
function findTask(ref: string): Task | undefined {
  const { tasks } = getState()
  const r = ref.trim().toLowerCase()
  return tasks.find((t) => t.id === ref) ?? tasks.find((t) => t.title.toLowerCase() === r) ?? tasks.find((t) => t.title.toLowerCase().includes(r))
}

function findProjectId(ref: string | undefined | null): string | null {
  if (!ref) return null
  const { projects } = getState()
  const r = ref.trim().toLowerCase()
  return (projects.find((p) => p.id === ref) ?? projects.find((p) => p.name.toLowerCase() === r) ?? projects.find((p) => p.name.toLowerCase().includes(r)))?.id ?? null
}

const summary = (t: Task) => {
  const { projects } = getState()
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    due: t.due,
    bucket: dueBucket(t.due, Date.now()),
    project: projects.find((p) => p.id === t.projectId)?.name ?? null,
    repeats: t.recurrence?.freq ?? null,
  }
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date as YYYY-MM-DD in the user\'s local time')

export const agentTools = {
  list_tasks: tool({
    description: 'List tasks. Filter by status, project name, or due category. Use this before changing tasks so you know their ids.',
    inputSchema: z.object({
      status: z.enum(['todo', 'in_progress', 'done']).optional(),
      project: z.string().optional().describe('Project name or id'),
      due: z.enum(['overdue', 'today', 'tomorrow', 'this_week', 'later', 'none']).optional(),
    }),
    execute: async ({ status, project, due }) => {
      const pid = project ? findProjectId(project) : undefined
      const rows = getState()
        .tasks.filter((t) => (!status || t.status === status) && (pid === undefined || t.projectId === pid) && (!due || dueBucket(t.due, Date.now()) === due))
        .map(summary)
      return { count: rows.length, tasks: rows.slice(0, 40) }
    },
  }),

  create_task: tool({
    description: 'Create a new task (todo).',
    inputSchema: z.object({
      title: z.string().min(1),
      project: z.string().optional().describe('Project name or id'),
      priority: z.enum(['low', 'medium', 'high']).default('medium'),
      due: dateSchema.optional(),
      repeat: z.enum(['daily', 'weekly', 'monthly']).optional(),
    }),
    execute: async ({ title, project, priority, due, repeat }) => {
      actions.addTask({
        title,
        projectId: findProjectId(project),
        priority,
        due: due ?? null,
        recurrence: repeat ? { freq: repeat } : null,
      })
      return { created: summary(getState().tasks[0]) }
    },
  }),

  set_task_status: tool({
    description: 'Change a task status to todo, in_progress or done. Completing a recurring task schedules the next one.',
    inputSchema: z.object({ task: z.string().describe('Task id or title'), status: z.enum(['todo', 'in_progress', 'done']) }),
    execute: async ({ task, status }) => {
      const t = findTask(task)
      if (!t) return { error: `No task matches "${task}".` }
      actions.setStatus(t.id, status)
      return { updated: summary(getState().tasks.find((x) => x.id === t.id)!) }
    },
  }),

  delete_task: tool({
    description: 'Permanently delete a task. Only call after the user has clearly asked to delete it.',
    inputSchema: z.object({ task: z.string().describe('Task id or title') }),
    execute: async ({ task }) => {
      const t = findTask(task)
      if (!t) return { error: `No task matches "${task}".` }
      actions.deleteTask(t.id)
      return { deleted: t.title }
    },
  }),

  list_projects: tool({
    description: 'List projects with how many tasks are open in each.',
    inputSchema: z.object({}),
    execute: async () => {
      const { projects, tasks } = getState()
      return projects.map((p) => ({ id: p.id, name: p.name, openTasks: tasks.filter((t) => t.projectId === p.id && t.status !== 'done').length }))
    },
  }),

  create_project: tool({
    description: 'Create a new project.',
    inputSchema: z.object({ name: z.string().min(1), description: z.string().default('') }),
    execute: async ({ name, description }) => {
      actions.addProject(name, description)
      return { created: name }
    },
  }),

  start_timer: tool({
    description: 'Start the time tracker on a task or a project. Stops any timer that is already running.',
    inputSchema: z.object({ task: z.string().optional().describe('Task id or title'), project: z.string().optional().describe('Project name or id') }),
    execute: async ({ task, project }) => {
      const t = task ? findTask(task) : undefined
      if (task && !t) return { error: `No task matches "${task}".` }
      actions.startTimer({ taskId: t?.id ?? null, projectId: t ? undefined : findProjectId(project) })
      return { started: t?.title ?? project ?? 'stopwatch' }
    },
  }),

  stop_timer: tool({
    description: 'Stop the running timer.',
    inputSchema: z.object({}),
    execute: async () => {
      const running = getState().entries.find((e) => e.endedAt === null)
      if (!running) return { message: 'No timer was running.' }
      actions.stopTimer()
      return { stopped: true, tracked: formatHours(Date.now() - running.startedAt) }
    },
  }),

  timer_status: tool({
    description: 'Say whether a timer is running and for what.',
    inputSchema: z.object({}),
    execute: async () => {
      const { entries, tasks, projects } = getState()
      const e = entries.find((x) => x.endedAt === null)
      if (!e) return { running: false }
      return {
        running: true,
        task: tasks.find((t) => t.id === e.taskId)?.title ?? null,
        project: projects.find((p) => p.id === e.projectId)?.name ?? null,
        elapsed: formatHours(Date.now() - e.startedAt),
      }
    },
  }),

  time_report: tool({
    description: 'How much time was tracked in a period, split by project, plus the last 7 days per day.',
    inputSchema: z.object({ period: z.enum(['day', 'month', 'quarter', 'year']).default('day') }),
    execute: async ({ period }) => {
      const now = Date.now()
      const from = periodStart(period, now)
      const { entries, projects } = getState()
      const byProject = projects
        .map((p) => ({ project: p.name, ms: entries.filter((e) => e.projectId === p.id).reduce((s, e) => s + overlapMs(e, from, now + 1, now), 0) }))
        .filter((r) => r.ms > 0)
        .sort((a, b) => b.ms - a.ms)
      return {
        period,
        total: formatHours(byProject.reduce((s, r) => s + r.ms, 0)),
        byProject: byProject.map((r) => ({ project: r.project, time: formatHours(r.ms) })),
        last7Days: dailyTotals(entries, now, 7).map((d) => ({ date: toDateKey(d.start), time: formatHours(d.ms) })),
      }
    },
  }),

  remember: tool({
    description: 'Save a lasting fact or preference about the user so you can recall it in future conversations (for example working hours, goals, how they like plans formatted).',
    inputSchema: z.object({ fact: z.string().min(3) }),
    execute: async ({ fact }) => {
      memory.add(fact)
      return { saved: fact }
    },
  }),

  recall: tool({
    description: 'Search what you remember about the user.',
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => ({ memories: memory.search(query, 8).map((m) => m.text) }),
  }),
}

export type ToolName = keyof typeof agentTools

export const TOOL_LABELS: Record<ToolName, string> = {
  list_tasks: 'Looked up tasks',
  create_task: 'Created a task',
  set_task_status: 'Updated a task',
  delete_task: 'Deleted a task',
  list_projects: 'Looked up projects',
  create_project: 'Created a project',
  start_timer: 'Started the timer',
  stop_timer: 'Stopped the timer',
  timer_status: 'Checked the timer',
  time_report: 'Built a time report',
  remember: 'Saved to memory',
  recall: 'Searched memory',
}
