import { useState } from 'react'
import { CalendarDays, Check } from 'lucide-react'
import { formatHours } from '@timedesk/shared'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { calendarEvents } from '@/data/seed'
import { clock } from '@/lib/format'

const KIND_VARIANT = { meeting: 'default', focus: 'secondary', personal: 'outline' } as const

export default function CalendarPage() {
  const [connected, setConnected] = useState(true)
  const events = calendarEvents(Date.now())

  const groups = new Map<string, typeof events>()
  for (const e of events) {
    const key = new Date(e.start).toDateString()
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const todayKey = new Date().toDateString()
  const meetingMs = (groups.get(todayKey) ?? []).filter((e) => e.kind === 'meeting').reduce((s, e) => s + (e.end - e.start), 0)

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Meetings and focus blocks from your calendar, next to your tasks."
        actions={
          connected ? (
            <Button variant="outline" onClick={() => setConnected(false)}>
              <Check /> Google Calendar connected
            </Button>
          ) : (
            <Button onClick={() => setConnected(true)}>
              <CalendarDays /> Connect Google Calendar
            </Button>
          )
        }
      />

      {!connected ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect your calendar</CardTitle>
            <CardDescription>
              Sign in with Google to see events here and count meeting time in your reports. timedesk only reads events.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setConnected(true)}>Connect Google Calendar</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {[...groups.entries()].map(([key, items]) => (
              <section key={key} className="space-y-2">
                <h2 className="text-sm font-medium">
                  {key === todayKey ? 'Today' : new Date(items[0].start).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                </h2>
                <ul className="divide-y rounded-lg border">
                  {items.map((e) => (
                    <li key={e.id} className="flex items-center gap-4 px-4 py-3">
                      <span className="text-muted-foreground w-28 text-sm">
                        {clock(e.start)} to {clock(e.end)}
                      </span>
                      <span className="flex-1">{e.title}</span>
                      <Badge variant={KIND_VARIANT[e.kind]}>{e.kind}</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <Card className="h-fit">
            <CardHeader>
              <CardDescription>Meetings today</CardDescription>
              <CardTitle className="text-3xl">{formatHours(meetingMs)}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              Meeting time can be added to your timesheet automatically once the calendar is linked to a project.
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
