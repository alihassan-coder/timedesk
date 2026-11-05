import type { Context } from 'hono'
import type { Services } from '../services/index.ts'
import type { AppEnv } from '../types.ts'
import { parseBody, parseParams, parseQuery } from '../utils/validate.ts'
import * as v from '../validators/index.ts'

type C = Context<AppEnv>

/**
 * Controllers only translate HTTP to service calls and back: validate input, call a service,
 * shape the response. Business rules live in services.
 */
export function createControllers(s: Services) {
  return {
    me: (c: C) => c.json({ user: c.get('user') }),

    admin: {
      listUsers: async (c: C) => c.json({ users: await s.admin.listUsers(parseQuery(c, v.userStatusQuery).status) }),
      approve: async (c: C) => c.json({ user: await s.admin.decide(c.get('user').id, parseParams(c, v.idParam).id, 'approved') }),
      reject: async (c: C) => c.json({ user: await s.admin.decide(c.get('user').id, parseParams(c, v.idParam).id, 'rejected') }),
    },

    projects: {
      list: async (c: C) => c.json({ projects: await s.projects.list(c.get('user').id) }),
      create: async (c: C) => c.json({ project: await s.projects.create(c.get('user'), await parseBody(c, v.createProject)) }, 201),
      update: async (c: C) =>
        c.json({ project: await s.projects.update(c.get('user').id, parseParams(c, v.idParam).id, await parseBody(c, v.updateProject)) }),
      remove: async (c: C) => {
        await s.projects.remove(c.get('user').id, parseParams(c, v.idParam).id)
        return c.body(null, 204)
      },
    },

    tasks: {
      list: async (c: C) => c.json({ tasks: await s.tasks.list(c.get('user').id, parseQuery(c, v.taskQuery).status) }),
      create: async (c: C) => c.json({ task: await s.tasks.create(c.get('user'), await parseBody(c, v.createTask)) }, 201),
      update: async (c: C) => c.json({ task: await s.tasks.update(c.get('user').id, parseParams(c, v.idParam).id, await parseBody(c, v.updateTask)) }),
      remove: async (c: C) => {
        await s.tasks.remove(c.get('user').id, parseParams(c, v.idParam).id)
        return c.body(null, 204)
      },
    },

    time: {
      list: async (c: C) => c.json({ entries: await s.time.list(c.get('user').id, parseQuery(c, v.timeRange)) }),
      running: async (c: C) => c.json({ entry: await s.time.running(c.get('user').id) }),
      start: async (c: C) => c.json({ entry: await s.time.start(c.get('user'), await parseBody(c, v.startTimer)) }, 201),
      stop: async (c: C) => c.json({ entry: await s.time.stop(c.get('user').id) }),
    },

    aiKeys: {
      list: async (c: C) => c.json({ keys: await s.aiKeys.list(c.get('user').id) }),
      save: async (c: C) => {
        const { provider } = parseParams(c, v.aiProviderParam)
        await s.aiKeys.save(c.get('user').id, provider, (await parseBody(c, v.saveAiKey)).key)
        return c.json({ provider, saved: true })
      },
      remove: async (c: C) => {
        await s.aiKeys.remove(c.get('user').id, parseParams(c, v.aiProviderParam).provider)
        return c.body(null, 204)
      },
    },
  }
}

export type Controllers = ReturnType<typeof createControllers>
