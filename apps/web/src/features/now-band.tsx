import { Play, Square } from 'lucide-react'
import { entryDuration, formatDuration } from '@timedesk/shared'
import { Button } from '@/components/ui/button'
import { actions, useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { cn } from '@/lib/utils'

/** The one loud element: saffron while a timer runs, quiet paper when idle. */
export function NowBand() {
  const { tasks, entries } = useStore()
  const running = entries.find((e) => e.endedAt === null)
  const now = useNow(!!running)
  const title = running?.taskId ? tasks.find((t) => t.id === running.taskId)?.title : null
  const suggestions = tasks.filter((t) => !t.done).slice(0, 3)

  return (
    <section
      className={cn(
        'flex flex-col gap-4 rounded-xl px-6 py-5 sm:flex-row sm:items-center sm:justify-between',
        running ? 'bg-live text-live-foreground' : 'bg-secondary',
      )}
    >
      <div>
        <p className={cn('text-sm', !running && 'text-muted-foreground')}>
          {running ? (title ?? 'Stopwatch') : 'Nothing is running'}
        </p>
        <p className="text-5xl font-semibold tracking-tight">
          {formatDuration(running ? entryDuration(running, now) : 0)}
        </p>
      </div>

      {running ? (
        <Button size="lg" className="bg-live-foreground text-live hover:bg-live-foreground/90" onClick={actions.stopTimer}>
          <Square /> Stop
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="lg" onClick={() => actions.startTimer(null)}>
            <Play /> Start stopwatch
          </Button>
          {suggestions.map((t) => (
            <Button key={t.id} size="lg" variant="outline" className="max-w-48" onClick={() => actions.startTimer(t.id)}>
              <Play />
              <span className="truncate">{t.title}</span>
            </Button>
          ))}
        </div>
      )}
    </section>
  )
}
