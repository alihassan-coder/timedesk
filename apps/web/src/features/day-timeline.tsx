import { formatHours, overlapMs } from '@timedesk/shared'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { cn } from '@/lib/utils'

const FIRST_HOUR = 6
const LAST_HOUR = 24
const TICKS = [6, 9, 12, 15, 18, 21, 24]

/** Today, 06:00 to 24:00, with every tracked block drawn where it happened. */
export function DayTimeline() {
  const { entries } = useStore()
  const running = entries.some((e) => e.endedAt === null)
  const now = useNow(running)

  const d = new Date(now)
  const at = (hour: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour).getTime()
  const from = at(FIRST_HOUR)
  const to = at(LAST_HOUR)
  const pct = (t: number) => ((Math.min(Math.max(t, from), to) - from) / (to - from)) * 100

  const blocks = entries
    .filter((e) => overlapMs(e, from, to, now) > 0)
    .map((e) => {
      const left = pct(e.startedAt)
      const right = pct(e.endedAt ?? now)
      return { id: e.id, left, width: Math.max(right - left, 0.4), live: e.endedAt === null, ms: overlapMs(e, from, to, now) }
    })
  const total = blocks.reduce((s, b) => s + b.ms, 0)
  const nowPct = now >= from && now <= to ? pct(now) : null

  return (
    <div>
      <div
        role="img"
        aria-label={`Today's timeline: ${formatHours(total)} tracked in ${blocks.length} blocks`}
        className="bg-muted relative h-14 overflow-hidden rounded-lg"
      >
        {TICKS.slice(1, -1).map((h) => (
          <div key={h} className="bg-border absolute inset-y-0 w-px" style={{ left: `${((h - FIRST_HOUR) / (LAST_HOUR - FIRST_HOUR)) * 100}%` }} />
        ))}
        {blocks.map((b) => (
          <div
            key={b.id}
            title={formatHours(b.ms)}
            className={cn('absolute inset-y-2 rounded-sm', b.live ? 'bg-live' : 'bg-primary')}
            style={{ left: `${b.left}%`, width: `${b.width}%` }}
          />
        ))}
        {nowPct !== null && <div className="bg-foreground/60 absolute inset-y-0 w-0.5" style={{ left: `${nowPct}%` }} />}
      </div>
      <div className="text-muted-foreground relative mt-1 h-4 text-xs">
        {TICKS.map((h) => (
          <span
            key={h}
            className={cn('absolute -translate-x-1/2', h === FIRST_HOUR && 'translate-x-0', h === LAST_HOUR && '-translate-x-full')}
            style={{ left: `${((h - FIRST_HOUR) / (LAST_HOUR - FIRST_HOUR)) * 100}%` }}
          >
            {String(h % 24).padStart(2, '0')}:00
          </span>
        ))}
      </div>
    </div>
  )
}
