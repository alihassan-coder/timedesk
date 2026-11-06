import { CalendarDays, Plus, Repeat } from 'lucide-react'
import { dayOfMonth, eventsOnDay, eventTimeLabel, monthGrid, sameMonth, toDateKey, weekDays, type CalendarEvent, type Task } from '@timedesk/shared'
import { ProjectDot } from '@/components/project-dot'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { actions, useStore } from '@/data/store'
import { DropZone, taskDragProps } from '@/features/task-dnd'
import { PRIORITY_LABEL } from '@/features/task-labels'
import { TaskRow } from '@/features/task-row'
import { cn } from '@/lib/utils'

/** The Day, Week and Month task views. Dates are local YYYY-MM-DD keys. */

export interface CalendarProps {
  tasks: Task[]
  /** Any date inside the period being shown. */
  anchor: string
  now: number
  onOpenDay: (day: string) => void
  onAdd: (day: string) => void
  /** Google Calendar events to show next to the tasks. They are read-only here unless `onOpenEvent` is given. */
  events?: CalendarEvent[]
  onOpenEvent?: (event: CalendarEvent) => void
}

const PRIORITY_BAR = { low: 'bg-border', medium: 'bg-primary/50', high: 'bg-destructive' } as const

const byOrder = (a: Task, b: Task) =>
  Number(a.status === 'done') - Number(b.status === 'done') || ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority)

const forDay = (tasks: Task[], day: string) => tasks.filter((t) => t.due === day).sort(byOrder)

const dateLabel = (key: string, opts: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts)
}

const moveToDay = (day: string) => (taskId: string) => void actions.updateTask(taskId, { due: day })

/** A task card: a drag handle, a checkbox, the title and a small project and priority hint. */
function TaskCard({ task }: { task: Task }) {
  const { projects } = useStore()
  const project = projects.find((p) => p.id === task.projectId)
  const done = task.status === 'done'
  return (
    <div
      {...taskDragProps(task.id)}
      className="bg-card group relative flex cursor-grab items-start gap-2 overflow-hidden rounded-lg border py-2 pr-2 pl-3.5 text-sm shadow-xs active:cursor-grabbing"
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', PRIORITY_BAR[task.priority])} />
      <Checkbox
        className="mt-0.5"
        checked={done}
        onCheckedChange={(c) => actions.setStatus(task.id, c ? 'done' : 'todo')}
        aria-label={`Complete ${task.title}`}
      />
      <div className="min-w-0 flex-1">
        <p className={cn('leading-snug break-words', done && 'text-muted-foreground line-through')}>{task.title}</p>
        {(project || task.recurrence || task.priority === 'high') && (
          <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
            {project && (
              <span className="flex min-w-0 items-center gap-1">
                <ProjectDot project={project} className="size-2" /> <span className="truncate">{project.name}</span>
              </span>
            )}
            {task.priority === 'high' && <span className="text-destructive">{PRIORITY_LABEL.high}</span>}
            {task.recurrence && <Repeat className="size-3" aria-label="Repeats" />}
          </p>
        )}
      </div>
    </div>
  )
}

/** A one-line task for the month grid and the "no date" tray. */
function TaskChip({ task }: { task: Task }) {
  const { projects } = useStore()
  const project = projects.find((p) => p.id === task.projectId)
  const done = task.status === 'done'
  return (
    <div
      {...taskDragProps(task.id)}
      title={task.title}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'bg-card flex cursor-grab items-center gap-1.5 truncate rounded-md border px-1.5 py-0.5 text-xs active:cursor-grabbing',
        done && 'text-muted-foreground line-through',
      )}
    >
      <ProjectDot project={project} className="size-1.5" />
      <span className="truncate">{task.title}</span>
    </div>
  )
}

/** A Google Calendar event. It looks different from a task and cannot be dragged. Clickable only when the page can edit events. */
function EventChip({ event, onOpen, roomy = false }: { event: CalendarEvent; onOpen?: (e: CalendarEvent) => void; roomy?: boolean }) {
  const time = eventTimeLabel(event)
  const body = (
    <>
      <CalendarDays aria-hidden className="size-3 shrink-0 opacity-70" />
      {time && <span className="shrink-0 opacity-70">{time}</span>}
      <span className={cn('truncate', roomy && 'whitespace-normal break-words')}>{event.title}</span>
    </>
  )
  const style = cn(
    'flex w-full min-w-0 items-center gap-1.5 rounded-md border border-sky-300/60 bg-sky-50 px-1.5 py-0.5 text-left text-xs text-sky-900 dark:border-sky-500/30 dark:bg-sky-950/40 dark:text-sky-100',
    roomy && 'py-1',
  )
  if (!onOpen) {
    return (
      <div title={`${event.title} (Google Calendar)`} data-google-event className={style}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      title={`${event.title} (Google Calendar)`}
      data-google-event
      onClick={(e) => {
        e.stopPropagation()
        onOpen(event)
      }}
      className={cn(style, 'hover:bg-sky-100 dark:hover:bg-sky-950/70')}
    >
      {body}
    </button>
  )
}

/** Open tasks without a date: drag one onto a day to schedule it. */
function UnscheduledTray({ tasks }: { tasks: Task[] }) {
  const open = tasks.filter((t) => !t.due && t.status !== 'done')
  if (open.length === 0) return null
  return (
    <DropZone onDropTask={(id) => void actions.updateTask(id, { due: null })} className="rounded-xl border border-dashed p-3">
      <p className="text-muted-foreground mb-2 text-xs font-medium">No date yet. Drag a task onto a day to schedule it.</p>
      <div className="flex flex-wrap gap-1.5">
        {open.map((t) => (
          <div key={t.id} className="max-w-64">
            <TaskChip task={t} />
          </div>
        ))}
      </div>
    </DropZone>
  )
}

/* ------------------------------- Day ------------------------------- */

export function DayView({ tasks, anchor, now, onAdd, events = [], onOpenEvent }: CalendarProps) {
  const today = toDateKey(now)
  const dayTasks = forDay(tasks, anchor)
  const dayEvents = eventsOnDay(events, anchor)
  const open = dayTasks.filter((t) => t.status !== 'done').length
  const overdue = anchor === today ? tasks.filter((t) => t.due && t.due < today && t.status !== 'done').sort(byOrder) : []

  return (
    <div className="space-y-6">
      <DropZone onDropTask={moveToDay(anchor)} className="space-y-3 rounded-xl p-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            {dayTasks.length === 0 && dayEvents.length === 0
              ? 'Nothing planned.'
              : `${open} to do, ${dayTasks.length - open} done${dayEvents.length ? `, ${dayEvents.length} calendar event${dayEvents.length === 1 ? '' : 's'}` : ''}`}
          </p>
          <Button size="sm" variant="outline" onClick={() => onAdd(anchor)}>
            <Plus /> Add to this day
          </Button>
        </div>
        {dayEvents.length > 0 && (
          <div className="space-y-1.5">
            {dayEvents.map((e) => (
              <EventChip key={e.id} event={e} onOpen={onOpenEvent} roomy />
            ))}
          </div>
        )}
        {dayTasks.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {dayTasks.map((t) => (
              <TaskRow key={t.id} task={t} now={now} />
            ))}
          </ul>
        ) : (
          dayEvents.length === 0 && (
            <div className="text-muted-foreground rounded-xl border border-dashed py-14 text-center text-sm">
              A free day. Add a task, or drag one here.
            </div>
          )
        )}
      </DropZone>

      {overdue.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-destructive text-sm font-medium">Overdue ({overdue.length})</h2>
          <ul className="divide-y rounded-lg border">
            {overdue.map((t) => (
              <TaskRow key={t.id} task={t} now={now} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/* ------------------------------- Week ------------------------------ */

export function WeekView({ tasks, anchor, now, onOpenDay, onAdd, events = [], onOpenEvent }: CalendarProps) {
  const today = toDateKey(now)
  return (
    <div className="space-y-4">
      <UnscheduledTray tasks={tasks} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {weekDays(anchor).map((day) => {
          const items = forDay(tasks, day)
          const dayEvents = eventsOnDay(events, day)
          const isToday = day === today
          return (
            <DropZone
              key={day}
              onDropTask={moveToDay(day)}
              className={cn('bg-muted/30 flex min-h-48 flex-col rounded-xl border p-2', isToday && 'border-primary/50 bg-primary/5')}
            >
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                className="hover:bg-accent mb-2 flex items-center justify-between rounded-md px-1.5 py-1 text-left"
                aria-label={`Open ${dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}`}
              >
                <span className="text-muted-foreground text-xs font-medium uppercase">{dateLabel(day, { weekday: 'short' })}</span>
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full text-sm font-semibold',
                    isToday && 'bg-primary text-primary-foreground',
                  )}
                >
                  {dayOfMonth(day)}
                </span>
              </button>
              <div className="flex-1 space-y-2">
                {dayEvents.map((e) => (
                  <EventChip key={e.id} event={e} onOpen={onOpenEvent} roomy />
                ))}
                {items.map((t) => (
                  <TaskCard key={t.id} task={t} />
                ))}
              </div>
              <Button size="xs" variant="ghost" className="text-muted-foreground mt-2 justify-start" onClick={() => onAdd(day)}>
                <Plus /> Add
              </Button>
            </DropZone>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------ Month ------------------------------ */

const MAX_CHIPS = 3

export function MonthView({ tasks, anchor, now, onOpenDay, onAdd, events = [], onOpenEvent }: CalendarProps) {
  const today = toDateKey(now)
  const weeks = monthGrid(anchor)
  return (
    <div className="space-y-4">
      <UnscheduledTray tasks={tasks} />
      <div className="overflow-hidden rounded-xl border">
        <div className="bg-muted/40 grid grid-cols-7 border-b text-center text-xs font-medium uppercase">
          {weeks[0].map((d) => (
            <div key={d} className="text-muted-foreground py-2">
              {dateLabel(d, { weekday: 'short' })}
            </div>
          ))}
        </div>
        {weeks.map((week, i) => (
          <div key={week[0]} className={cn('grid grid-cols-7', i > 0 && 'border-t')}>
            {week.map((day, col) => {
              const items = forDay(tasks, day)
              const dayEvents = eventsOnDay(events, day)
              const total = items.length + dayEvents.length
              const inMonth = sameMonth(day, anchor)
              const isToday = day === today
              return (
                <DropZone
                  key={day}
                  onDropTask={moveToDay(day)}
                  overClassName="bg-primary/10 ring-primary/50 ring-2 ring-inset"
                  className={cn('group min-h-20 cursor-pointer p-1 sm:min-h-28 sm:p-1.5', col > 0 && 'border-l', !inMonth && 'bg-muted/30')}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`${dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}, ${items.length} tasks${dayEvents.length ? `, ${dayEvents.length} events` : ''}`}
                    onClick={() => onOpenDay(day)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpenDay(day)}
                    className="flex h-full flex-col gap-1 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          'flex size-6 items-center justify-center rounded-full text-xs font-medium',
                          !inMonth && 'text-muted-foreground/60',
                          isToday && 'bg-primary text-primary-foreground',
                        )}
                      >
                        {dayOfMonth(day)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Add a task on ${day}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onAdd(day)
                        }}
                        className="text-muted-foreground hover:bg-accent hidden size-5 items-center justify-center rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 sm:flex"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                    <div className="hidden space-y-1 sm:block">
                      {dayEvents.slice(0, MAX_CHIPS).map((e) => (
                        <EventChip key={e.id} event={e} onOpen={onOpenEvent} />
                      ))}
                      {items.slice(0, Math.max(0, MAX_CHIPS - dayEvents.length)).map((t) => (
                        <TaskChip key={t.id} task={t} />
                      ))}
                      {total > MAX_CHIPS && <p className="text-muted-foreground px-1 text-xs">+{total - MAX_CHIPS} more</p>}
                    </div>
                    {total > 0 && (
                      <span className="bg-primary/15 text-primary mx-auto rounded-full px-1.5 text-[10px] font-semibold sm:hidden">{total}</span>
                    )}
                  </div>
                </DropZone>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

