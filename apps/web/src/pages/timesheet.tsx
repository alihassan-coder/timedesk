import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatHours, overlapMs } from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { ProjectDot } from '@/lib/projects'
import { cn } from '@/lib/utils'

const cell = (ms: number) => (ms === 0 ? '' : formatHours(ms))

export default function TimesheetPage() {
  const { projects, entries } = useStore()
  const now = useNow(false)
  const [offset, setOffset] = useState(0) // weeks back from this week

  const t = new Date(now)
  const mondayShift = (t.getDay() + 6) % 7
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(t.getFullYear(), t.getMonth(), t.getDate() - mondayShift - offset * 7 + i).getTime()
    const end = new Date(t.getFullYear(), t.getMonth(), t.getDate() - mondayShift - offset * 7 + i + 1).getTime()
    return { start, end }
  })

  const rows = projects.map((p) => {
    const perDay = days.map((d) =>
      entries.filter((e) => e.projectId === p.id).reduce((s, e) => s + overlapMs(e, d.start, d.end, now), 0),
    )
    return { project: p, perDay, total: perDay.reduce((s, v) => s + v, 0) }
  })
  const dayTotals = days.map((_, i) => rows.reduce((s, r) => s + r.perDay[i], 0))
  const grand = dayTotals.reduce((s, v) => s + v, 0)

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
              <TableRow key={r.project.id}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <ProjectDot project={r.project} /> {r.project.name}
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
