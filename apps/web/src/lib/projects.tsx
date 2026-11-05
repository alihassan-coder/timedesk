import type { Project } from '@timedesk/shared'
import { cn } from '@/lib/utils'

/** Project colours are fixed (not tied to the accent) so projects stay distinguishable in charts. */
export const PROJECT_COLORS: Record<Project['color'], string> = {
  1: 'oklch(0.62 0.19 260)',
  2: 'oklch(0.6 0.22 293)',
  3: 'oklch(0.65 0.17 155)',
  4: 'oklch(0.76 0.17 75)',
  5: 'oklch(0.63 0.22 17)',
}
export const NO_PROJECT_COLOR = 'oklch(0.7 0 0)'

export const projectColor = (p: Project | null | undefined) => (p ? PROJECT_COLORS[p.color] : NO_PROJECT_COLOR)

export function ProjectDot({ project, className }: { project: Project | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: projectColor(project) }}
    />
  )
}
