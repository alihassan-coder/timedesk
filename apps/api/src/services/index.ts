import type { Deps } from '../types.ts'
import { createActivityService } from './activity.service.ts'
import { createAdminService } from './admin.service.ts'
import { createAiKeyService } from './ai-key.service.ts'
import { createAssistantService } from './assistant.service.ts'
import { createChatService } from './chat.service.ts'
import { createProjectService } from './project.service.ts'
import { createSettingsService } from './settings.service.ts'
import { createTaskService } from './task.service.ts'
import { createTimeService } from './time.service.ts'

/** Builds every service once from the shared dependencies. */
export function createServices({ db, env, models, memory }: Deps) {
  const aiKeys = createAiKeyService(db, env.KEY_ENCRYPTION_SECRET)
  const projects = createProjectService(db)
  const tasks = createTaskService(db)
  const time = createTimeService(db)
  return {
    activity: createActivityService(db),
    admin: createAdminService(db),
    aiKeys,
    chats: createChatService(db),
    settings: createSettingsService(db),
    projects,
    tasks,
    time,
    assistant: createAssistantService({ aiKeys, projects, tasks, time, models, memory }),
  }
}

export type Services = ReturnType<typeof createServices>
