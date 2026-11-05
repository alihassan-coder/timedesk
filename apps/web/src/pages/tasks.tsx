import { useState } from 'react'
import { KanbanSquare, List, Plus, Repeat } from 'lucide-react'
import {
  DUE_BUCKET_LABEL,
  DUE_BUCKET_ORDER,
  dueBucket,
  type Priority,
  type Recurrence,
  type Task,
  type TaskStatus,
} from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { Segmented } from '@/components/segmented'
import { SimpleSelect } from '@/components/simple-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { actions, useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { dueLabel, PRIORITY_LABEL, STATUS_LABEL } from '@/features/task-labels'
import { StatusMenu, TaskRow } from '@/features/task-row'
import { ProjectDot } from '@/components/project-dot'

type View = 'list' | 'board'

export default function TasksPage() {
  const { tasks, projects } = useStore()
  const now = useNow(false)
  const [view, setView] = useState<View>('list')
  const [projectFilter, setProjectFilter] = useState('all')
  const [query, setQuery] = useState('')

  const shown = tasks.filter(
    (t) =>
      (projectFilter === 'all' || t.projectId === projectFilter || (projectFilter === 'none' && !t.projectId)) &&
      t.title.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Daily todos grouped by when they are due. Change the status any time."
        actions={<NewTaskDialog />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-full sm:w-64" placeholder="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} />
        <SimpleSelect
          className="w-48"
          value={projectFilter}
          onChange={setProjectFilter}
          options={[
            { value: 'all', label: 'All projects' },
            ...projects.map((p) => ({ value: p.id, label: p.name })),
            { value: 'none', label: 'No project' },
          ]}
        />
        <div className="ml-auto">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: <List />, ariaLabel: 'List view' },
              { value: 'board', label: <KanbanSquare />, ariaLabel: 'Board view' },
            ]}
          />
        </div>
      </div>

      {view === 'list' ? <ListView tasks={shown} now={now} /> : <BoardView tasks={shown} now={now} />}
    </>
  )
}

function ListView({ tasks, now }: { tasks: Task[]; now: number }) {
  const open = tasks.filter((t) => t.status !== 'done')
  const done = tasks.filter((t) => t.status === 'done')
  return (
    <div className="space-y-6">
      {DUE_BUCKET_ORDER.map((bucket) => {
        const items = open.filter((t) => dueBucket(t.due, now) === bucket)
        if (items.length === 0) return null
        return (
          <section key={bucket} className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              {DUE_BUCKET_LABEL[bucket]}
              <Badge variant={bucket === 'overdue' ? 'destructive' : 'secondary'}>{items.length}</Badge>
            </h2>
            <ul className="divide-y rounded-lg border">
              {items.map((t) => (
                <TaskRow key={t.id} task={t} now={now} />
              ))}
            </ul>
          </section>
        )
      })}
      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            Completed <Badge variant="secondary">{done.length}</Badge>
          </h2>
          <ul className="divide-y rounded-lg border">
            {done.map((t) => (
              <TaskRow key={t.id} task={t} now={now} />
            ))}
          </ul>
        </section>
      )}
      {tasks.length === 0 && <p className="text-muted-foreground text-sm">No tasks match. Clear the search or add a task.</p>}
    </div>
  )
}

function BoardView({ tasks, now }: { tasks: Task[]; now: number }) {
  const { projects } = useStore()
  const columns = Object.keys(STATUS_LABEL) as TaskStatus[]
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {columns.map((status) => {
        const items = tasks.filter((t) => t.status === status)
        return (
          <Card key={status} className="bg-muted/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                {STATUS_LABEL[status]} <Badge variant="secondary">{items.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {items.map((t) => {
                const project = projects.find((p) => p.id === t.projectId)
                return (
                  <div key={t.id} className="bg-card space-y-2 rounded-lg border p-3 text-sm shadow-xs">
                    <p className="font-medium">{t.title}</p>
                    <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                      {project && (
                        <span className="flex items-center gap-1.5">
                          <ProjectDot project={project} /> {project.name}
                        </span>
                      )}
                      {t.due && <span>{dueLabel(t.due, now)}</span>}
                      {t.recurrence && <Repeat className="size-3" />}
                    </div>
                    <div className="flex items-center justify-between">
                      <Badge variant={t.priority === 'high' ? 'destructive' : t.priority === 'medium' ? 'secondary' : 'outline'}>
                        {PRIORITY_LABEL[t.priority]}
                      </Badge>
                      <StatusMenu task={t} />
                    </div>
                  </div>
                )
              })}
              {items.length === 0 && <p className="text-muted-foreground text-xs">Nothing here.</p>}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function NewTaskDialog() {
  const { projects } = useStore()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('none')
  const [priority, setPriority] = useState<Priority>('medium')
  const [due, setDue] = useState('')
  const [repeat, setRepeat] = useState<'none' | Recurrence['freq']>('none')

  function submit() {
    if (!title.trim()) return
    actions.addTask({
      title,
      projectId: projectId === 'none' ? null : projectId,
      priority,
      due: due || null,
      recurrence: repeat === 'none' ? null : { freq: repeat, every: repeat === 'custom' ? 3 : undefined },
    })
    setTitle('')
    setDue('')
    setRepeat('none')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus /> New task
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <SimpleSelect
                className="w-full"
                value={projectId}
                onChange={setProjectId}
                options={[{ value: 'none', label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <SimpleSelect
                className="w-full"
                value={priority}
                onChange={setPriority}
                options={(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="due">Due date</Label>
              <Input id="due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Repeat</Label>
              <SimpleSelect
                className="w-full"
                value={repeat}
                onChange={setRepeat}
                options={[
                  { value: 'none', label: 'Does not repeat' },
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'custom', label: 'Every 3 days' },
                ]}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!title.trim()}>
              Add task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
