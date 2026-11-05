import type { Project } from '@timedesk/shared'
import { projectColor } from '@/lib/project-colors'
import { cn } from '@/lib/utils'

export function ProjectDot({ project, className }: { project: Project | null | undefined; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ backgroundColor: projectColor(project) }} />
}
