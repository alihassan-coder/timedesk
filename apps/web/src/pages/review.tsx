import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { addDays, buildDigest, dueBucket, formatHours, startOfWeek, toDateKey, zonedDays } from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ProjectDot } from '@/components/project-dot'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { api } from '@/lib/api'
import { askTempoLink, TEMPO_PROMPTS } from '@/features/assistant/tempo-prompts'

const config = { hours: { label: 'Hours', color: 'var(--chart-3)' } } satisfies ChartConfig
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

interface Review {
  weekStart: string
  wentWell: string
  improve: string
  updatedAt: string | null
}

function weekLabel(monday: string, thisMonday: string) {
  if (monday === thisMonday) return 'This week'
  if (monday === addDays(thisMonday, -7)) return 'Last week'
  const f = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return `${f(monday)} to ${f(addDays(monday, 6))}`
}

export default function ReviewPage() {
  const { tasks, entries, projects } = useStore()
  const now = useNow(false)
  const thisMonday = startOfWeek(toDateKey(now))
  const [monday, setMonday] = useState(thisMonday)
  const isThisWeek = monday === thisMonday

  const digest = useMemo(() => {
    const days = zonedDays(monday, addDays(monday, 6), ZONE)
    const previousDays = zonedDays(addDays(monday, -7), addDays(monday, -1), ZONE)
    return buildDigest({ days, previousDays, entries, tasks, projects, now })
  }, [monday, entries, tasks, projects, now])

  const change = digest.previousTotalMs ? Math.round(((digest.totalMs - digest.previousTotalMs) / digest.previousTotalMs) * 100) : null
  // Under a minute rounds to "0m": not worth calling anything the best day or the main project.
  const top = digest.byProject[0]?.ms >= 60_000 ? digest.byProject[0] : undefined
  const bestDay = digest.bestDay && digest.bestDay.ms >= 60_000 ? digest.bestDay : null
  const topProject = top?.projectId ? projects.find((p) => p.id === top.projectId) : undefined
  const data = digest.byDay.map((d) => ({
    day: new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' }),
    hours: Math.round((d.ms / 3_600_000) * 10) / 10,
  }))
  // This week: what is overdue or due today now. A past week: what was due in it and is still open.
  const carry = tasks.filter((t) =>
    t.status === 'done'
      ? false
      : isThisWeek
        ? ['overdue', 'today'].includes(dueBucket(t.due, now))
        : t.due !== null && t.due >= monday && t.due <= addDays(monday, 6),
  )

  return (
    <>
      <PageHeader
        title="Weekly review"
        description="Look back at a week, write down what you learned, and plan the next one."
        actions={
          <Button variant="outline" render={<Link to={askTempoLink(isThisWeek ? TEMPO_PROMPTS.week : `${TEMPO_PROMPTS.week} for the week of ${monday}`)} />}>
            <Sparkles /> Ask Tempo
          </Button>
        }
      />

      <div className="flex items-center gap-2">
        <Button size="icon-sm" variant="outline" aria-label="Previous week" onClick={() => setMonday(addDays(monday, -7))}>
          <ChevronLeft />
        </Button>
        <Button size="icon-sm" variant="outline" aria-label="Next week" disabled={isThisWeek} onClick={() => setMonday(addDays(monday, 7))}>
          <ChevronRight />
        </Button>
        <h2 className="text-sm font-medium" aria-live="polite">
          {weekLabel(monday, thisMonday)}
        </h2>
        {!isThisWeek && (
          <Button size="sm" variant="ghost" onClick={() => setMonday(thisMonday)}>
            Back to this week
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total tracked</CardDescription>
            <CardTitle className="text-3xl">{formatHours(digest.totalMs)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            {change === null ? 'Nothing tracked the week before' : `${change >= 0 ? '+' : ''}${change}% vs the week before`}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Best day</CardDescription>
            <CardTitle className="text-3xl">
              {bestDay ? new Date(`${bestDay.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' }) : '-'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">{bestDay ? `${formatHours(bestDay.ms)} tracked` : 'No time tracked'}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Most time on</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {top ? (
                <>
                  {topProject && <ProjectDot project={topProject} />} {top.name}
                </>
              ) : (
                '-'
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">{top ? `${formatHours(top.ms)} this week` : 'No time tracked'}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily hours</CardTitle>
          <CardDescription>Monday to Sunday</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-44 w-full">
            <BarChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Bar isAnimationActive={false} dataKey="hours" fill="var(--color-hours)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Wins</CardTitle>
            <CardDescription>
              {digest.completed.length} task{digest.completed.length === 1 ? '' : 's'} finished this week
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm" data-testid="wins">
              {digest.completed.map((t) => (
                <li key={t.id}>
                  {t.title}
                  {t.project && <span className="text-muted-foreground"> · {t.project}</span>}
                </li>
              ))}
              {digest.completed.length === 0 && <li className="text-muted-foreground">Nothing finished in this week.</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Carry over</CardTitle>
            <CardDescription>{isThisWeek ? 'Overdue or due today' : 'Was due this week and is still open'}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {carry.map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
              {carry.length === 0 && <li className="text-muted-foreground">Nothing carried over.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Reflection key={monday} monday={monday} />
    </>
  )
}

/** The written part of the review, saved per week. Tempo reads it for its weekly review. */
function Reflection({ monday }: { monday: string }) {
  const [loaded, setLoaded] = useState(false)
  const [wentWell, setWentWell] = useState('')
  const [improve, setImprove] = useState('')
  const [saved, setSaved] = useState<{ wentWell: string; improve: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Set when the load failed: the fields stay locked, because saving blank fields would overwrite the real reflection.
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    api<{ review: Review }>(`/reviews/${monday}`)
      .then(({ review }) => {
        if (!live) return
        setWentWell(review.wentWell)
        setImprove(review.improve)
        setSaved({ wentWell: review.wentWell, improve: review.improve })
        setLoadError('')
        setLoaded(true)
      })
      .catch((e: unknown) => {
        if (!live) return
        setLoadError(e instanceof Error ? e.message : 'Could not load the review.')
      })
    return () => {
      live = false
    }
  }, [monday, attempt])

  const dirty = !saved || saved.wentWell !== wentWell.trim() || saved.improve !== improve.trim()
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const { review } = await api<{ review: Review }>(`/reviews/${monday}`, { method: 'PUT', body: { wentWell, improve } })
      setSaved({ wentWell: review.wentWell, improve: review.improve })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the review.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reflect</CardTitle>
        <CardDescription>Saved to your account. Tempo uses it in your weekly review, and reminds you of your plan next week.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="well">What went well?</Label>
          <Textarea id="well" maxLength={4000} disabled={!loaded} value={wentWell} onChange={(e) => setWentWell(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="improve">What will you change next week?</Label>
          <Textarea id="improve" maxLength={4000} disabled={!loaded} value={improve} onChange={(e) => setImprove(e.target.value)} />
        </div>
        {(error || loadError) && (
          <p role="alert" className="text-destructive text-sm">
            {loadError ? `Could not load your reflection: ${loadError}` : error}
          </p>
        )}
        {loadError && !loaded ? (
          <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </Button>
        ) : (
          <Button onClick={() => void save()} disabled={!loaded || busy || !dirty}>
            {busy ? 'Saving...' : dirty ? 'Save review' : 'Saved'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
