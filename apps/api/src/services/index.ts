import type { Deps } from '../types.ts'
import { createAdminService } from './admin.service.ts'
import { createAiKeyService } from './ai-key.service.ts'
import { createProjectService } from './project.service.ts'
import { createTaskService } from './task.service.ts'
import { createTimeService } from './time.service.ts'

/** Builds every service once from the shared dependencies. */
export function createServices({ db, env }: Deps) {
  return {
    admin: createAdminService(db),
    aiKeys: createAiKeyService(db, env.KEY_ENCRYPTION_SECRET),
    projects: createProjectService(db),
    tasks: createTaskService(db),
    time: createTimeService(db),
  }
}

export type Services = ReturnType<typeof createServices>
