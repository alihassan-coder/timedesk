import { beforeAll, describe, expect, it } from 'vitest'
import { api, approvedMember, createTestApp, type TestApp } from './helpers.ts'

let t: TestApp
let ann: ReturnType<typeof api>
let bob: ReturnType<typeof api>

beforeAll(async () => {
  t = await createTestApp()
  ann = api(t, (await approvedMember(t, 'ann')).cookie)
  bob = api(t, (await approvedMember(t, 'bob')).cookie)
}, 60_000)

describe('projects', () => {
  it('creates, lists, renames and deletes a project', async () => {
    const created = await (await ann.post('/projects', { name: 'Website', color: 3 })).json()
    expect(created.project).toMatchObject({ name: 'Website', color: 3 })

    const renamed = await (await ann.patch(`/projects/${created.project.id}`, { name: 'Website v2' })).json()
    expect(renamed.project.name).toBe('Website v2')

    expect((await ann.del(`/projects/${created.project.id}`)).status).toBe(204)
    const list = await (await ann.get('/projects')).json()
    expect(list.projects).toHaveLength(0)
  })

  it('edits the description and colour, and deleting keeps tasks as "no project"', async () => {
    const p = (await (await ann.post('/projects', { name: 'Docs' })).json()).project
    const edited = await (await ann.patch(`/projects/${p.id}`, { description: 'Guides', color: 4 })).json()
    expect(edited.project).toMatchObject({ name: 'Docs', description: 'Guides', color: 4 })

    await ann.post('/tasks', { title: 'Write intro', projectId: p.id })
    expect((await ann.del(`/projects/${p.id}`)).status).toBe(204)
    const tasks = (await (await ann.get('/tasks')).json()).tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0].projectId).toBeNull()
  })

  it("cannot edit or delete someone else's project", async () => {
    const p = (await (await ann.post('/projects', { name: 'Private' })).json()).project
    expect((await bob.patch(`/projects/${p.id}`, { name: 'Hacked' })).status).toBe(404)
    expect((await bob.del(`/projects/${p.id}`)).status).toBe(404)
  })

  it('a partial edit changes only the fields that were sent', async () => {
    const p = (await (await ann.post('/projects', { name: 'Keep', description: 'about', color: 4 })).json()).project
    const renamed = await (await ann.patch(`/projects/${p.id}`, { name: 'Kept' })).json()
    expect(renamed.project).toMatchObject({ name: 'Kept', description: 'about', color: 4 })
  })

  it('rejects an empty name', async () => {
    const res = await ann.post('/projects', { name: '   ' })
    expect(res.status).toBe(422)
  })
})

describe('tasks', () => {
  it('creates a task with defaults and lists it', async () => {
    const res = await ann.post('/tasks', { title: 'Write copy' })
    expect(res.status).toBe(201)
    const { task } = await res.json()
    expect(task).toMatchObject({ title: 'Write copy', status: 'todo', priority: 'medium', due: null })
  })

  it('accepts a client-generated id so offline-created tasks keep their id', async () => {
    const { task } = await (await ann.post('/tasks', { id: 'offline-123', title: 'Made offline' })).json()
    expect(task.id).toBe('offline-123')
  })

  it('updates the status and filters by status', async () => {
    const { task } = await (await ann.post('/tasks', { title: 'Finish report' })).json()
    await ann.patch(`/tasks/${task.id}`, { status: 'done' })
    const done = await (await ann.get('/tasks?status=done')).json()
    expect(done.tasks.map((x: { id: string }) => x.id)).toContain(task.id)
  })

  it('rejects a due date that is not YYYY-MM-DD', async () => {
    const res = await ann.post('/tasks', { title: 'Bad date', due: '5 Nov' })
    expect(res.status).toBe(422)
    expect((await res.json()).details[0].path).toBe('due')
  })

  it('stores a recurrence rule', async () => {
    const { task } = await (await ann.post('/tasks', { title: 'Standup notes', due: '2026-11-05', recurrence: { freq: 'daily' } })).json()
    expect(task.recurrence).toEqual({ freq: 'daily' })
  })

  it('deleted tasks disappear from the list', async () => {
    const { task } = await (await ann.post('/tasks', { title: 'Temporary' })).json()
    expect((await ann.del(`/tasks/${task.id}`)).status).toBe(204)
    const list = await (await ann.get('/tasks')).json()
    expect(list.tasks.map((x: { id: string }) => x.id)).not.toContain(task.id)
  })

  it('one person never sees or changes another person\'s tasks', async () => {
    const { task } = await (await ann.post('/tasks', { title: 'Ann private' })).json()

    const bobList = await (await bob.get('/tasks')).json()
    expect(bobList.tasks.map((x: { id: string }) => x.id)).not.toContain(task.id)

    expect((await bob.patch(`/tasks/${task.id}`, { title: 'hacked' })).status).toBe(404)
    expect((await bob.del(`/tasks/${task.id}`)).status).toBe(404)

    const annList = await (await ann.get('/tasks')).json()
    expect(annList.tasks.find((x: { id: string }) => x.id === task.id).title).toBe('Ann private')
  })
})

describe('editing a task changes only what was sent', () => {
  it('moving the date keeps the priority, project, status and repeat', async () => {
    const project = (await (await ann.post('/projects', { name: 'Keepers' })).json()).project
    const task = (
      await (await ann.post('/tasks', { title: 'Pay rent', projectId: project.id, priority: 'high', due: '2026-11-10', recurrence: { freq: 'monthly' }, status: 'in_progress' })).json()
    ).task

    const moved = (await (await ann.patch(`/tasks/${task.id}`, { due: '2026-11-12' })).json()).task
    expect(moved).toMatchObject({ due: '2026-11-12', projectId: project.id, priority: 'high', status: 'in_progress', recurrence: { freq: 'monthly' }, title: 'Pay rent' })

    const done = (await (await ann.patch(`/tasks/${task.id}`, { status: 'done' })).json()).task
    expect(done).toMatchObject({ status: 'done', due: '2026-11-12', projectId: project.id, priority: 'high', recurrence: { freq: 'monthly' } })

    const cleared = (await (await ann.patch(`/tasks/${task.id}`, { due: null })).json()).task
    expect(cleared.due).toBeNull() // an explicit null still clears it
  })
})
