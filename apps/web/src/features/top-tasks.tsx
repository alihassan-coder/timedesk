import { useMemo } from 'react'
import { Play, Plus, Square, Star, X } from 'lucide-react'
import { dueBucket, planCandidates, runningEntries, TOP_TASKS, type Project, type Task } from '@timedesk/shared'
import { ProjectDot } from '@/components/project-dot'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { actions, useStore } from '@/data/store'
import { cn } from '@/lib/utils'

/** A day's top tasks, in their order. */
export function topOf(tasks: Task[], day: string): Task[] {
  return tasks.filter((t) => t.topDay === day).sort((a, b) => (a.topRank ?? 9) - (b.topRank ?? 9))
}

/** Open tasks worth picking for a day, most pressing first (overdue, due, started, high priority). */
export function pickable(tasks: Task[], projects: Project[], day: string): Task[] {
  const order = planCandidates(
    tasks.map((t) => ({ ...t })),
    projects,
    day,
    40,
  ).map((c) => c.id)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  return order.map((id) => byId.get(id)!).filter((t) => t && t.topDay !== day)
}

/** The star on a task row: add it to today's top 3, or take it out. */
export function TopStar({ task, today }: { task: Task; today: string }) {
  const { tasks } = useStore()
  const isTop = task.topDay === today
  const full = !isTop && tasks.filter((t) => t.topDay === today).length >= TOP_TASKS
  if (task.status === 'done' && !isTop) return null
  return (
    <button
      type="button"
      onClick={() => actions.setTop(task.id, isTop ? null : today)}
      disabled={full}
      aria-pressed={isTop}
      aria-label={isTop ? `Remove ${task.title} from today's top 3` : `Add ${task.title} to today's top 3`}
      title={full ? "Today's top 3 is full" : isTop ? "In today's top 3" : "Add to today's top 3"}
      className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30', isTop ? 'text-amber-500' : 'text-muted-foreground/50 hover:text-amber-500')}
    >
      <Star className={cn('size-4', isTop && 'fill-current')} />
    </button>
  )
}

/** The menu to fill an empty place in a day's top 3. */
export function PickTopMenu({ day, label = 'Pick a task' }: { day: string; label?: string }) {
  const { tasks, projects } = useStore()
  const options = useMemo(() => pickable(tasks, projects, day).slice(0, 12), [tasks, projects, day])
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="text-muted-foreground w-full justify-start border-dashed" />}>
        <Plus /> {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Most pressing first</DropdownMenuLabel>
          {options.map((t) => (
            <DropdownMenuItem key={t.id} onClick={() => actions.setTop(t.id, day)}>
              <ProjectDot project={projects.find((p) => p.id === t.projectId)} />
              <span className="truncate">{t.title}</span>
            </DropdownMenuItem>
          ))}
          {options.length === 0 && <DropdownMenuItem disabled>No open tasks. Add one first.</DropdownMenuItem>}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Today's top 3 on the dashboard: the few tasks that matter most today, picked by the person. Tick them off, start a
 * timer on one, or pick the next. Nothing else on the page competes with these.
 */
export function TopTasksCard({ today }: { today: string }) {
  const { tasks, projects, entries } = useStore()
  const top = useMemo(() => topOf(tasks, today), [tasks, today])
  const running = useMemo(() => new Set(runningEntries(entries).map((e) => e.taskId)), [entries])
  const done = top.filter((t) => t.status === 'done').length
  const empty = TOP_TASKS - top.length
  const suggestion = useMemo(() => (top.length === 0 ? tasks.filter((t) => t.status !== 'done' && ['overdue', 'today'].includes(dueBucket(t.due, Date.now()))).length : 0), [tasks, top.length])

  return (
    <Card data-testid="top-tasks">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Star className="size-4 fill-amber-400 text-amber-500" /> Today&apos;s top 3
        </CardTitle>
        <CardDescription>
          {top.length === 0
            ? suggestion > 0
              ? `Pick the few tasks that matter most today. ${suggestion} ${suggestion === 1 ? 'is' : 'are'} due or overdue.`
              : 'Pick the few tasks that matter most today. Everything else can wait.'
            : done === top.length
              ? 'All done. Well played.'
              : `${done} of ${top.length} done`}
        </CardDescription>
        {top.length > 0 && (
          <CardAction>
            <span className="text-muted-foreground text-sm tabular-nums">
              {done}/{top.length}
            </span>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        <ol className="space-y-2">
          {top.map((t, i) => {
            const project = projects.find((p) => p.id === t.projectId)
            const isDone = t.status === 'done'
            const isRunning = running.has(t.id)
            return (
              <li key={t.id} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', isRunning && 'border-primary/50 bg-primary/5')}>
                <span className="text-muted-foreground w-4 text-sm font-medium tabular-nums">{i + 1}</span>
                <Checkbox checked={isDone} onCheckedChange={(c) => actions.setStatus(t.id, c ? 'done' : 'todo')} aria-label={`Complete ${t.title}`} />
                <span className={cn('min-w-0 flex-1 truncate', isDone && 'text-muted-foreground line-through')}>{t.title}</span>
                {project && (
                  <span className="text-muted-foreground hidden items-center gap-1.5 text-sm sm:flex">
                    <ProjectDot project={project} /> {project.name}
                  </span>
                )}
                {!isDone &&
                  (isRunning ? (
                    <Button size="sm" variant="outline" onClick={() => actions.stopTimer(undefined, [...runningEntries(entries)].find((e) => e.taskId === t.id)?.id)} aria-label={`Stop ${t.title}`}>
                      <Square /> Stop
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => actions.startTimer({ taskId: t.id })} aria-label={`Start ${t.title}`}>
                      <Play /> Start
                    </Button>
                  ))}
                <button
                  type="button"
                  onClick={() => actions.setTop(t.id, null)}
                  aria-label={`Remove ${t.title} from today's top 3`}
                  className="text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-md"
                >
                  <X className="size-4" />
                </button>
              </li>
            )
          })}
        </ol>
        {empty > 0 && <PickTopMenu day={today} label={top.length === 0 ? 'Pick your first task' : 'Pick another task'} />}
      </CardContent>
    </Card>
  )
}
