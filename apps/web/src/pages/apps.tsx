import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, Search, Trash2, X } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { addDays, formatShort, toDateKey } from '@timedesk/shared'
import { DesktopBanner } from '@/components/desktop-banner'
import { PageHeader } from '@/components/page-header'
import { Segmented } from '@/components/segmented'
import { SimpleSelect } from '@/components/simple-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, ApiError } from '@/lib/api'
import { isDesktop } from '@/lib/desktop'

interface Summary {
  totalSeconds: number
  byApp: { app: string; seconds: number }[]
}
interface Session {
  id: string
  app: string
  title: string
  startedAt: string
  seconds: number
}
interface Sessions {
  items: Session[]
  total: number
  page: number
  pageSize: number
  pages: number
}
type Range = 'today' | '7' | '30' | 'custom'

const config = { minutes: { label: 'Minutes', color: 'var(--chart-3)' } } satisfies ChartConfig
const PAGE_SIZES = ['10', '25', '50']
const midnight = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** The ISO start and end the API needs for the chosen range. `to` is exclusive. */
function bounds(range: Range, from: string, to: string): { from: string; to?: string } | null {
  const today = toDateKey(Date.now())
  if (range === 'today') return { from: midnight(today).toISOString() }
  if (range === '7') return { from: midnight(addDays(today, -6)).toISOString() }
  if (range === '30') return { from: midnight(addDays(today, -29)).toISOString() }
  if (!from || !to || to < from) return null
  return { from: midnight(from).toISOString(), to: midnight(addDays(to, 1)).toISOString() }
}

const query = (b: { from: string; to?: string }, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams({ from: b.from, ...(b.to ? { to: b.to } : {}), ...extra })
  return p.toString()
}

export default function AppsPage() {
  const [range, setRange] = useState<Range>('today')
  const [from, setFrom] = useState(() => addDays(toDateKey(Date.now()), -6))
  const [to, setTo] = useState(() => toDateKey(Date.now()))
  const [app, setApp] = useState('all')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState('10')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [sessions, setSessions] = useState<Sessions | null>(null)
  const [error, setError] = useState('')

  const b = bounds(range, from, to)
  const rangeKey = b ? `${b.from}|${b.to ?? ''}` : ''
  const rangeError = range === 'custom' && !b ? 'The end date must not be before the start date.' : ''

  // Wait for the person to stop typing before searching.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const reload = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!b) {
        setSummary({ totalSeconds: 0, byApp: [] })
        setSessions({ items: [], total: 0, page: 1, pageSize: Number(pageSize), pages: 1 })
        return
      }
      try {
        const [s, list] = await Promise.all([
          api<Summary>(`/activity/summary?${query(b)}`),
          api<Sessions>(
            `/activity/sessions?${query(b, { page: String(page), pageSize, ...(app !== 'all' ? { app } : {}), ...(debounced ? { q: debounced } : {}) })}`,
          ),
        ])
        if (!isCurrent()) return
        setSummary(s)
        setSessions(list)
        setError('')
        // The last page vanished (for example after deleting): go back one.
        if (list.page > list.pages) setPage(list.pages)
      } catch (e) {
        if (!isCurrent()) return
        setError(e instanceof ApiError ? e.message : 'Could not load activity.')
        setSummary((s) => s ?? { totalSeconds: 0, byApp: [] })
        setSessions((s) => s ?? { items: [], total: 0, page: 1, pageSize: Number(pageSize), pages: 1 })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `b` is derived from rangeKey
    [rangeKey, page, pageSize, app, debounced],
  )

  useEffect(() => {
    let current = true
    void reload(() => current)
    return () => {
      current = false
    }
  }, [reload])

  const changeRange = (r: Range) => {
    setRange(r)
    setApp('all')
    setPage(1)
  }

  const noData = summary !== null && summary.byApp.length === 0
  const filtering = app !== 'all' || debounced !== ''
  const rows = (summary?.byApp ?? []).map((r) => ({ name: r.app, minutes: Math.round(r.seconds / 6) / 10 }))
  const firstShown = sessions && sessions.total > 0 ? (sessions.page - 1) * sessions.pageSize + 1 : 0
  const lastShown = sessions ? Math.min(sessions.total, sessions.page * sessions.pageSize) : 0

  return (
    <>
      <PageHeader
        title="Apps and sites"
        description="Which programs you used. Recorded by the desktop app; only you can see it."
        actions={
          <Segmented<Range>
            value={range}
            onChange={changeRange}
            options={[
              { value: 'today', label: 'Today' },
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
        }
      />

      {range === 'custom' && (
        <div className="bg-muted/30 flex flex-wrap items-end gap-3 rounded-xl border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="a-from">From</Label>
            <Input id="a-from" type="date" className="w-40" max={to || undefined} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-to">To</Label>
            <Input id="a-to" type="date" className="w-40" min={from || undefined} value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} />
          </div>
          {rangeError && (
            <p role="alert" className="text-destructive text-sm">
              {rangeError}
            </p>
          )}
        </div>
      )}

      {!isDesktop() && noData && (
        <DesktopBanner feature="App tracking">
          A browser cannot see other programs. Install the desktop app, turn on app tracking in its settings, and your apps appear here.
        </DesktopBanner>
      )}
      {isDesktop() && noData && !rangeError && (
        <div className="bg-muted/50 flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
          <span className="flex-1">Nothing recorded in this range. App tracking is off until you turn it on, and it only runs while you are signed in and active.</span>
          <Button size="sm" render={<Link to="/settings?tab=desktop" />}>
            Open desktop settings
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}

      {summary && !noData && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{formatShort(summary.totalSeconds * 1000)} tracked</CardTitle>
                <CardDescription>Minutes per app. Pick an app below to see only its sessions.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={config} className="w-full" style={{ height: Math.max(140, rows.length * 38 + 20) }}>
                  <BarChart data={rows} layout="vertical" margin={{ left: 40 }}>
                    <CartesianGrid horizontal={false} />
                    <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={120} />
                    <XAxis type="number" hide />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                    <Bar isAnimationActive={false} dataKey="minutes" fill="var(--color-minutes)" radius={4} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Your data</CardTitle>
                <CardDescription>Only you can see window titles. Admins and teammates cannot.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (!window.confirm('Erase everything the desktop app recorded about you? This cannot be undone.')) return
                    await api('/activity', { method: 'DELETE' })
                    setPage(1)
                    setApp('all')
                    await reload()
                  }}
                >
                  <Trash2 /> Erase my activity
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                className="pr-8 pl-8"
                placeholder="Search app or window"
                aria-label="Search sessions"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear search"
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                  onClick={() => {
                    setSearch('')
                    setPage(1)
                  }}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <SimpleSelect
              className="w-44"
              value={app}
              onChange={(v) => {
                setApp(v)
                setPage(1)
              }}
              options={[{ value: 'all', label: 'All apps' }, ...summary.byApp.map((r) => ({ value: r.app, label: r.app }))]}
            />
            {filtering && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setApp('all')
                  setSearch('')
                  setPage(1)
                }}
              >
                Clear filters
              </Button>
            )}
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions?.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.app}</TableCell>
                    <TableCell className="text-muted-foreground max-w-80 truncate" title={r.title}>
                      {r.title || '(not recorded)'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {new Date(r.startedAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatShort(r.seconds * 1000)}</TableCell>
                    <TableCell>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete this ${r.app} session`}
                        onClick={async () => {
                          await api(`/activity/${r.id}`, { method: 'DELETE' }).catch(() => undefined)
                          await reload()
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {sessions && sessions.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground py-10 text-center">
                      {filtering ? 'No sessions match these filters.' : 'No sessions in this range.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {sessions && sessions.total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-sm">
                <span className="text-muted-foreground" aria-live="polite">
                  {firstShown}-{lastShown} of {sessions.total}
                </span>
                <div className="flex items-center gap-3">
                  <label className="text-muted-foreground flex items-center gap-2">
                    Rows
                    <SimpleSelect
                      className="w-20"
                      value={pageSize}
                      onChange={(v) => {
                        setPageSize(v)
                        setPage(1)
                      }}
                      options={PAGE_SIZES.map((n) => ({ value: n, label: n }))}
                    />
                  </label>
                  <div className="flex items-center gap-1">
                    <Button size="icon-sm" variant="outline" aria-label="Previous page" disabled={sessions.page <= 1} onClick={() => setPage(sessions.page - 1)}>
                      <ChevronLeft />
                    </Button>
                    <span className="min-w-20 text-center tabular-nums">
                      Page {sessions.page} of {sessions.pages}
                    </span>
                    <Button size="icon-sm" variant="outline" aria-label="Next page" disabled={sessions.page >= sessions.pages} onClick={() => setPage(sessions.page + 1)}>
                      <ChevronRight />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
