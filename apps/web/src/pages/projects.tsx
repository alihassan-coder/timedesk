import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { MoreHorizontal, Pencil, Play, Plus, Square, Trash2 } from 'lucide-react'
import type { Project, TimeEntry } from '@timedesk/shared'
import { entryDuration, formatDuration, formatHours, isHexColor, overlapMs, periodStart, runningEntries } from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { actions, useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { ProjectDot } from '@/components/project-dot'
import { PRESET_NAMES, PRESETS, PROJECT_COLORS, projectColor } from '@/lib/project-colors'
import { cn } from '@/lib/utils'

export default function ProjectsPage() {
  const [editing, setEditing] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const { projects, tasks, tracked, entries } = useStore()
  const timers = useMemo(() => runningEntries(entries), [entries])
  const taskProject = useMemo(() => new Map(tasks.map((t) => [t.id, t.projectId])), [tasks])
  const now = useNow(timers.length > 0)
  const monthStart = periodStart('month', now)

  return (
    <>
      <PageHeader
        title="Projects"
        description="Everything you track and plan belongs to a project."
        actions={<NewProjectDialog />}
      />
      {projects.length === 0 && (
        <div className="text-muted-foreground rounded-lg border border-dashed py-16 text-center text-sm">
          No projects yet. Use New project to create your first one.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => {
          const mine = tasks.filter((t) => t.projectId === p.id)
          const done = mine.filter((t) => t.status === 'done').length
          const month = tracked
            .filter((e) => e.projectId === p.id)
            .reduce((s, e) => s + overlapMs(e, monthStart, now + 1, now), 0)
          // A timer on one of the project's tasks counts for the project too.
          const running = timers.filter((e) => e.projectId === p.id || (e.taskId !== null && taskProject.get(e.taskId) === p.id))
          return (
            <ProjectCard
              key={p.id}
              project={p}
              done={done}
              total={mine.length}
              monthMs={month}
              running={running}
              now={now}
              onEdit={() => setEditing(p)}
              onDelete={() => setDeleting(p)}
            />
          )
        })}
      </div>
      <EditProjectDialog project={editing} onClose={() => setEditing(null)} />
      <DeleteProjectDialog project={deleting} onClose={() => setDeleting(null)} />
    </>
  )
}

function ProjectCard({
  project: p,
  done,
  total,
  monthMs,
  running,
  now,
  onEdit,
  onDelete,
}: {
  project: Project
  done: number
  total: number
  monthMs: number
  running: TimeEntry[]
  now: number
  onEdit: () => void
  onDelete: () => void
}) {
  const pct = total ? Math.round((done / total) * 100) : 0
  const open = total - done
  const live = running.length > 0
  const since = live ? Math.max(...running.map((e) => entryDuration(e, now))) : 0
  return (
    <Card
      // The project's own colour is the card's accent: its progress bar, and a ring while a timer runs on it.
      style={{ '--project': projectColor(p) } as CSSProperties}
      className={cn('transition-shadow', live && 'ring-2 ring-(--project)')}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ProjectDot project={p} className={cn(live && 'motion-safe:animate-pulse')} />
          <span className="min-w-0 flex-1 truncate" title={p.name}>
            {p.name}
          </span>
        </CardTitle>
        <CardDescription>
          {p.description ? <ClampedText text={p.description} /> : <span className="italic opacity-70">No description</span>}
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Options for ${p.name}`} />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil /> Edit project
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 /> Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      {/* flex-1 pushes the footer to the bottom, so cards of one row line up even when one has a longer description. */}
      <CardContent className="flex flex-1 flex-col justify-end gap-3">
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {total === 0 ? 'No tasks yet' : `${done} of ${total} tasks done`}
            </span>
            {total > 0 && <span className="tabular-nums">{pct}%</span>}
          </div>
          <Progress value={pct} className="[&_[data-slot=progress-indicator]]:bg-(--project)" />
        </div>
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{formatHours(monthMs)}</span>
          <span className="text-muted-foreground"> tracked this month</span>
        </p>
      </CardContent>
      <CardFooter className="justify-between gap-2">
        {live ? (
          <>
            <span className="flex items-center gap-2 text-sm font-medium" aria-live="polite">
              <span className="size-2 rounded-full bg-(--project) motion-safe:animate-pulse" aria-hidden />
              Tracking <span className="tabular-nums">{formatDuration(since)}</span>
            </span>
            <Button size="sm" variant="outline" onClick={() => running.forEach((e) => actions.stopTimer(undefined, e.id))}>
              <Square /> Stop
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => actions.startTimer({ projectId: p.id })}>
              <Play /> Start timer
            </Button>
            {open > 0 && (
              <span className="text-muted-foreground text-xs">
                {open} open task{open === 1 ? '' : 's'}
              </span>
            )}
          </>
        )}
      </CardFooter>
    </Card>
  )
}

/** Shows two lines; when the text is longer, "Show more" opens the rest in place. */
function ClampedText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])
  return (
    <>
      <p ref={ref} className={cn('break-words whitespace-pre-line', !open && 'line-clamp-2')}>
        {text}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          className="text-foreground/80 hover:text-foreground mt-0.5 text-xs font-medium underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}

type Colors = Pick<Project, 'color' | 'customColor'>

/**
 * Twelve presets, plus any colour at all: the system colour picker or a hex code (#3b82f6), for a client's brand
 * colour for example. The custom colour wins; picking a preset clears it.
 */
function ColorPicker({ value, onChange }: { value: Colors; onChange: (c: Colors) => void }) {
  const custom = isHexColor(value.customColor) ? value.customColor : null
  const [hex, setHex] = useState(custom ?? '')
  const v = hex.trim()
  const typed = v.startsWith('#') ? v : '#' + v
  const badHex = v !== '' && !isHexColor(typed)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Project colour">
        {PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={!custom && value.color === c}
            aria-label={PRESET_NAMES[c]}
            title={PRESET_NAMES[c]}
            onClick={() => {
              setHex('')
              onChange({ color: c, customColor: null })
            }}
            className={cn(
              'size-7 rounded-full ring-offset-2 ring-offset-background transition',
              !custom && value.color === c ? 'ring-2 ring-foreground' : 'hover:scale-110',
            )}
            style={{ backgroundColor: PROJECT_COLORS[c] }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={cn(
            'relative flex size-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border ring-offset-2 ring-offset-background',
            custom && 'ring-2 ring-foreground',
          )}
          style={{ background: custom ?? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
          title="Pick any colour"
        >
          <input
            type="color"
            aria-label="Custom colour"
            className="absolute inset-0 cursor-pointer opacity-0"
            value={custom ?? '#3b82f6'}
            onChange={(e) => {
              setHex(e.target.value)
              onChange({ color: value.color, customColor: e.target.value.toLowerCase() })
            }}
          />
        </label>
        <Input
          value={hex}
          onChange={(e) => {
            setHex(e.target.value)
            const t = e.target.value.trim()
            const h = t.startsWith('#') ? t : '#' + t
            if (isHexColor(h)) onChange({ color: value.color, customColor: h.toLowerCase() })
          }}
          placeholder="Custom: #3b82f6"
          aria-label="Custom colour code"
          aria-invalid={badHex}
          maxLength={7}
          className="h-8 w-36 font-mono text-sm"
        />
        {badHex && <span className="text-muted-foreground text-xs">Use 6 hex digits, like #3b82f6</span>}
      </div>
    </div>
  )
}

function EditProjectDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  return (
    <Dialog open={project !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {project && <EditProjectForm key={project.id} project={project} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function EditProjectForm({ project, onClose }: { project: Project; onClose: () => void }) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [colors, setColors] = useState<Colors>({ color: project.color, customColor: project.customColor ?? null })
  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit project</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          actions.updateProject(project.id, { name, description: description.trim(), ...colors })
          onClose()
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="ename">Name</Label>
          <Input id="ename" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edesc">Description</Label>
          <Input id="edesc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </div>
        <div className="space-y-2">
          <Label>Colour</Label>
          <ColorPicker value={colors} onChange={setColors} />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={!name.trim()}>
            Save changes
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

function DeleteProjectDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { tasks } = useStore()
  const count = project ? tasks.filter((t) => t.projectId === project.id).length : 0
  return (
    <Dialog open={project !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {project?.name}?</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          {count > 0 ? `Its ${count} task${count === 1 ? '' : 's'} and tracked time are kept and move to "No project".` : 'This project has no tasks.'} This cannot be undone.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (project) void actions.deleteProject(project.id)
              onClose()
            }}
          >
            Delete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NewProjectDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const { projects } = useStore()
  const [colors, setColors] = useState<Colors | null>(null)
  // A new project gets the next preset unless the person picks something.
  const shown = colors ?? { color: (projects.length % PRESETS.length) + 1, customColor: null }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus /> New project
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            actions.addProject(name, description, shown)
            setName('')
            setDescription('')
            setColors(null)
            setOpen(false)
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="pname">Name</Label>
            <Input id="pname" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pdesc">Description</Label>
            <Input id="pdesc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>
          <div className="space-y-2">
            <Label>Colour</Label>
            <ColorPicker value={shown} onChange={setColors} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim()}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
