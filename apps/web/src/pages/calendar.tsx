import { CalendarDays } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function CalendarPage() {
  return (
    <>
      <PageHeader title="Calendar" description="Meetings and focus blocks from your calendar, next to your tasks." />
      <Card>
        <CardHeader>
          <CardTitle>Connect your calendar</CardTitle>
          <CardDescription>
            Sign in with Google to see events here and count meeting time in your reports. timedesk only reads events.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button disabled>
            <CalendarDays /> Connect Google Calendar
          </Button>
          <span className="text-muted-foreground text-sm">Coming in a later step.</span>
        </CardContent>
      </Card>
    </>
  )
}
