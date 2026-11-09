import { Link } from 'react-router'
import { CalendarRange, NotebookPen, Sparkles, Sunrise } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, XAxis } from 'recharts'
import { useMemo } from 'react'
import { dailyTotals, dueBucket, formatHours, overlapMs, periodStart, type TimeEntry } from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { FocusSummaryCard } from '@/features/focus'
import { TaskRow } from '@/features/task-row'
import { askTempoLink, TEMPO_PROMPTS } from '@/features/assistant/tempo-prompts'
import { useProfile } from '@/lib/auth-client'
import { projectColor } from '@/lib/project-colors'

const trendConfig = { hours: { label: 'Hours', color: 'var(--chart-3)' } } satisfies ChartConfig

function greeting(hour: number) {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

export default function Dashboard() {
  const { tasks, entries, tracked, projects, ready } = useStore()
  const { user } = useProfile()
  // The page refreshes once a minute; only the "Tracked today" figure ticks every second (see LiveToday).
  const now = useNow(false)
  const minute = Math.floor(now / 60_000)

  const { days, trend, byProject, pieConfig } = useMemo(() => {
    const at = minute * 60_000
    const days = dailyTotals(tracked, at, 14)
    const trend = days.map((d) => ({
      day: new Date(d.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      hours: Math.round((d.ms / 3_600_000) * 10) / 10,
    }))
    // One pass over the entries for the last 7 days, instead of one per project.
    const from = periodStart('day', at - 6 * 86_400_000)
    const perProject = new Map<string, number>()
    for (const e of tracked) {
      if (!e.projectId || (e.endedAt !== null && e.endedAt < from)) continue
      perProject.set(e.projectId, (perProject.get(e.projectId) ?? 0) + overlapMs(e, from, at + 1, at))
    }
    const byProject = projects
      .map((p) => ({ id: p.id, name: p.name, ms: perProject.get(p.id) ?? 0, fill: projectColor(p) }))
      .filter((p) => p.ms > 0)
    const pieConfig = Object.fromEntries(byProject.map((p) => [p.id, { label: p.name, color: p.fill }])) satisfies ChartConfig
    return { days, trend, byProject, pieConfig }
  }, [tracked, projects, minute])

  const yesterday = days[12].ms
  const week = days.slice(7).reduce((s, d) => s + d.ms, 0)
  const prevWeek = days.slice(0, 7).reduce((s, d) => s + d.ms, 0)
  const open = tasks.filter((t) => t.status !== 'done')
  const dueToday = open.filter((t) => dueBucket(t.due, now) === 'today').length
  const overdue = open.filter((t) => dueBucket(t.due, now) === 'overdue').length
  const doneCount = tasks.filter((t) => t.status === 'done').length

  const delta = (a: number, b: number) => (b === 0 ? '' : `${a >= b ? '+' : '-'}${formatHours(Math.abs(a - b))} vs previous`)
  const stats = [
    { label: 'Tracked today', value: <LiveToday tracked={tracked} yesterday={yesterday} />, note: '' },
    { label: 'Last 7 days', value: formatHours(week), note: delta(week, prevWeek) },
    { label: 'Due today', value: String(dueToday), note: `${open.length} open in total` },
    { label: 'Overdue', value: String(overdue), note: `${doneCount} completed` },
  ]

  const focus = open
    .filter((t) => ['overdue', 'today'].includes(dueBucket(t.due, now)))
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))

  const firstName = user?.name.split(' ')[0]
  const isNew = ready && projects.length === 0 && tasks.length === 0 && entries.length === 0

  return (
    <>
      <PageHeader
        title={`${greeting(new Date(now).getHours())}${firstName ? `, ${firstName}` : ''}`}
        description={new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={
          <Button variant="outline" render={<Link to="/tasks" />}>
            Add task
          </Button>
        }
      />

      {isNew && (
        <Card>
          <CardHeader>
            <CardTitle>Welcome to timedesk</CardTitle>
            <CardDescription>Nothing here yet. Start with a project, add a task, then start the timer from the top bar.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button render={<Link to="/projects" />}>Create a project</Button>
            <Button variant="outline" render={<Link to="/tasks" />}>
              Add a task
            </Button>
            <Button variant="outline" render={<Link to="/assistant" />}>
              Ask Tempo
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-3xl">{s.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">{s.note || ' '}</CardContent>
          </Card>
        ))}
      </div>

      {!isNew && <TempoCard now={now} />}
      {!isNew && <FocusSummaryCard now={now} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Time tracked</CardTitle>
            <CardDescription>Hours per day, last 14 days</CardDescription>
          </CardHeader>
          <CardContent>
            {week + prevWeek === 0 ? (
              <p className="text-muted-foreground flex h-56 items-center justify-center text-sm">No time tracked yet. Start the timer to see your days here.</p>
            ) : (
              <ChartContainer config={trendConfig} className="h-56 w-full">
                <AreaChart data={trend} margin={{ left: 4, right: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} interval={1} padding={{ left: 12, right: 12 }} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                  <Area isAnimationActive={false} dataKey="hours" type="monotone" stroke="var(--color-hours)" fill="var(--color-hours)" fillOpacity={0.2} strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By project</CardTitle>
            <CardDescription>Last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            {byProject.length === 0 ? (
              <p className="text-muted-foreground flex h-40 items-center justify-center text-center text-sm">Track time on a project to see the split.</p>
            ) : (
              <>
                <ChartContainer config={pieConfig} className="mx-auto h-40 w-full">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(_v, _n, item) => `${item.payload.name}: ${formatHours(item.payload.ms)}`} />} />
                    <Pie isAnimationActive={false} data={byProject} dataKey="ms" nameKey="id" innerRadius={42} strokeWidth={2}>
                      {byProject.map((p) => (
                        <Cell key={p.id} fill={p.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {byProject.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: p.fill }} />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-muted-foreground">{formatHours(p.ms)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
          <CardDescription>Overdue and due today</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {focus.length === 0 ? (
            <p className="text-muted-foreground px-6 text-sm">Nothing is due. Tasks with a due date of today or earlier show up here.</p>
          ) : (
            <ul className="divide-y">
              {focus.map((t) => (
                <TaskRow key={t.id} task={t} now={now} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}

/**
 * Tempo's three briefings, one click each. The one that fits the moment is highlighted: plan in the morning,
 * summary in the evening, weekly review at the end of the week.
 */
/** "Tracked today": the one figure that changes every second while a timer runs, so only it re-renders. */
function LiveToday({ tracked, yesterday }: { tracked: TimeEntry[]; yesterday: number }) {
  const running = tracked.some((e) => e.endedAt === null)
  const now = useNow(running)
  const from = periodStart('day', now)
  let today = 0
  for (const e of tracked) if (e.endedAt === null || e.endedAt > from) today += overlapMs(e, from, now + 1, now)
  return (
    <span className="flex flex-col">
      {formatHours(today)}
      <span className="text-muted-foreground mt-1.5 text-xs font-normal">
        {yesterday === 0 ? ' ' : `${today >= yesterday ? '+' : '-'}${formatHours(Math.abs(today - yesterday))} vs yesterday`}
      </span>
    </span>
  )
}

function TempoCard({ now }: { now: number }) {
  const d = new Date(now)
  const weekEnd = d.getDay() === 5 || d.getDay() === 6 || d.getDay() === 0
  const suggested = weekEnd && d.getHours() >= 14 ? 'week' : d.getHours() < 13 ? 'plan' : 'day'
  const items = [
    { id: 'plan', prompt: TEMPO_PROMPTS.plan, icon: Sunrise, text: 'Your most important tasks, fitted around your calendar.' },
    { id: 'day', prompt: TEMPO_PROMPTS.day, icon: NotebookPen, text: 'What you tracked and finished today, and what is left.' },
    { id: 'week', prompt: TEMPO_PROMPTS.week, icon: CalendarRange, text: 'Your week compared with the last one, wins and what to change.' },
  ] as const
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" /> Ask Tempo
        </CardTitle>
        <CardDescription>Briefings written from your own tracked time, tasks and calendar.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {items.map((i) => (
          <Link
            key={i.id}
            to={askTempoLink(i.prompt)}
            className={
              'hover:bg-accent focus-visible:ring-ring flex gap-3 rounded-lg border p-3 transition-colors outline-none focus-visible:ring-2 ' +
              (suggested === i.id ? 'border-primary/50 bg-primary/5' : '')
            }
          >
            <i.icon className="text-primary mt-0.5 size-5 shrink-0" />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium">
                {i.prompt}
                {suggested === i.id && <span className="bg-primary text-primary-foreground rounded px-1.5 py-0.5 text-[10px] font-medium">Now</span>}
              </span>
              <span className="text-muted-foreground mt-0.5 block text-xs">{i.text}</span>
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
