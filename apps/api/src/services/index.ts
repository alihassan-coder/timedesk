import { createHmac } from 'node:crypto'
import type { Deps } from '../types.ts'
import { createAccountService } from './account.service.ts'
import { createActivityService } from './activity.service.ts'
import { createAdminService } from './admin.service.ts'
import { createAiKeyService } from './ai-key.service.ts'
import { createAssistantService } from './assistant.service.ts'
import { createChatService } from './chat.service.ts'
import { createFocusService } from './focus.service.ts'
import { createGoogleCalendarService } from './google-calendar.service.ts'
import { createProjectService } from './project.service.ts'
import { createReviewService } from './review.service.ts'
import { createSettingsService } from './settings.service.ts'
import { createTaskService } from './task.service.ts'
import { createTimeService } from './time.service.ts'

/** Builds every service once from the shared dependencies. */
export function createServices({ db, env, models, memory, google, auth }: Deps) {
  const aiKeys = createAiKeyService(db, env.KEY_ENCRYPTION_SECRET)
  const projects = createProjectService(db)
  const calendar = createGoogleCalendarService(db, env.KEY_ENCRYPTION_SECRET, env.WEB_ORIGIN, google)
  // Tasks with a due date are mirrored to Google Calendar for people who connected it (a no-op for everyone else).
  const tasks = createTaskService(db, { changed: calendar.mirrorTask, removed: calendar.unmirrorTask })
  const time = createTimeService(db)
  const settings = createSettingsService(db)
  const reviews = createReviewService(db)
  const activity = createActivityService(db)
  const focus = createFocusService(db)
  /** Better Auth checks the password of whoever the headers belong to (cookie or desktop token). */
  const verifyPassword = async (headers: Headers, password: string) => {
    try {
      await auth.api.verifyPassword({ body: { password }, headers })
      return true
    } catch {
      return false
    }
  }
  return {
    account: createAccountService({ db, aiKeys, memory, calendar, verifyPassword }),
    activity,
    focus,
    admin: createAdminService(db),
    aiKeys,
    calendar,
    chats: createChatService(db),
    settings,
    reviews,
    projects,
    tasks,
    time,
    assistant: createAssistantService({ aiKeys, projects, tasks, time, models, memory, calendar, reviews, settings, activity, focus,
      // A key of its own (derived, so the encryption secret itself is never used for anything else).
      approvalSecret: createHmac('sha256', env.KEY_ENCRYPTION_SECRET).update('tempo-tool-approval').digest('hex'),
    }),
  }
}

export type Services = ReturnType<typeof createServices>
