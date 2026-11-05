import { useState } from 'react'
import { formatDuration, totalsByTask, type ReportPeriod } from '@timedesk/shared'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'

const PERIODS: { id: ReportPeriod; label: string }[] = [
  { id: 'day', label: 'Today' },
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'year', label: 'This year' },
]

export function ReportsView() {
  const { tasks, entries } = useStore()
  const hasRunning = entries.some((e) => e.endedAt === null)
  const now = useNow(hasRunning)
  const [period, setPeriod] = useState<ReportPeriod>('day')

  const rows = [...totalsByTask(entries, period, now).entries()].sort((a, b) => b[1] - a[1])
  const grand = rows.reduce((sum, [, ms]) => sum + ms, 0)
  const nameOf = (id: string) =>
    id === '' ? 'Stopwatch (no task)' : (tasks.find((t) => t.id === id)?.title ?? 'Deleted task')

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <Button key={p.id} size="sm" variant={period === p.id ? 'default' : 'outline'} onClick={() => setPeriod(p.id)}>
            {p.label}
          </Button>
        ))}
      </div>
      <Card className="px-6 py-4">
        <p className="text-muted-foreground text-sm">Total tracked</p>
        <p className="font-mono text-4xl tabular-nums">{formatDuration(grand)}</p>
      </Card>
      <ul className="divide-y rounded-lg border">
        {rows.length === 0 && (
          <li className="text-muted-foreground px-4 py-3 text-sm">Nothing tracked in this period.</li>
        )}
        {rows.map(([id, ms]) => (
          <li key={id} className="flex justify-between px-4 py-3">
            <span>{nameOf(id)}</span>
            <span className="font-mono tabular-nums">{formatDuration(ms)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
