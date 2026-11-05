import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import { dailyTotals, dueBucket, formatHours, overlapMs } from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { ProjectDot } from '@/components/project-dot'

const config = { hours: { label: 'Hours', color: 'var(--chart-3)' } } satisfies ChartConfig

export default function ReviewPage() {
  const { tasks, entries, projects } = useStore()
  const now = useNow(false)
  const [wentWell, setWentWell] = useState('')
  const [improve, setImprove] = useState('')
  const [saved, setSaved] = useState(false)

  const week = dailyTotals(entries, now, 7)
  const prev = dailyTotals(entries, now - 7 * 86_400_000, 7)
  const total = week.reduce((s, d) => s + d.ms, 0)
  const prevTotal = prev.reduce((s, d) => s + d.ms, 0)
  const best = week.reduce((a, b) => (b.ms > a.ms ? b : a))
  const data = week.map((d) => ({
    day: new Date(d.start).toLocaleDateString(undefined, { weekday: 'short' }),
    hours: Math.round((d.ms / 3_600_000) * 10) / 10,
  }))

  const from = week[0].start
  const top = projects
    .map((p) => ({ p, ms: entries.filter((e) => e.projectId === p.id).reduce((s, e) => s + overlapMs(e, from, now + 1, now), 0) }))
    .sort((a, b) => b.ms - a.ms)[0]

  const wins = tasks.filter((t) => t.status === 'done')
  const carry = tasks.filter((t) => t.status !== 'done' && ['overdue', 'today'].includes(dueBucket(t.due, now)))
  const change = prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0

  return (
    <>
      <PageHeader title="Weekly review" description="Look back at the last 7 days and plan the next ones." />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total tracked</CardDescription>
            <CardTitle className="text-3xl">{formatHours(total)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            {change >= 0 ? '+' : ''}
            {change}% vs the week before
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Best day</CardDescription>
            <CardTitle className="text-3xl">{new Date(best.start).toLocaleDateString(undefined, { weekday: 'long' })}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">{formatHours(best.ms)} tracked</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Most time on</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ProjectDot project={top?.p} /> {top?.p.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">{formatHours(top?.ms ?? 0)} this week</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily hours</CardTitle>
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
            <CardDescription>{wins.length} tasks completed</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {wins.map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Carry over</CardTitle>
            <CardDescription>Overdue or due today</CardDescription>
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

      <Card>
        <CardHeader>
          <CardTitle>Reflect</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="well">What went well?</Label>
            <Textarea id="well" value={wentWell} onChange={(e) => { setWentWell(e.target.value); setSaved(false) }} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="improve">What will you change next week?</Label>
            <Textarea id="improve" value={improve} onChange={(e) => { setImprove(e.target.value); setSaved(false) }} />
          </div>
          <Button onClick={() => setSaved(true)}>{saved ? 'Saved' : 'Save review'}</Button>
        </CardContent>
      </Card>
    </>
  )
}
