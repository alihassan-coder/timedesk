import { useDeferredValue, useMemo, useState } from 'react'
import { Calendar, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, KanbanSquare, List, Plus, Repeat } from 'lucide-react'
import {
  DUE_BUCKET_LABEL,
  DUE_BUCKET_ORDER,
  addDays,
  addMonths,
  dueBucketOn,
  monthGrid,
  startOfWeek,
  toDateKey,
  type DueBucket,
  type Priority,
  type Project,
  type Recurrence,
  type Task,
  type TaskStatus,
} from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { ProjectDot } from '@/components/project-dot'
import { Segmented } from '@/components/segmented'
import { SimpleSelect } from '@/components/simple-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { actions, useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { DayView, MonthView, WeekView } from '@/features/task-calendar'
import { DropZone, taskDragProps } from '@/features/task-dnd'
import { dueLabel, PRIORITY_LABEL, STATUS_LABEL } from '@/features/task-labels'
import { StatusMenu, TaskRow } from '@/features/task-row'
import { useGoogleEvents, useGoogleStatus } from '@/lib/google'
import { cn } from '@/lib/utils'

type View = 'list' | 'board' | 'day' | 'week' | 'month'
const VIEW_KEY = 'timedesk:tasks-view'
const VIEWS: View[] = ['list', 'board', 'day', 'week', 'month']

function loadView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    if (VIEWS.includes(v as View)) return v as View
  } catch {
    // storage blocked: use the default
  }
  return 'list'
}

const fmt = (key: string, opts: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts)
}

/** The heading for the period being shown, for example "2 - 8 Nov 2026". */
function periodTitle(view: View, anchor: string): string {
  if (view === 'day') return fmt(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  if (view === 'month') return fmt(anchor, { month: 'long', year: 'numeric' })
  const start = startOfWeek(anchor)
  const [a, b] = [start, addDays(start, 6)].map((k) => {
    const [y, m, d] = k.split('-').map(Number)
    return new Date(y, m - 1, d)
  })
  // "Nov 2 - 8, 2026" (the format follows the person's language)
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).formatRange(a, b)
}

function shift(view: View, anchor: string, dir: 1 | -1): string {
  if (view === 'day') return addDays(anchor, dir)
  if (view === 'week') return addDays(anchor, 7 * dir)
  return addMonths(anchor, dir)
}

const viewLabel = (icon: React.ReactNode, text: string) => (
  <>
    {icon} <span className="hidden lg:inline">{text}</span>
  </>
)

export default function TasksPage() {
  const { tasks, projects } = useStore()
  const now = useNow(false)
  const today = toDateKey(now)
  const [view, setViewState] = useState<View>(loadView)
  const [anchor, setAnchor] = useState(today)
  const [projectFilter, setProjectFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<{ due: string } | null>(null)

  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // ignore
    }
  }
  const openDay = (day: string) => {
    setAnchor(day)
    setView('day')
  }

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  // The chosen project was deleted (here or on another device): show everything again.
  const filter = projectFilter !== 'all' && projectFilter !== 'none' && !projectsById.has(projectFilter) ? 'all' : projectFilter
  // Typing stays responsive with many tasks: the list filters a beat behind the input.
  const search = useDeferredValue(query).toLowerCase()
  const shown = useMemo(
    () =>
      tasks.filter(
        (t) => (filter === 'all' || t.projectId === filter || (filter === 'none' && !t.projectId)) && (!search || t.title.toLowerCase().includes(search)),
      ),
    [tasks, filter, search],
  )
  const calendar = view === 'day' || view === 'week' || view === 'month'
  // Google Calendar events for the days on screen, when the calendar is connected. Shown read-only next to the tasks.
  const { status: google } = useGoogleStatus()
  const [rangeFrom, rangeTo] =
    view === 'day'
      ? [anchor, addDays(anchor, 1)]
      : view === 'week'
        ? [startOfWeek(anchor), addDays(startOfWeek(anchor), 7)]
        : (() => {
            const grid = monthGrid(anchor)
            return [grid[0][0], addDays(grid[grid.length - 1][6], 1)]
          })()
  const { events, error: eventsError } = useGoogleEvents(rangeFrom, rangeTo, calendar && google?.connected === true)
  const calendarProps = { tasks: shown, anchor, now, events, onOpenDay: openDay, onAdd: (day: string) => setAdding({ due: day }) }

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Plan by list, board, day, week or month. Drag a task to move it."
        actions={
          <Button onClick={() => setAdding({ due: calendar ? anchor : '' })}>
            <Plus /> New task
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: viewLabel(<List />, 'List'), ariaLabel: 'List view' },
            { value: 'board', label: viewLabel(<KanbanSquare />, 'Board'), ariaLabel: 'Board view' },
            { value: 'day', label: viewLabel(<CalendarDays />, 'Day'), ariaLabel: 'Day view' },
            { value: 'week', label: viewLabel(<CalendarRange />, 'Week'), ariaLabel: 'Week view' },
            { value: 'month', label: viewLabel(<Calendar />, 'Month'), ariaLabel: 'Month view' },
          ]}
        />
        <Input className="w-full sm:w-56" placeholder="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} />
        <SimpleSelect
          className="w-44"
          value={filter}
          onChange={setProjectFilter}
          options={[
            { value: 'all', label: 'All projects' },
            ...projects.map((p) => ({ value: p.id, label: p.name })),
            { value: 'none', label: 'No project' },
          ]}
        />
      </div>

      {calendar && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" aria-label="Previous" onClick={() => setAnchor(shift(view, anchor, -1))}>
              <ChevronLeft />
            </Button>
            <Button size="icon" variant="outline" aria-label="Next" onClick={() => setAnchor(shift(view, anchor, 1))}>
              <ChevronRight />
            </Button>
          </div>
          <h2 className="text-lg font-semibold tracking-tight" aria-live="polite">
            {periodTitle(view, anchor)}
          </h2>
          <Button size="sm" variant="ghost" className="ml-auto" disabled={anchor === today && view === 'day'} onClick={() => setAnchor(today)}>
            Today
          </Button>
        </div>
      )}

      {calendar && eventsError && (
        <p role="alert" className="text-destructive text-sm">
          Could not load your Google Calendar events. {eventsError}
        </p>
      )}

      {view === 'list' && <ListView tasks={shown} today={today} projectsById={projectsById} />}
      {view === 'board' && <BoardView tasks={shown} now={now} projectsById={projectsById} />}
      {view === 'day' && <DayView {...calendarProps} />}
      {view === 'week' && <WeekView {...calendarProps} />}
      {view === 'month' && <MonthView {...calendarProps} />}

      <NewTaskDialog open={adding !== null} defaultDue={adding?.due ?? ''} onClose={() => setAdding(null)} />
    </>
  )
}

const DONE_PAGE = 20

function ListView({ tasks, today, projectsById }: { tasks: Task[]; today: string; projectsById: Map<string, Project> }) {
  const [doneShown, setDoneShown] = useState(DONE_PAGE)
  // One pass over the tasks, not one filter per bucket. Completed: latest first.
  const { buckets, done } = useMemo(() => {
    const buckets = new Map<DueBucket, Task[]>()
    const done: Task[] = []
    for (const t of tasks) {
      if (t.status === 'done') {
        done.push(t)
        continue
      }
      const b = dueBucketOn(t.due, today)
      const list = buckets.get(b)
      if (list) list.push(t)
      else buckets.set(b, [t])
    }
    done.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    return { buckets, done }
  }, [tasks, today])
  const projectOf = (t: Task) => (t.projectId ? (projectsById.get(t.projectId) ?? null) : null)

  return (
    <div className="space-y-6">
      {DUE_BUCKET_ORDER.map((bucket) => {
        const items = buckets.get(bucket)
        if (!items) return null
        return (
          <section key={bucket} className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              {DUE_BUCKET_LABEL[bucket]}
              <Badge variant={bucket === 'overdue' ? 'destructive' : 'secondary'}>{items.length}</Badge>
            </h2>
            <ul className="divide-y rounded-lg border">
              {items.map((t) => (
                <TaskRow key={t.id} task={t} today={today} project={projectOf(t)} />
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
            {done.slice(0, doneShown).map((t) => (
              <TaskRow key={t.id} task={t} today={today} project={projectOf(t)} />
            ))}
          </ul>
          {done.length > doneShown && (
            <Button size="sm" variant="ghost" onClick={() => setDoneShown((n) => n + DONE_PAGE * 5)}>
              Show more ({done.length - doneShown} more)
            </Button>
          )}
        </section>
      )}
      {tasks.length === 0 && <p className="text-muted-foreground text-sm">No tasks match. Clear the search or add a task.</p>}
    </div>
  )
}

const COLUMN_DOT: Record<TaskStatus, string> = { todo: 'bg-muted-foreground/50', in_progress: 'bg-primary', done: 'bg-emerald-500' }

function BoardView({ tasks, now, projectsById }: { tasks: Task[]; now: number; projectsById: Map<string, Project> }) {
  const columns = Object.keys(STATUS_LABEL) as TaskStatus[]
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {columns.map((status) => {
        const items = tasks.filter((t) => t.status === status)
        return (
          <DropZone
            key={status}
            onDropTask={(id) => void actions.setStatus(id, status)}
            className="bg-muted/30 flex min-h-64 flex-col gap-3 rounded-xl border p-3"
          >
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <span aria-hidden className={cn('size-2 rounded-full', COLUMN_DOT[status])} />
              {STATUS_LABEL[status]} <Badge variant="secondary">{items.length}</Badge>
            </h2>
            <div className="flex-1 space-y-2">
              {items.map((t) => {
                const project = t.projectId ? projectsById.get(t.projectId) : undefined
                return (
                  <div
                    key={t.id}
                    {...taskDragProps(t.id)}
                    className="bg-card cursor-grab space-y-2 rounded-lg border p-3 text-sm shadow-xs transition-shadow hover:shadow-md active:cursor-grabbing"
                  >
                    <p className={cn('font-medium', t.status === 'done' && 'text-muted-foreground line-through')}>{t.title}</p>
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
              {items.length === 0 && (
                <p className="text-muted-foreground rounded-lg border border-dashed py-8 text-center text-xs">Drop a task here</p>
              )}
            </div>
          </DropZone>
        )
      })}
    </div>
  )
}

function NewTaskDialog({ open, defaultDue, onClose }: { open: boolean; defaultDue: string; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{open && <NewTaskForm key={defaultDue} defaultDue={defaultDue} onClose={onClose} />}</DialogContent>
    </Dialog>
  )
}

function NewTaskForm({ defaultDue, onClose }: { defaultDue: string; onClose: () => void }) {
  const { projects } = useStore()
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('none')
  const [priority, setPriority] = useState<Priority>('medium')
  const [due, setDue] = useState(defaultDue)
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
    onClose()
  }

  return (
    <>
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
          <Input id="title" autoFocus maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" />
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
    </>
  )
}
