import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatHours, overlapMs, splitParallel, type Project, type TimeEntry } from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { ProjectDot } from '@/components/project-dot'
import { cn } from '@/lib/utils'

const cell = (ms: number) => (ms === 0 ? '' : formatHours(ms))

export default function TimesheetPage() {
  const { projects, entries } = useStore()
  const now = useNow(false)
  const [offset, setOffset] = useState(0) // weeks back from this week

  const t = new Date(now)
  const mondayShift = (t.getDay() + 6) % 7
  const weekStart = new Date(t.getFullYear(), t.getMonth(), t.getDate() - mondayShift - offset * 7).getTime()
  const days = useMemo(() => {
    const s = new Date(weekStart)
    return Array.from({ length: 7 }, (_, i) => ({
      start: new Date(s.getFullYear(), s.getMonth(), s.getDate() + i).getTime(),
      end: new Date(s.getFullYear(), s.getMonth(), s.getDate() + i + 1).getTime(),
    }))
  }, [weekStart])

  // Overlapping timers share their time, so two running at once do not count double.
  const pieces = useMemo(() => splitParallel(entries), [entries])

  const { rows, dayTotals, grand } = useMemo(() => {
    const weekEnd = days[6].end
    const known = new Set(projects.map((p) => p.id))
    // One pass: only this week's time, grouped by project ("No project" for none or a deleted one).
    const byKey = new Map<string | null, TimeEntry[]>()
    for (const e of pieces) {
      if (e.startedAt >= weekEnd || (e.endedAt ?? now) <= days[0].start) continue
      const key = e.projectId && known.has(e.projectId) ? e.projectId : null
      const list = byKey.get(key)
      if (list) list.push(e)
      else byKey.set(key, [e])
    }
    const perDayOf = (list: TimeEntry[]) => days.map((d) => list.reduce((s, e) => s + overlapMs(e, d.start, d.end, now), 0))
    const rows: { key: string; project: Project | null; perDay: number[]; total: number }[] = projects.map((p) => {
      const perDay = perDayOf(byKey.get(p.id) ?? [])
      return { key: p.id, project: p, perDay, total: perDay.reduce((s, v) => s + v, 0) }
    })
    const none = byKey.get(null)
    if (none) {
      const perDay = perDayOf(none)
      const total = perDay.reduce((s, v) => s + v, 0)
      if (total > 0) rows.push({ key: 'none', project: null, perDay, total })
    }
    const dayTotals = days.map((_, i) => rows.reduce((s, r) => s + r.perDay[i], 0))
    return { rows, dayTotals, grand: dayTotals.reduce((s, v) => s + v, 0) }
  }, [pieces, projects, days, now])

  const label = `${new Date(days[0].start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} to ${new Date(days[6].start).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`

  return (
    <>
      <PageHeader
        title="Timesheet"
        description="Hours per project per day."
        actions={
          <>
            <Button size="icon" variant="outline" aria-label="Previous week" onClick={() => setOffset(offset + 1)}>
              <ChevronLeft />
            </Button>
            <span className="min-w-52 text-center text-sm font-medium">{offset === 0 ? 'This week: ' : ''}{label}</span>
            <Button size="icon" variant="outline" aria-label="Next week" disabled={offset === 0} onClick={() => setOffset(offset - 1)}>
              <ChevronRight />
            </Button>
          </>
        }
      />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">Project</TableHead>
              {days.map((d) => {
                const date = new Date(d.start)
                const isToday = offset === 0 && date.getDate() === t.getDate()
                return (
                  <TableHead key={d.start} className={cn('text-right', isToday && 'text-primary')}>
                    {date.toLocaleDateString(undefined, { weekday: 'short' })} {date.getDate()}
                  </TableHead>
                )
              })}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>
                  <span className={cn('flex items-center gap-2', !r.project && 'text-muted-foreground')}>
                    <ProjectDot project={r.project} /> {r.project?.name ?? 'No project'}
                  </span>
                </TableCell>
                {r.perDay.map((ms, i) => (
                  <TableCell key={i} className="text-right">
                    {cell(ms)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium">{cell(r.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              {dayTotals.map((ms, i) => (
                <TableCell key={i} className="text-right">
                  {cell(ms)}
                </TableCell>
              ))}
              <TableCell className="text-right">{formatHours(grand)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </>
  )
}
