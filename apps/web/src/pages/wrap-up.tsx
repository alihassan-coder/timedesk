import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CalendarArrowUp, Check, MoonStar, Square, Star, X } from 'lucide-react'
import { addDays, dueBucket, entryDuration, formatHours, overlapMs, runningEntries, toDateKey, type Task } from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { ProjectDot } from '@/components/project-dot'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { actions, useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { FillGaps } from '@/features/fill-gaps'
import { PickTopMenu, topOf } from '@/features/top-tasks'
import { useProfile } from '@/lib/auth-client'
import { markWrapped, wrappedUp } from '@/lib/wrap-up'
import { cn } from '@/lib/utils'

const midnight = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function Step({ n, title, description, children, done }: { n: number; title: string; description?: string; children: React.ReactNode; done?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <span className={cn('flex size-7 items-center justify-center rounded-full text-sm font-semibold', done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
            {done ? <Check className="size-4" /> : n}
          </span>
          {title}
        </CardTitle>
        {description && <CardDescription className="pl-10">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="pl-16">{children}</CardContent>
    </Card>
  )
}

/**
 * The end of the day, in one place: stop the timers, fill in what was not tracked, see what got done, move what is
 * left to tomorrow, and pick tomorrow's top 3. Two minutes, and tomorrow starts with a plan.
 */
export default function WrapUpPage() {
  const { user } = useProfile()
  const { tasks, entries, tracked, projects } = useStore()
  const now = useNow(false)
  const today = toDateKey(now)
  const tomorrow = addDays(today, 1)
  const [finished, setFinished] = useState(() => (user ? wrappedUp(user.id, today) : false))

  const timers = useMemo(() => runningEntries(entries), [entries])
  const trackedToday = useMemo(() => tracked.reduce((s, e) => s + overlapMs(e, midnight(today), now + 1, now), 0), [tracked, today, now])
  const doneToday = useMemo(
    () => tasks.filter((t) => t.status === 'done' && t.completedAt !== null && t.completedAt >= midnight(today)).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    [tasks, today],
  )
  const topToday = useMemo(() => topOf(tasks, today), [tasks, today])
  const topTomorrow = useMemo(() => topOf(tasks, tomorrow), [tasks, tomorrow])
  // What is still open and was meant for today: due today or earlier, or in today's top 3.
  const leftOver = useMemo(
    () => tasks.filter((t) => t.status !== 'done' && (['overdue', 'today'].includes(dueBucket(t.due, now)) || t.topDay === today)),
    [tasks, now, today],
  )
  const [unticked, setUnticked] = useState<string[]>([])
  const [moved, setMoved] = useState<string[]>([])
  const toMove = leftOver.filter((t) => !unticked.includes(t.id))
  const projectOf = (t: Task) => projects.find((p) => p.id === t.projectId)

  if (finished) {
    return (
      <>
        <PageHeader title="Day wrapped up" description="Nicely done. Tomorrow starts with a plan." />
        <Card>
          <CardContent className="flex flex-col items-start gap-4 py-6">
            <MoonStar className="text-primary size-8" />
            <p className="text-lg">
              You tracked <strong>{formatHours(trackedToday)}</strong> and finished <strong>{doneToday.length}</strong> task{doneToday.length === 1 ? '' : 's'} today.
            </p>
            {topTomorrow.length > 0 && (
              <div>
                <p className="text-muted-foreground mb-1 text-sm">Tomorrow&apos;s top {topTomorrow.length}:</p>
                <ol className="list-decimal pl-5 text-sm">
                  {topTomorrow.map((t) => (
                    <li key={t.id}>{t.title}</li>
                  ))}
                </ol>
              </div>
            )}
            <div className="flex gap-2">
              <Button render={<Link to="/" />}>Back to the dashboard</Button>
              <Button variant="ghost" onClick={() => setFinished(false)}>
                Open the wrap-up again
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Wrap up your day" description="Five quick steps. Two minutes, and tomorrow starts with a plan." />

      <Step n={1} title="Stop your timers" done={timers.length === 0} description={timers.length ? 'Still running:' : 'No timer is running.'}>
        {timers.length > 0 && (
          <div className="space-y-2">
            <ul className="space-y-1 text-sm">
              {timers.map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <span className="size-2 animate-pulse rounded-full bg-red-500" />
                  {tasks.find((t) => t.id === e.taskId)?.title ?? projects.find((p) => p.id === e.projectId)?.name ?? 'Stopwatch'}
                  <span className="text-muted-foreground tabular-nums">{formatHours(entryDuration(e, now))}</span>
                </li>
              ))}
            </ul>
            <Button onClick={() => actions.stopTimer()}>
              <Square /> Stop {timers.length === 1 ? 'it' : 'all'} now
            </Button>
          </div>
        )}
      </Step>

      <Step n={2} title="Fill in the gaps" description="Time today that no timer covered, and what it probably was. Add it to a project, or skip it.">
        <FillGaps day={today} />
      </Step>

      <Step n={3} title="What you did today" done>
        <div className="space-y-3 text-sm">
          <p>
            <strong className="text-2xl">{formatHours(trackedToday)}</strong> <span className="text-muted-foreground">tracked</span>
          </p>
          {topToday.length > 0 && (
            <p>
              Top {topToday.length}: {topToday.filter((t) => t.status === 'done').length} done
              {topToday.every((t) => t.status === 'done') ? '. All of them.' : '.'}
            </p>
          )}
          {doneToday.length > 0 ? (
            <ul className="space-y-1">
              {doneToday.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <Check className="text-primary size-4" /> {t.title}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No task was ticked off today.</p>
          )}
        </div>
      </Step>

      <Step
        n={4}
        title="Move what is left to tomorrow"
        done={leftOver.length === 0 || leftOver.every((t) => moved.includes(t.id) || t.due === tomorrow)}
        description={leftOver.length ? 'Open tasks that were meant for today. Untick any you want to keep where they are.' : 'Nothing left over. Clean slate.'}
      >
        {leftOver.length > 0 && (
          <div className="space-y-3">
            <ul className="space-y-1.5">
              {leftOver.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!unticked.includes(t.id)}
                    onCheckedChange={(c) => setUnticked(c ? unticked.filter((x) => x !== t.id) : [...unticked, t.id])}
                    aria-label={`Move ${t.title} to tomorrow`}
                  />
                  {projectOf(t) && <ProjectDot project={projectOf(t)} />}
                  <span className={cn(moved.includes(t.id) && 'text-muted-foreground')}>{t.title}</span>
                  {moved.includes(t.id) && <span className="text-muted-foreground text-xs">moved to tomorrow</span>}
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              disabled={toMove.every((t) => moved.includes(t.id))}
              onClick={() => {
                actions.moveTo(
                  toMove.map((t) => t.id),
                  tomorrow,
                )
                setMoved([...moved, ...toMove.map((t) => t.id)])
              }}
            >
              <CalendarArrowUp /> Move {toMove.length} to tomorrow
            </Button>
          </div>
        )}
      </Step>

      <Step n={5} title="Pick tomorrow's top 3" done={topTomorrow.length > 0} description="The few tasks that matter most tomorrow. They wait at the top of your dashboard in the morning.">
        <div className="max-w-xl space-y-2">
          <ol className="space-y-2">
            {topTomorrow.map((t, i) => (
              <li key={t.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                <span className="text-muted-foreground w-4 font-medium">{i + 1}</span>
                <Star className="size-4 fill-amber-400 text-amber-500" />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <button
                  type="button"
                  aria-label={`Remove ${t.title} from tomorrow's top 3`}
                  onClick={() => actions.setTop(t.id, null)}
                  className="text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-md"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ol>
          {topTomorrow.length < 3 && <PickTopMenu day={tomorrow} label={topTomorrow.length ? 'Pick another' : 'Pick a task for tomorrow'} />}
        </div>
      </Step>

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={() => {
            if (user) markWrapped(user.id, today)
            setFinished(true)
          }}
        >
          <MoonStar /> Finish the day
        </Button>
      </div>
    </>
  )
}
