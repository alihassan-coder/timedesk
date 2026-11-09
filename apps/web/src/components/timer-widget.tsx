import { memo, useMemo } from 'react'
import { ChevronDown, Layers, Play, Plus, Square } from 'lucide-react'
import { entryDuration, formatDuration, runningEntries, type Project, type Task, type TimeEntry } from '@timedesk/shared'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { actions, useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { ProjectDot } from '@/components/project-dot'

const nameOf = (e: TimeEntry, tasks: Task[], projects: Project[]) =>
  tasks.find((t) => t.id === e.taskId)?.title ?? projects.find((p) => p.id === e.projectId)?.name ?? 'Stopwatch'

/** A running clock. Only this small piece re-renders every second. */
function Clock({ entry }: { entry: TimeEntry }) {
  const now = useNow(true)
  return <span className="text-sm font-medium tabular-nums">{formatDuration(entryDuration(entry, now))}</span>
}

/**
 * The timer in the top bar, on every page. One timer normally runs at a time; starting another switches to it. For
 * multitasking, "Also track" starts one alongside: then each is listed with its own Stop, and the time they overlap
 * is shared between them in every total, so the day still adds up to the clock.
 */
export const TimerWidget = memo(function TimerWidget() {
  const { tasks, entries, projects } = useStore()
  const timers = useMemo(() => runningEntries(entries), [entries])
  const open = useMemo(() => tasks.filter((t) => t.status !== 'done').slice(0, 8), [tasks])
  const newest = timers[0]
  const runningTasks = new Set(timers.map((e) => e.taskId))

  const startMenu = (
    <DropdownMenuContent align="end" className="w-72">
      {!newest && (
        <>
          <DropdownMenuItem onClick={() => actions.startTimer({})}>
            <Play /> Stopwatch (no task)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      {newest && (
        <>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Running now</DropdownMenuLabel>
            {timers.map((e) => (
              <DropdownMenuItem key={e.id} onClick={() => actions.stopTimer(undefined, e.id)} aria-label={`Stop ${nameOf(e, tasks, projects)}`}>
                <Square className="text-destructive" />
                <span className="flex-1 truncate">{nameOf(e, tasks, projects)}</span>
                <Clock entry={e} />
              </DropdownMenuItem>
            ))}
            {timers.length > 1 && (
              <DropdownMenuItem onClick={() => actions.stopTimer()}>
                <Square /> Stop all
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuGroup>
        <DropdownMenuLabel>{newest ? 'Switch to' : 'Track a task'}</DropdownMenuLabel>
        {open.map((t) => (
          <DropdownMenuItem key={t.id} onClick={() => actions.startTimer({ taskId: t.id })}>
            <ProjectDot project={projects.find((p) => p.id === t.projectId)} />
            <span className="truncate">{t.title}</span>
          </DropdownMenuItem>
        ))}
        {open.length === 0 && <DropdownMenuItem disabled>No open tasks</DropdownMenuItem>}
      </DropdownMenuGroup>
      {newest && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <Layers className="size-3.5" /> Also track (multitask)
            </DropdownMenuLabel>
            {open
              .filter((t) => !runningTasks.has(t.id))
              .map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => actions.startTimer({ taskId: t.id }, { parallel: true })} aria-label={`Also track ${t.title}`}>
                  <Plus />
                  <span className="truncate">{t.title}</span>
                </DropdownMenuItem>
              ))}
            {!runningTasks.has(null) && (
              <DropdownMenuItem onClick={() => actions.startTimer({}, { parallel: true })}>
                <Plus /> A stopwatch alongside
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </>
      )}
    </DropdownMenuContent>
  )

  if (newest) {
    const project = projects.find((p) => p.id === newest.projectId)
    return (
      <div className="flex h-8 items-center gap-2 rounded-lg border pr-1 pl-2.5">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500/70" />
          <span className="relative inline-flex size-2 rounded-full bg-red-500" />
        </span>
        <ProjectDot project={project} />
        <span className="hidden max-w-40 truncate text-sm md:inline">{nameOf(newest, tasks, projects)}</span>
        <Clock entry={newest} />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5" aria-label={timers.length > 1 ? `${timers.length} timers running` : 'Timer options'} />
            }
          >
            {timers.length > 1 && (
              <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[10px] leading-4 font-semibold">{timers.length}</span>
            )}
            <ChevronDown className="opacity-70" />
          </DropdownMenuTrigger>
          {startMenu}
        </DropdownMenu>
        <Button size="icon-sm" variant="destructive" aria-label={timers.length > 1 ? 'Stop all timers' : 'Stop timer'} onClick={() => actions.stopTimer()}>
          <Square />
        </Button>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" />}>
        <Play /> Start timer <ChevronDown className="opacity-70" />
      </DropdownMenuTrigger>
      {startMenu}
    </DropdownMenu>
  )
})
