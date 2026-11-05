import { entryDuration, formatDuration, periodStart } from '@timedesk/shared'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { NowBand } from '@/features/now-band'

const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

export default function TimerPage() {
  const { tasks, entries } = useStore()
  const running = entries.some((e) => e.endedAt === null)
  const now = useNow(running)
  const from = periodStart('day', now)
  const log = entries.filter((e) => (e.endedAt ?? now) >= from).sort((a, b) => b.startedAt - a.startedAt)

  return (
    <>
      <NowBand />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Today&apos;s log</h2>
        {log.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing tracked yet today. Start the stopwatch or a task timer above.</p>
        ) : (
          <ul className="divide-y">
            {log.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate">{e.taskId ? (tasks.find((t) => t.id === e.taskId)?.title ?? 'Deleted task') : 'Stopwatch'}</p>
                  <p className="text-muted-foreground text-sm">
                    {clock(e.startedAt)} to {e.endedAt ? clock(e.endedAt) : 'now'}
                  </p>
                </div>
                <span className="font-medium">{formatDuration(entryDuration(e, now))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
