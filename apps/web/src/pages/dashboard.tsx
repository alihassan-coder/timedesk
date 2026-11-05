import { Link } from 'react-router'
import { Play } from 'lucide-react'
import { dailyTotals, formatHours } from '@timedesk/shared'
import { Button } from '@/components/ui/button'
import { actions, useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { DayTimeline } from '@/features/day-timeline'
import { NowBand } from '@/features/now-band'
import { WeekChart } from '@/features/week-chart'

function greeting(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  const { tasks, entries } = useStore()
  const running = entries.some((e) => e.endedAt === null)
  const now = useNow(running)

  const week = dailyTotals(entries, now, 7)
  const today = week[week.length - 1].ms
  const weekMs = week.reduce((s, d) => s + d.ms, 0)
  const open = tasks.filter((t) => !t.done)
  const done = tasks.length - open.length

  const stats = [
    { label: 'Tracked today', value: formatHours(today) },
    { label: 'Last 7 days', value: formatHours(weekMs) },
    { label: 'Open tasks', value: String(open.length) },
    { label: 'Completed', value: String(done) },
  ]

  return (
    <>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{greeting(new Date(now).getHours())}</h1>
        <p className="text-muted-foreground">
          {new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      <NowBand />

      <dl className="divide-border grid grid-cols-2 gap-y-6 md:grid-cols-4 md:divide-x">
        {stats.map((s) => (
          <div key={s.label} className="md:px-6 md:first:pl-0">
            <dt className="text-muted-foreground text-sm">{s.label}</dt>
            <dd className="text-3xl font-semibold tracking-tight">{s.value}</dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Today</h2>
        <DayTimeline />
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Last 7 days</h2>
          <WeekChart />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Up next</h2>
          {open.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No open tasks. <Link to="/tasks" className="text-foreground underline underline-offset-4">Add one in Tasks</Link>.
            </p>
          ) : (
            <ul className="divide-y">
              {open.slice(0, 5).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate">{t.title}</span>
                  <Button size="icon-sm" variant="ghost" aria-label={`Start timer for ${t.title}`} onClick={() => actions.startTimer(t.id)}>
                    <Play />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
