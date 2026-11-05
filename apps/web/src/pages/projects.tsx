import { useState } from 'react'
import { Play, Plus } from 'lucide-react'
import { formatHours, overlapMs, periodStart } from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { actions, useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { ProjectDot } from '@/lib/projects'

export default function ProjectsPage() {
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
                  <ProjectDot project={p} /> {p.name}
                </CardTitle>
                <CardDescription>{p.description || 'No description'}</CardDescription>
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
    </>
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
