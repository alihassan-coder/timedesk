import { Hono } from 'hono'
import type { Controllers } from '../controllers/index.ts'
import { requireAdmin } from '../middleware/auth.ts'
import type { AppEnv } from '../types.ts'

/** URL map only. No logic here: each line names a controller. Everything needs an approved account. */
export function createRoutes(c: Controllers) {
  const r = new Hono<AppEnv>()

  r.get('/me', c.me)

  const admin = new Hono<AppEnv>()
  admin.use('*', requireAdmin)
  admin.get('/users', c.admin.listUsers)
  admin.post('/users/:id/approve', c.admin.approve)
  admin.post('/users/:id/reject', c.admin.reject)
  r.route('/admin', admin)

  r.get('/projects', c.projects.list)
  r.post('/projects', c.projects.create)
  r.patch('/projects/:id', c.projects.update)
  r.delete('/projects/:id', c.projects.remove)

  r.get('/tasks', c.tasks.list)
  r.post('/tasks', c.tasks.create)
  r.patch('/tasks/:id', c.tasks.update)
  r.delete('/tasks/:id', c.tasks.remove)

  r.get('/time-entries', c.time.list)
  r.get('/time-entries/running', c.time.running)
  r.post('/time-entries/start', c.time.start)
  r.post('/time-entries/stop', c.time.stop)

  r.post('/activity', c.activity.ingest)
  r.get('/activity/summary', c.activity.summary)
  r.delete('/activity', c.activity.clear)

  r.get('/chats', c.chats.list)
  r.get('/chats/:id', c.chats.get)
  r.put('/chats/:id', c.chats.save)
  r.delete('/chats/:id', c.chats.remove)

  r.get('/settings', c.settings.get)
  r.patch('/settings', c.settings.update)

  r.get('/assistant/models', c.assistant.models)
  r.get('/assistant/memories', c.assistant.memories)
  r.delete('/assistant/memories/:id', c.assistant.forget)
  r.post('/assistant/chat', c.assistant.chat)

  r.get('/ai/keys', c.aiKeys.list)
  r.put('/ai/keys/:provider', c.aiKeys.save)
  r.delete('/ai/keys/:provider', c.aiKeys.remove)

  return r
}
