import { z } from 'zod'

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const recurrence = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'custom']),
  every: z.number().int().min(1).max(365).optional(),
})

export const idParam = z.object({ id: z.string().min(1) })

export const createProject = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(''),
  color: z.number().int().min(1).max(5).default(1),
})
export const updateProject = createProject.omit({ id: true }).partial()

export const createTask = z.object({
  id: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(300),
  projectId: z.string().nullable().default(null),
  status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  due: dateKey.nullable().default(null),
  recurrence: recurrence.nullable().default(null),
})
export const updateTask = createTask.omit({ id: true }).partial()
export const taskQuery = z.object({ status: z.enum(['todo', 'in_progress', 'done']).optional() })

export const startTimer = z.object({
  taskId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
})
export const timeRange = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })

export const userStatusQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending') })

export const aiProviders = ['openai', 'anthropic', 'google', 'groq', 'xai'] as const
export const aiProviderParam = z.object({ provider: z.enum(aiProviders) })
export const saveAiKey = z.object({ key: z.string().trim().min(8).max(500) })

export type CreateProject = z.infer<typeof createProject>
export type UpdateProject = z.infer<typeof updateProject>
export type CreateTask = z.infer<typeof createTask>
export type UpdateTask = z.infer<typeof updateTask>
export type StartTimer = z.infer<typeof startTimer>
export type AiProvider = (typeof aiProviders)[number]
