import { useState } from 'react'
import { MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import type { Project } from '@timedesk/shared'
import { formatHours, overlapMs, periodStart } from '@timedesk/shared'
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
import { PROJECT_COLORS } from '@/lib/project-colors'
import { cn } from '@/lib/utils'

export default function ProjectsPage() {
  const [editing, setEditing] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const { projects, tasks, entries } = useStore()
  const now = useNow(false)
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
          const pct = mine.length ? Math.round((done / mine.length) * 100) : 0
          const month = entries
            .filter((e) => e.projectId === p.id)
            .reduce((s, e) => s + overlapMs(e, monthStart, now + 1, now), 0)
          return (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ProjectDot project={p} /> <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </CardTitle>
                <CardDescription>{p.description || 'No description'}</CardDescription>
                <CardAction>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Options for ${p.name}`} />}>
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditing(p)}>
                        <Pencil /> Edit project
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleting(p)}>
                        <Trash2 /> Delete project
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {done} of {mine.length} tasks done
                    </span>
                    <span>{pct}%</span>
                  </div>
                  <Progress value={pct} />
                </div>
                <p className="text-sm">
                  <span className="text-2xl font-semibold">{formatHours(month)}</span>
                  <span className="text-muted-foreground"> tracked this month</span>
                </p>
              </CardContent>
              <CardFooter>
                <Button size="sm" variant="outline" onClick={() => actions.startTimer({ projectId: p.id })}>
                  <Play /> Start timer
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
      <EditProjectDialog project={editing} onClose={() => setEditing(null)} />
      <DeleteProjectDialog project={deleting} onClose={() => setDeleting(null)} />
    </>
  )
}

function ColorPicker({ value, onChange }: { value: Project['color']; onChange: (c: Project['color']) => void }) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label="Project colour">
      {([1, 2, 3, 4, 5] as const).map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`Colour ${c}`}
          onClick={() => onChange(c)}
          className={cn('size-7 rounded-full ring-offset-2 ring-offset-background transition', value === c ? 'ring-2 ring-foreground' : 'hover:scale-110')}
          style={{ backgroundColor: PROJECT_COLORS[c] }}
        />
      ))}
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
  const [color, setColor] = useState(project.color)
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
          void actions.updateProject(project.id, { name, description: description.trim(), color })
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
          <ColorPicker value={color} onChange={setColor} />
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
            actions.addProject(name, description)
            setName('')
            setDescription('')
            setOpen(false)
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="pname">Name</Label>
            <Input id="pname" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pdesc">Description</Label>
            <Input id="pdesc" value={description} onChange={(e) => setDescription(e.target.value)} />
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
