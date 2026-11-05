import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Trash2 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { formatShort, periodStart } from '@timedesk/shared'
import { DesktopBanner } from '@/components/desktop-banner'
import { PageHeader } from '@/components/page-header'
import { Segmented } from '@/components/segmented'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, ApiError } from '@/lib/api'
import { isDesktop } from '@/lib/desktop'

interface Summary {
  totalSeconds: number
  byApp: { app: string; seconds: number }[]
  recent: { app: string; title: string; startedAt: string; seconds: number }[]
}
type Range = 'today' | 'week'

const config = { minutes: { label: 'Minutes', color: 'var(--chart-3)' } } satisfies ChartConfig

export default function AppsPage() {
  const [range, setRange] = useState<Range>('today')
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (r: Range) => {
    setError('')
    const now = Date.now()
    const from = new Date(periodStart('day', r === 'today' ? now : now - 6 * 86_400_000)).toISOString()
    try {
      setData(await api<Summary>(`/activity/summary?from=${encodeURIComponent(from)}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load activity.')
      setData({ totalSeconds: 0, byApp: [], recent: [] })
    }
  }, [])

  useEffect(() => {
    void load(range)
  }, [range, load])

  const empty = data !== null && data.byApp.length === 0
  const rows = (data?.byApp ?? []).map((r) => ({ name: r.app, minutes: Math.round(r.seconds / 6) / 10 }))

  return (
    <>
      <PageHeader
        title="Apps and sites"
        description="Which programs you used. Recorded by the desktop app; only you can see it."
        actions={
          <Segmented<Range>
            value={range}
            onChange={setRange}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'Last 7 days' },
            ]}
          />
        }
      />

      {!isDesktop() && empty && (
        <DesktopBanner feature="App tracking">
          A browser cannot see other programs. Install the desktop app, turn on app tracking in its settings, and your apps appear here.
        </DesktopBanner>
      )}
      {isDesktop() && empty && (
        <div className="bg-muted/50 flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
          <span className="flex-1">Nothing recorded yet. App tracking is off until you turn it on, and it only runs while you are signed in and active.</span>
          <Button size="sm" render={<Link to="/settings?tab=desktop" />}>
            Open desktop settings
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}

      {data && !empty && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{formatShort(data.totalSeconds * 1000)} tracked</CardTitle>
                <CardDescription>Minutes per app</CardDescription>
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
                    await load(range)
                  }}
                >
                  <Trash2 /> Erase my activity
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.app}</TableCell>
                    <TableCell className="text-muted-foreground max-w-80 truncate">{r.title || '(not recorded)'}</TableCell>
                    <TableCell>{new Date(r.startedAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</TableCell>
                    <TableCell className="text-right">{formatShort(r.seconds * 1000)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  )
}
