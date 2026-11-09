import { useEffect, useMemo, useState } from 'react'
import { AppWindow, CalendarClock, Check, CircleDashed } from 'lucide-react'
import { addDays, formatHours, suggestGaps, type ActivityBlock, type GapSuggestion } from '@timedesk/shared'
import { ProjectDot } from '@/components/project-dot'
import { SimpleSelect } from '@/components/simple-select'
import { Button } from '@/components/ui/button'
import { actions, useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { api } from '@/lib/api'
import { useProfile } from '@/lib/auth-client'
import { isDesktop } from '@/lib/desktop'
import { useGoogleEvents, useGoogleStatus } from '@/lib/google'

/** Local midnight of a YYYY-MM-DD key. */
const midnight = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}
const NONE = 'none'
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Suggestions the person skipped, per day, on this device, so they do not come back. */
const skipKey = (userId: string, day: string) => `timedesk:fill-skip:${userId}:${day}`
function readSkipped(userId: string, day: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(skipKey(userId, day)) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function saveSkipped(userId: string, day: string, ids: string[]) {
  try {
    localStorage.setItem(skipKey(userId, day), JSON.stringify(ids))
  } catch {
    // storage blocked: skipped items come back next time, nothing worse
  }
}

/** The app use for a day and the learned app-to-project guesses (desktop app tracking). */
function useTimeline(from: number, to: number) {
  const [data, setData] = useState<{ blocks: ActivityBlock[]; appProjects: Record<string, string> } | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    const q = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() })
    api<{ blocks: ActivityBlock[]; appProjects: Record<string, string> }>(`/activity/timeline?${q}`)
      .then((r) => live && (setData(r), setFailed(false)))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
    // Loaded once per day shown, and again every 5 minutes for today (the minute key changes).
  }, [from, Math.floor(to / 300_000)]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, failed }
}

/**
 * The untracked parts of a day, with a good guess of what each was: a meeting from the calendar, the apps that were
 * in front, or just "not tracked". Pick a project (or task) and Add, or Skip. Nothing is added without a click.
 */
export function FillGaps({ day }: { day: string }) {
  const { user } = useProfile()
  const { entries, projects, tasks } = useStore()
  const now = useNow(false)
  const from = midnight(day)
  const to = Math.min(now, midnight(addDays(day, 1)))
  const { data, failed } = useTimeline(from, to)
  const google = useGoogleStatus()
  const connected = !!google.status?.connected
  const { events } = useGoogleEvents(day, addDays(day, 1), connected)
  const [skipped, setSkipped] = useState<string[]>(() => (user ? readSkipped(user.id, day) : []))
  const [choice, setChoice] = useState<Record<string, { projectId: string; taskId: string }>>({})

  const suggestions = useMemo(() => {
    const timed = events.filter((e) => !e.allDay).map((e) => ({ title: e.title, start: Date.parse(e.start), end: Date.parse(e.end) }))
    return suggestGaps({ entries, activity: data?.blocks ?? [], events: timed, from, to, now, appProjects: data?.appProjects }).filter((s) => !skipped.includes(s.id))
  }, [entries, data, events, from, to, now, skipped])

  /** 'none' stands for no project or no task (the select needs a value). */
  const pick = (s: GapSuggestion) => choice[s.id] ?? { projectId: s.projectId ?? NONE, taskId: NONE }
  const skip = (id: string) => {
    const next = [...skipped, id]
    setSkipped(next)
    if (user) saveSkipped(user.id, day, next)
  }
  const add = (s: GapSuggestion) => {
    const c = pick(s)
    actions.addEntry({ startedAt: s.start, endedAt: s.end, projectId: c.projectId === NONE ? null : c.projectId, taskId: c.taskId === NONE ? null : c.taskId })
  }
  const ready = suggestions.filter((s) => pick(s).projectId !== NONE)

  if (suggestions.length === 0) {
    return (
      <div className="text-muted-foreground space-y-1 text-sm">
        <p className="flex items-center gap-2">
          <Check className="text-primary size-4" /> Nothing to fill in: every part of this day that we know about is tracked.
        </p>
        {!data?.blocks.length && (isDesktop() || failed) && (
          <p className="text-xs">Tip: turn on app tracking in the desktop app (Settings, Desktop) and timedesk can suggest what you worked on.</p>
        )}
      </div>
    )
  }

  const projectOptions = [{ value: NONE, label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]
  return (
    <div className="space-y-3" data-testid="fill-gaps">
      <ul className="divide-y rounded-lg border">
        {suggestions.map((s) => {
          const c = pick(s)
          const project = projects.find((p) => p.id === c.projectId)
          const taskOptions = [
            { value: NONE, label: 'No task' },
            ...tasks.filter((t) => (t.projectId ?? NONE) === c.projectId && (t.status !== 'done' || t.topDay === day)).map((t) => ({ value: t.id, label: t.title })),
          ]
          const Icon = s.kind === 'meeting' ? CalendarClock : s.kind === 'activity' ? AppWindow : CircleDashed
          return (
            <li key={s.id} className="flex flex-col gap-2 p-3 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Icon className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {s.kind === 'meeting' ? `Meeting: ${s.label}` : s.label}
                  </p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {clock(s.start)} to {clock(s.end)} · {formatHours(s.end - s.start)}
                    {s.projectId && project && ' · usually ' + project.name}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5">
                  {project && <ProjectDot project={project} />}
                  <SimpleSelect size="sm" className="w-40" value={c.projectId} onChange={(v) => setChoice({ ...choice, [s.id]: { projectId: v, taskId: NONE } })} options={projectOptions} />
                </span>
                <SimpleSelect size="sm" className="w-40" value={c.taskId} onChange={(v) => setChoice({ ...choice, [s.id]: { ...c, taskId: v } })} options={taskOptions} />
                <Button size="sm" onClick={() => add(s)} aria-label={`Add ${clock(s.start)} to ${clock(s.end)}`}>
                  Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => skip(s.id)} aria-label={`Skip ${clock(s.start)} to ${clock(s.end)}`}>
                  Skip
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      {ready.length > 1 && (
        <Button variant="outline" size="sm" onClick={() => ready.forEach(add)}>
          Add all {ready.length} with a project
        </Button>
      )}
    </div>
  )
}
