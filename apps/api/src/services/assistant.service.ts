import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, tool, type UIMessage } from 'ai'
import { z } from 'zod'
import { dailyTotals, dueBucket, formatHours, overlapMs, periodStart, toDateKey } from '@timedesk/shared'
import type { ModelFactory } from '../lib/models.ts'
import { listModels, PROVIDER_NAMES } from '../lib/models.ts'
import type { MemoryProvider } from '../lib/memory.ts'
import type { SessionUser } from '../types.ts'
import { badRequest } from '../utils/errors.ts'
import type { AiProvider } from '../validators/index.ts'
import { aiProviders } from '../validators/index.ts'
import type { AiKeyService } from './ai-key.service.ts'
import type { ProjectService } from './project.service.ts'
import type { TaskService } from './task.service.ts'
import type { TimeService } from './time.service.ts'

interface Parts {
  aiKeys: AiKeyService
  projects: ProjectService
  tasks: TaskService
  time: TimeService
  models: ModelFactory
  memory: MemoryProvider
  now?: () => Date
}

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date as YYYY-MM-DD in the user's local time")

/** The assistant: a tool-using agent that works on one user's data and nobody else's. */
export function createAssistantService(p: Parts) {
  const now = () => (p.now ?? (() => new Date()))()

  function buildTools(user: SessionUser) {
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
      bucket: dueBucket(t.due, now().getTime()),
      project: await projectName(t.projectId),
      repeats: t.recurrence?.freq ?? null,
    })

    return {
      list_tasks: tool({
        description: 'List tasks. Filter by status, project name, or due category. Call this before changing tasks so you know their exact titles.',
        inputSchema: z.object({
          status: z.enum(['todo', 'in_progress', 'done']).optional(),
          project: z.string().optional().describe('Project name'),
          due: z.enum(['overdue', 'today', 'tomorrow', 'this_week', 'later', 'none']).optional(),
        }),
        execute: async ({ status, project, due }) => {
          const pid = project ? await findProjectId(project) : undefined
          const rows = (await p.tasks.list(user.id, status)).filter((t) => (pid === undefined || t.projectId === pid) && (!due || dueBucket(t.due, now().getTime()) === due))
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
        description: 'How much time was tracked in a period, split by project, plus the last 7 days.',
        inputSchema: z.object({ period: z.enum(['day', 'month', 'quarter', 'year']).default('day') }),
        execute: async ({ period }) => {
          const nowMs = now().getTime()
          const from = periodStart(period, nowMs)
          const [projects, rows] = await Promise.all([p.projects.list(user.id), p.time.list(user.id, {})])
          const entries = rows.map((r) => ({ id: r.id, taskId: r.taskId, projectId: r.projectId, startedAt: r.startedAt.getTime(), endedAt: r.endedAt?.getTime() ?? null }))
          const by = projects
            .map((x) => ({ project: x.name, ms: entries.filter((e) => e.projectId === x.id).reduce((s, e) => s + overlapMs(e, from, nowMs + 1, nowMs), 0) }))
            .filter((r) => r.ms > 0)
            .sort((a, b) => b.ms - a.ms)
          return {
            period,
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

  function instructions(user: SessionUser, memories: string[], projects: string[]) {
    const d = now()
    return [
      `You are Tempo, the assistant inside timedesk, a time tracking and todo app. You are talking to ${user.name}.`,
      `Today is ${d.toDateString()} (${toDateKey(d.getTime())}). Resolve words like "tomorrow" or "next Friday" to YYYY-MM-DD dates.`,
      'You can read and change the user\'s tasks, projects and timer with your tools. Look things up with a tool before you change them. Never invent task names.',
      'Only delete something when the user clearly asked. When an action is ambiguous, ask one short question first.',
      'After using tools, say plainly what you did. Keep answers short and concrete.',
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
    async chat(user: SessionUser, input: { messages: UIMessage[]; provider: AiProvider; model: string }): Promise<Response> {
      const keys = await p.aiKeys.allPlain(user.id)
      const apiKey = keys[input.provider]
      if (!apiKey) throw badRequest(`Add your ${PROVIDER_NAMES[input.provider]} API key in Settings first.`)

      const query = lastUserText(input.messages)
      const [remembered, projects] = await Promise.all([
        query && p.memory.enabled(keys) ? p.memory.search(user.id, keys, query, 5).catch(() => []) : Promise.resolve([]),
        p.projects.list(user.id),
      ])

      const result = streamText({
        model: p.models(input.provider, input.model, apiKey),
        instructions: instructions(user, remembered.map((m) => m.text), projects.map((x) => x.name)),
        messages: await convertToModelMessages(input.messages),
        tools: buildTools(user),
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
