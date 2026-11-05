import { Repeat } from 'lucide-react'
import { daysUntil, describeRecurrence, type Task, type TaskStatus } from '@timedesk/shared'
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

export function TaskRow({ task, now, showProject = true }: { task: Task; now: number; showProject?: boolean }) {
  const { projects } = useStore()
  const project = projects.find((p) => p.id === task.projectId)
  const done = task.status === 'done'
  const overdue = !done && task.due !== null && daysUntil(task.due, now) < 0
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
          {dueLabel(task.due, now)}
        </span>
      )}
      <StatusMenu task={task} />
    </li>
  )
}
