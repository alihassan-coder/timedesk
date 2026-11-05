import { useState } from 'react'
import { Row } from '@/components/setting-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { isDesktop } from '@/lib/desktop'
import { notify, patchNotifyPrefs, useNotifyPrefs } from '@/lib/notify'

export function NotificationsTab() {
  const prefs = useNotifyPrefs()
  const desktop = isDesktop()
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const [tested, setTested] = useState(false)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>What to notify me about</CardTitle>
          <CardDescription>These choices are saved to your account and follow you to other devices.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row title="Due date reminders" description="A reminder for each task due today, and one summary of overdue tasks each day.">
            <Switch checked={prefs.dueReminders} onCheckedChange={(v) => patchNotifyPrefs({ dueReminders: v })} aria-label="Due date reminders" />
          </Row>
          <Row title="Timer left running" description="When a timer has been running for more than 4 hours.">
            <Switch checked={prefs.longTimer} onCheckedChange={(v) => patchNotifyPrefs({ longTimer: v })} aria-label="Timer left running" />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{desktop ? 'This computer' : 'This browser'}</CardTitle>
          <CardDescription>
            {desktop ? 'The desktop app shows native system notifications. Nothing to set up.' : 'Browsers need your permission before showing notifications.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {desktop ? (
            <Badge variant="secondary">Native notifications on</Badge>
          ) : perm === 'unsupported' ? (
            <span className="text-muted-foreground text-sm">This browser does not support notifications.</span>
          ) : perm === 'denied' ? (
            <span className="text-muted-foreground text-sm">Blocked. Allow notifications for this site in the browser settings.</span>
          ) : perm === 'default' ? (
            <Button onClick={async () => setPerm(await Notification.requestPermission())}>Enable browser notifications</Button>
          ) : (
            <Badge variant="secondary">Enabled</Badge>
          )}
          {(desktop || perm === 'granted') && (
            <Button variant="outline" onClick={async () => setTested(await notify('timedesk', 'Notifications are working.'))}>
              Send a test
            </Button>
          )}
          {tested && <span className="text-muted-foreground text-sm">Sent.</span>}
        </CardContent>
      </Card>
    </div>
  )
}
