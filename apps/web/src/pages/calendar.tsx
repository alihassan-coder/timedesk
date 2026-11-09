import { useState } from 'react'
import { Link } from 'react-router'
import { CalendarDays, Calendar as CalendarIcon, CalendarRange, ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw } from 'lucide-react'
import { addDays, addMonths, monthGrid, startOfWeek, toDateKey, type CalendarEvent } from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { Segmented } from '@/components/segmented'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { loadStore, useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { EventDialog } from '@/features/event-dialog'
import { MonthView, WeekView } from '@/features/task-calendar'
import { ApiError } from '@/lib/api'
import { startGoogleConnect, syncGoogle, useGoogleEvents, useGoogleStatus } from '@/lib/google'

type View = 'week' | 'month'

const fmt = (key: string, opts: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts)
}

const dateOf = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))

/** "Nov 2 - 8, 2026" (the format follows the person's language). */
const weekTitle = (anchor: string) =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).formatRange(dateOf(startOfWeek(anchor)), dateOf(addDays(startOfWeek(anchor), 6)))

export default function CalendarPage() {
  const { status, loading, error, refresh } = useGoogleStatus()
  const [retrying, setRetrying] = useState(false)

  return (
    <>
      <PageHeader title="Calendar" description="Your Google Calendar events next to your tasks. Changes go both ways." />
      {loading ? (
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : !status && error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-destructive">Could not check Google Calendar. Check your connection and try again.</span>
          <Button
            size="sm"
            variant="outline"
            disabled={retrying}
            onClick={() => {
              setRetrying(true)
              void refresh().finally(() => setRetrying(false))
            }}
          >
            {retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />} Retry
          </Button>
        </div>
      ) : !status?.configured ? (
        <NotSetUp />
      ) : !status.connected ? (
        <ConnectCard />
      ) : (
        <CalendarView />
      )}
    </>
  )
}

function NotSetUp() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Calendar is not set up</CardTitle>
        <CardDescription>
          Whoever runs timedesk needs to add a Google client id and secret first. The steps are in the deploy guide, section &quot;Google Calendar&quot;. Your tasks work as usual in the meantime.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" render={<Link to="/tasks" />}>
          Open tasks
        </Button>
      </CardContent>
    </Card>
  )
}

function ConnectCard() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect your calendar</CardTitle>
        <CardDescription>
          Sign in with Google to see your events here, add events from timedesk, and keep tasks with a due date on your calendar. timedesk asks only to manage events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await startGoogleConnect()
              } catch (e) {
                setError(e instanceof ApiError ? e.message : 'Could not reach the server.')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : <CalendarDays />} Connect Google Calendar
          </Button>
          <Button variant="ghost" render={<Link to="/settings?tab=calendar" />}>
            More options
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function CalendarView() {
  const { tasks } = useStore()
  const now = useNow(false)
  const today = toDateKey(now)
  const [view, setView] = useState<View>('month')
  const [anchor, setAnchor] = useState(today)
  const [dialog, setDialog] = useState<{ event: CalendarEvent | null; day: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [note, setNote] = useState('')

  const [from, to] =
    view === 'week'
      ? [startOfWeek(anchor), addDays(startOfWeek(anchor), 7)]
      : (() => {
          const grid = monthGrid(anchor)
          return [grid[0][0], addDays(grid[grid.length - 1][6], 1)]
        })()
  const { events, error, reload } = useGoogleEvents(from, to, true)

  const shift = (dir: 1 | -1) => setAnchor(view === 'week' ? addDays(anchor, 7 * dir) : addMonths(anchor, dir))
  const title = view === 'month' ? fmt(anchor, { month: 'long', year: 'numeric' }) : weekTitle(anchor)

  async function sync() {
    setSyncing(true)
    setNote('')
    try {
      const r = await syncGoogle()
      if (r.updatedTasks) await loadStore()
      reload()
      setNote(r.updatedTasks || r.pushed || r.unlinked ? `Synced: ${r.updatedTasks} updated, ${r.pushed} added.` : 'Already in step.')
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Could not reach the server.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'week', label: <><CalendarRange /> <span className="hidden sm:inline">Week</span></>, ariaLabel: 'Week view' },
            { value: 'month', label: <><CalendarIcon /> <span className="hidden sm:inline">Month</span></>, ariaLabel: 'Month view' },
          ]}
        />
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label="Previous" onClick={() => shift(-1)}>
            <ChevronLeft />
          </Button>
          <Button size="icon" variant="outline" aria-label="Next" onClick={() => shift(1)}>
            <ChevronRight />
          </Button>
        </div>
        <h2 className="text-lg font-semibold tracking-tight" aria-live="polite">
          {title}
        </h2>
        <Button size="sm" variant="ghost" onClick={() => setAnchor(today)}>
          Today
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={syncing} onClick={sync}>
            {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync
          </Button>
          <Button size="sm" onClick={() => setDialog({ event: null, day: today })}>
            <Plus /> New event
          </Button>
        </div>
      </div>

      {(error || note) && (
        <p role={error ? 'alert' : 'status'} className={error ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}>
          {error || note}
        </p>
      )}

      {view === 'week' ? (
        <WeekView
          tasks={tasks}
          anchor={anchor}
          now={now}
          events={events}
          onOpenEvent={(e) => setDialog({ event: e, day: today })}
          onOpenDay={(day) => setAnchor(day)}
          onAdd={(day) => setDialog({ event: null, day })}
        />
      ) : (
        <MonthView
          tasks={tasks}
          anchor={anchor}
          now={now}
          events={events}
          onOpenEvent={(e) => setDialog({ event: e, day: today })}
          onOpenDay={(day) => {
            setAnchor(day)
            setView('week')
          }}
          onAdd={(day) => setDialog({ event: null, day })}
        />
      )}

      <EventDialog open={dialog !== null} event={dialog?.event ?? null} defaultDay={dialog?.day ?? today} onClose={() => setDialog(null)} onChanged={reload} />
    </>
  )
}
