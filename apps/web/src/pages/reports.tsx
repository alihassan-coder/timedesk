import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { addDays, daysInRange, formatHours, overlapMs, periodStart, rangeBuckets, toDateKey, type ReportPeriod, type TimeEntry } from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { Segmented } from '@/components/segmented'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { projectColor } from '@/lib/project-colors'
import { ProjectDot } from '@/components/project-dot'

interface Bucket {
  label: string
  start: number
  end: number
}

/** Day -> hours of today. Month -> days. Quarter -> weeks. Year -> months. */
function buckets(period: ReportPeriod, now: number): Bucket[] {
  const t = new Date(now)
  const y = t.getFullYear()
  const m = t.getMonth()
  const d = t.getDate()
  switch (period) {
    case 'day':
      return Array.from({ length: 24 }, (_, h) => ({
        label: String(h).padStart(2, '0'),
        start: new Date(y, m, d, h).getTime(),
        end: new Date(y, m, d, h + 1).getTime(),
      }))
    case 'month': {
      const days = new Date(y, m + 1, 0).getDate()
      return Array.from({ length: days }, (_, i) => ({
        label: String(i + 1),
        start: new Date(y, m, i + 1).getTime(),
        end: new Date(y, m, i + 2).getTime(),
      }))
    }
    case 'quarter': {
      const q0 = periodStart('quarter', now)
      const qd = new Date(q0)
      return Array.from({ length: 13 }, (_, i) => ({
        label: `W${i + 1}`,
        start: new Date(qd.getFullYear(), qd.getMonth(), qd.getDate() + i * 7).getTime(),
        end: new Date(qd.getFullYear(), qd.getMonth(), qd.getDate() + i * 7 + 7).getTime(),
      }))
    }
    case 'year':
      return Array.from({ length: 12 }, (_, i) => ({
        label: new Date(y, i, 1).toLocaleDateString(undefined, { month: 'short' }),
        start: new Date(y, i, 1).getTime(),
        end: new Date(y, i + 1, 1).getTime(),
      }))
  }
}

const sum = (entries: TimeEntry[], b: { start: number; end: number }, now: number) =>
  entries.reduce((s, e) => s + overlapMs(e, b.start, b.end, now), 0)

type Mode = ReportPeriod | 'custom'
const MAX_DAYS = 1830 // about five years
const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
]

const shortDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ReportsPage() {
  const { projects, entries } = useStore()
  const now = useNow(false)
  const today = toDateKey(now)
  const [period, setPeriod] = useState<Mode>('month')
  const [from, setFrom] = useState(() => addDays(toDateKey(Date.now()), -13))
  const [to, setTo] = useState(() => toDateKey(Date.now()))

  const custom = period === 'custom'
  const rangeDays = custom && from && to ? daysInRange(from, to) : 0
  const rangeError = !custom
    ? ''
    : !from || !to
      ? 'Pick a start and an end date.'
      : rangeDays <= 0
        ? 'The end date must not be before the start date.'
        : rangeDays > MAX_DAYS
          ? 'Pick a range of five years or less.'
          : ''
  const customSet = custom && !rangeError ? rangeBuckets(from, to) : null

  const bs = custom ? (customSet?.buckets ?? []) : buckets(period, now)
  const data = bs.map((b) => {
    const row: Record<string, number | string> = { label: b.label }
    for (const p of projects) {
      row[p.id] = Math.round((sum(entries.filter((e) => e.projectId === p.id), b, now) / 3_600_000) * 10) / 10
    }
    return row
  })
  const config = Object.fromEntries(projects.map((p) => [p.id, { label: p.name, color: projectColor(p) }])) satisfies ChartConfig

  const range = bs.length ? { start: bs[0].start, end: bs[bs.length - 1].end } : { start: 0, end: 0 }
  const totals = projects
    .map((p) => ({ project: p, ms: sum(entries.filter((e) => e.projectId === p.id), range, now) }))
    .sort((a, b) => b.ms - a.ms)
  const grand = totals.reduce((s, r) => s + r.ms, 0)

  return (
    <>
      <PageHeader
        title="Reports"
        description="Where your time went."
        actions={
          <Segmented
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'day', label: 'Day' },
              { value: 'month', label: 'Month' },
              { value: 'quarter', label: 'Quarter' },
              { value: 'year', label: 'Year' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
        }
      />

      {custom && (
        <div className="bg-muted/30 flex flex-wrap items-end gap-3 rounded-xl border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="r-from">From</Label>
            <Input id="r-from" type="date" className="w-40" max={to || undefined} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-to">To</Label>
            <Input id="r-to" type="date" className="w-40" min={from || undefined} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <Button
                key={p.days}
                size="sm"
                variant="outline"
                onClick={() => {
                  setFrom(addDays(today, -(p.days - 1)))
                  setTo(today)
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          {rangeError && (
            <p role="alert" className="text-destructive w-full text-sm">
              {rangeError}
            </p>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{formatHours(grand)} tracked</CardTitle>
          <CardDescription>
            {custom ? (customSet ? `Hours by project, ${shortDate(from)} to ${shortDate(to)} (${rangeDays} day${rangeDays === 1 ? '' : 's'}, by ${customSet.unit})` : 'Choose a valid date range') : `Hours by project, this ${period}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-72 w-full">
            <BarChart data={data} margin={{ left: 0, right: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={custom ? Math.max(0, Math.ceil(bs.length / 12) - 1) : period === 'month' ? 2 : 0} />
              <YAxis tickLine={false} axisLine={false} width={28} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {projects.map((p, i) => (
                <Bar isAnimationActive={false} key={p.id} dataKey={p.id} stackId="a" fill={`var(--color-${p.id})`} radius={i === projects.length - 1 ? [3, 3, 0, 0] : 0} />
              ))}
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead className="text-right">Time</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {totals.map((r) => (
              <TableRow key={r.project.id}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <ProjectDot project={r.project} /> {r.project.name}
                  </span>
                </TableCell>
                <TableCell className="text-right">{formatHours(r.ms)}</TableCell>
                <TableCell className="text-right">{grand ? Math.round((r.ms / grand) * 100) : 0}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {projects.length === 0 && <p className="text-muted-foreground p-6 text-center text-sm">No projects yet. Time you track appears here by project.</p>}
        {projects.length > 0 && grand === 0 && !rangeError && <p className="text-muted-foreground p-4 text-center text-sm">No time was tracked in this period.</p>}
      </div>
    </>
  )
}
