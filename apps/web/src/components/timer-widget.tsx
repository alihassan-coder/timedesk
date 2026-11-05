import { ChevronDown, Play, Square } from 'lucide-react'
import { entryDuration, formatDuration } from '@timedesk/shared'
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
import { ProjectDot } from '@/lib/projects'

/** The timer lives in the top bar on every page, like TimeCamp. */
export function TimerWidget() {
  const { tasks, entries, projects } = useStore()
  const running = entries.find((e) => e.endedAt === null)
  const now = useNow(!!running)

  if (running) {
    const task = tasks.find((t) => t.id === running.taskId)
    const project = projects.find((p) => p.id === running.projectId)
    return (
      <div className="flex h-8 items-center gap-2 rounded-lg border pr-1 pl-2.5">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500/70" />
          <span className="relative inline-flex size-2 rounded-full bg-red-500" />
        </span>
        <ProjectDot project={project} />
        <span className="hidden max-w-40 truncate text-sm md:inline">{task?.title ?? project?.name ?? 'Stopwatch'}</span>
        <span className="text-sm font-medium">{formatDuration(entryDuration(running, now))}</span>
        <Button size="icon-sm" variant="destructive" aria-label="Stop timer" onClick={actions.stopTimer}>
          <Square />
        </Button>
      </div>
    )
  }

  const open = tasks.filter((t) => t.status !== 'done').slice(0, 8)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" />}>
        <Play /> Start timer <ChevronDown className="opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onClick={() => actions.startTimer({})}>
          <Play /> Stopwatch (no task)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Track a task</DropdownMenuLabel>
          {open.map((t) => (
            <DropdownMenuItem key={t.id} onClick={() => actions.startTimer({ taskId: t.id })}>
              <ProjectDot project={projects.find((p) => p.id === t.projectId)} />
              <span className="truncate">{t.title}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
