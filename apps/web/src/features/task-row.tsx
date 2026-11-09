import { memo } from 'react'
import { Repeat } from 'lucide-react'
import { daysUntil, describeRecurrence, toDateKey, type Project, type Task, type TaskStatus } from '@timedesk/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { actions, useStore } from '@/data/store'
import { dueLabel, PRIORITY_LABEL, STATUS_LABEL } from '@/features/task-labels'
import { ProjectDot } from '@/components/project-dot'
import { cn } from '@/lib/utils'

const PRIORITY_VARIANT = { low: 'outline', medium: 'secondary', high: 'destructive' } as const

export function StatusMenu({ task }: { task: Task }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="xs" variant="outline" />}>{STATUS_LABEL[task.status]}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
          <DropdownMenuItem key={s} onClick={() => actions.setStatus(task.id, s)}>
            {STATUS_LABEL[s]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Local noon of a YYYY-MM-DD key: a time that is safely inside that day, for the date helpers. */
const noonOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

type TaskRowProps = {
  task: Task
  /** The task's project (null for none). Leave it out and the row looks it up in the store itself. */
  project?: Project | null
  showProject?: boolean
} & (
  | {
      /** Today's date key. Preferred over `now`: it only changes once a day, so memoised rows stay put. */
      today: string
      now?: undefined
    }
  | {
      /** Older callers pass the current time instead. */
      now: number
      today?: undefined
    }
)

/** A task in a list. Memoised: pass `today` and `project` so a store change re-renders only the rows that changed. */
export const TaskRow = memo(function TaskRow({ task, today, now, project, showProject = true }: TaskRowProps) {
  const day = today ?? toDateKey(now as number)
  if (project === undefined && task.projectId) return <TaskRowWithLookup task={task} today={day} showProject={showProject} />
  return <TaskRowView task={task} today={day} project={project ?? undefined} showProject={showProject} />
})

function TaskRowWithLookup({ task, today, showProject }: { task: Task; today: string; showProject: boolean }) {
  const { projects } = useStore()
  return <TaskRowView task={task} today={today} project={projects.find((p) => p.id === task.projectId)} showProject={showProject} />
}

function TaskRowView({ task, today, project, showProject }: { task: Task; today: string; project: Project | undefined; showProject: boolean }) {
  const at = noonOf(today)
  const done = task.status === 'done'
  const overdue = !done && task.due !== null && daysUntil(task.due, at) < 0
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Checkbox checked={done} onCheckedChange={(c) => actions.setStatus(task.id, c ? 'done' : 'todo')} aria-label={`Complete ${task.title}`} />
      <span className={cn('min-w-0 flex-1 truncate', done && 'text-muted-foreground line-through')}>{task.title}</span>
      {task.recurrence && (
        <span title={describeRecurrence(task.recurrence)} className="text-muted-foreground">
          <Repeat className="size-3.5" />
        </span>
      )}
      {showProject && project && (
        <span className="text-muted-foreground hidden items-center gap-1.5 text-sm md:flex">
          <ProjectDot project={project} /> {project.name}
        </span>
      )}
      <Badge variant={PRIORITY_VARIANT[task.priority]} className="hidden sm:inline-flex">
        {PRIORITY_LABEL[task.priority]}
      </Badge>
      {task.due && (
        <span className={cn('w-20 text-right text-sm', overdue ? 'text-destructive font-medium' : 'text-muted-foreground')}>
          {dueLabel(task.due, at)}
        </span>
      )}
      <StatusMenu task={task} />
    </li>
  )
}
