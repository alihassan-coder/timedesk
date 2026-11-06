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

    account: {
      /** Sent as a file download, named with the date. */
      export: async (c: C) => {
        const data = await s.account.export(c.get('user').id)
        c.header('Content-Disposition', `attachment; filename="timedesk-export-${data.exportedAt.slice(0, 10)}.json"`)
        c.header('Cache-Control', 'no-store')
        return c.json(data)
      },
      remove: async (c: C) => {
        await s.account.remove(c.get('user').id, c.req.raw.headers, (await parseBody(c, v.deleteAccount)).password)
        return c.body(null, 204)
      },
    },

    reviews: {
      recent: async (c: C) => c.json({ reviews: await s.reviews.recent(c.get('user').id, parseQuery(c, v.reviewsQuery).limit) }),
      get: async (c: C) => c.json({ review: await s.reviews.get(c.get('user').id, parseParams(c, v.weekParam).week) }),
      save: async (c: C) =>
        c.json({ review: await s.reviews.save(c.get('user').id, parseParams(c, v.weekParam).week, await parseBody(c, v.saveReview)) }),
    },

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
      stop: async (c: C) => c.json({ entry: await s.time.stop(c.get('user').id, (await parseBody(c, v.stopTimer)).endedAt) }),
    },

    activity: {
      ingest: async (c: C) => c.json(await s.activity.ingest(c.get('user').id, await parseBody(c, v.activityBatch)), 201),
      summary: async (c: C) => c.json(await s.activity.summary(c.get('user').id, parseQuery(c, v.timeRange))),
      sessions: async (c: C) => c.json(await s.activity.sessions(c.get('user').id, parseQuery(c, v.activitySessionsQuery))),
      removeOne: async (c: C) => {
        await s.activity.removeOne(c.get('user').id, parseParams(c, v.idParam).id)
        return c.body(null, 204)
      },
      clear: async (c: C) => c.json(await s.activity.clear(c.get('user').id)),
    },

    focus: {
      ingest: async (c: C) => c.json(await s.focus.ingest(c.get('user').id, await parseBody(c, v.focusBatch)), 201),
      list: async (c: C) => c.json({ sessions: await s.focus.list(c.get('user').id, parseQuery(c, v.timeRange)) }),
      summary: async (c: C) => c.json(await s.focus.summary(c.get('user').id, parseQuery(c, v.timeRange))),
      clear: async (c: C) => c.json(await s.focus.clear(c.get('user').id)),
    },

    google: {
      status: async (c: C) => c.json(await s.calendar.status(c.get('user').id)),
      connect: async (c: C) => c.json(s.calendar.connectUrl(c.get('user').id, (await parseBody(c, v.googleConnectBody)).desktop)),
      settings: async (c: C) => {
        await s.calendar.setPushTasks(c.get('user').id, (await parseBody(c, v.googleSettingsPatch)).pushTasks)
        return c.json(await s.calendar.status(c.get('user').id))
      },
      disconnect: async (c: C) => {
        await s.calendar.disconnect(c.get('user').id)
        return c.body(null, 204)
      },
      /** Public: Google sends the browser here. The signed state says who started it. */
      callback: async (c: C) => {
        const done = await s.calendar.finishConnect({ code: c.req.query('code'), state: c.req.query('state'), error: c.req.query('error') })
        if (!done.desktop) return c.redirect(done.redirect, 302)
        return c.html(
          `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>timedesk</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center"><main><h1 style="font-size:1.25rem">${done.ok ? 'Connected' : 'Could not connect'}</h1><p>${done.ok ? 'Google Calendar is connected. You can close this tab and return to timedesk.' : 'Google Calendar could not be connected. Close this tab, go back to timedesk and try again.'}</p></main></body>`,
          done.ok ? 200 : 400,
        )
      },
    },

    calendar: {
      events: async (c: C) => c.json({ events: await s.calendar.listEvents(c.get('user').id, parseQuery(c, v.calendarRange)) }),
      create: async (c: C) => c.json({ event: await s.calendar.createEvent(c.get('user').id, await parseBody(c, v.createCalendarEvent)) }, 201),
      update: async (c: C) =>
        c.json({ event: await s.calendar.updateEvent(c.get('user').id, parseParams(c, v.eventIdParam).id, await parseBody(c, v.updateCalendarEvent)) }),
      remove: async (c: C) => {
        await s.calendar.deleteEvent(c.get('user').id, parseParams(c, v.eventIdParam).id)
        return c.body(null, 204)
      },
      sync: async (c: C) => c.json(await s.calendar.sync(c.get('user').id)),
    },

    chats: {
      list: async (c: C) => c.json({ chats: await s.chats.list(c.get('user').id) }),
      get: async (c: C) => c.json({ chat: await s.chats.get(c.get('user').id, parseParams(c, v.idParam).id) }),
      save: async (c: C) => c.json(await s.chats.save(c.get('user').id, parseParams(c, v.idParam).id, await parseBody(c, v.saveChat))),
      remove: async (c: C) => {
        await s.chats.remove(c.get('user').id, parseParams(c, v.idParam).id)
        return c.body(null, 204)
      },
    },

    settings: {
      get: async (c: C) => c.json(await s.settings.get(c.get('user').id)),
      update: async (c: C) => c.json(await s.settings.merge(c.get('user').id, await parseBody(c, v.settingsPatch))),
    },

    assistant: {
      models: async (c: C) => c.json(await s.assistant.modelsFor(c.get('user').id)),
      memories: async (c: C) => c.json({ memories: await s.assistant.memories(c.get('user').id) }),
      forget: async (c: C) => {
        const ok = await s.assistant.forget(c.get('user').id, parseParams(c, v.idParam).id)
        return ok ? c.body(null, 204) : c.json({ error: 'Memory not found.' }, 404)
      },
      chat: async (c: C) => s.assistant.chat(c.get('user'), (await parseBody(c, v.chatBody)) as unknown as Parameters<typeof s.assistant.chat>[1]),
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
