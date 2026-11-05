import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Row } from '@/components/setting-row'
import { useProfile } from '@/lib/auth-client'
import { AiTab } from '@/pages/settings-ai'
import { Check, Monitor, Moon, RotateCcw, Sun } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Segmented } from '@/components/segmented'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  resetAppearance,
  setAppearance,
  useAppearance,
  type Accent,
  type FontChoice,
  type Mode,
  type SidebarCollapse,
  type SidebarVariant,
  type TextSize,
} from '@/lib/appearance'
import { cn } from '@/lib/utils'

const ACCENTS: { id: Accent; label: string; color: string }[] = [
  { id: 'blue', label: 'Blue', color: 'oklch(0.546 0.245 262)' },
  { id: 'violet', label: 'Violet', color: 'oklch(0.54 0.25 293)' },
  { id: 'green', label: 'Green', color: 'oklch(0.52 0.16 150)' },
  { id: 'orange', label: 'Orange', color: 'oklch(0.62 0.19 45)' },
  { id: 'rose', label: 'Rose', color: 'oklch(0.58 0.23 17)' },
  { id: 'zinc', label: 'Neutral', color: 'oklch(0.3 0 0)' },
]

export default function SettingsPage() {
  const [params, setParams] = useSearchParams()
  return (
    <>
      <PageHeader title="Settings" description="Make timedesk look and behave the way you work." />
      <Tabs value={params.get('tab') ?? 'appearance'} onValueChange={(v) => setParams({ tab: String(v) })}>
        <TabsList>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="ai">AI assistant</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        <TabsContent value="appearance" className="pt-4">
          <AppearanceTab />
        </TabsContent>
        <TabsContent value="ai" className="pt-4">
          <AiTab />
        </TabsContent>
        <TabsContent value="notifications" className="pt-4">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="integrations" className="pt-4">
          <IntegrationsTab />
        </TabsContent>
        <TabsContent value="account" className="pt-4">
          <AccountTab />
        </TabsContent>
      </Tabs>
    </>
  )
}

function AppearanceTab() {
  const a = useAppearance()
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Changes apply instantly and are saved on this device.</CardDescription>
          <CardAction>
            <Button size="sm" variant="outline" onClick={resetAppearance}>
              <RotateCcw /> Reset
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="divide-y">
          <Row title="Mode" description="Light, dark, or follow your system.">
            <Segmented<Mode>
              value={a.mode}
              onChange={(mode) => setAppearance({ mode })}
              options={[
                { value: 'light', label: <><Sun /> Light</> },
                { value: 'dark', label: <><Moon /> Dark</> },
                { value: 'system', label: <><Monitor /> System</> },
              ]}
            />
          </Row>

          <Row title="Accent colour" description="Used for buttons, links, focus rings and charts.">
            <div className="flex gap-2">
              {ACCENTS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setAppearance({ accent: c.id })}
                  aria-label={c.label}
                  aria-pressed={a.accent === c.id}
                  title={c.label}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full outline-offset-2 transition focus-visible:outline-2',
                    a.accent === c.id && 'ring-foreground ring-2 ring-offset-2 ring-offset-background',
                  )}
                  style={{ backgroundColor: c.color }}
                >
                  {a.accent === c.id && <Check className="size-4 text-white" />}
                </button>
              ))}
            </div>
          </Row>

          <Row title="Corner radius" description="From sharp edges to pill shapes.">
            <Segmented
              value={String(a.radius)}
              onChange={(v) => setAppearance({ radius: Number(v) })}
              options={[
                { value: '0', label: 'Sharp' },
                { value: '0.375', label: 'Small' },
                { value: '0.625', label: 'Default' },
                { value: '1', label: 'Round' },
                { value: '1.5', label: 'Pill' },
              ]}
            />
          </Row>

          <Row title="Font">
            <Segmented<FontChoice>
              value={a.font}
              onChange={(font) => setAppearance({ font })}
              options={[
                { value: 'geist', label: 'Geist' },
                { value: 'inter', label: 'Inter' },
                { value: 'system', label: 'System' },
                { value: 'mono', label: 'Mono' },
              ]}
            />
          </Row>

          <Row title="Text and spacing size" description="Scales the whole interface.">
            <Segmented<TextSize>
              value={a.size}
              onChange={(size) => setAppearance({ size })}
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'default', label: 'Default' },
                { value: 'large', label: 'Large' },
              ]}
            />
          </Row>

          <Row title="Sidebar style">
            <Segmented<SidebarVariant>
              value={a.sidebarVariant}
              onChange={(sidebarVariant) => setAppearance({ sidebarVariant })}
              options={[
                { value: 'sidebar', label: 'Standard' },
                { value: 'floating', label: 'Floating' },
                { value: 'inset', label: 'Inset' },
              ]}
            />
          </Row>

          <Row title="Sidebar when collapsed" description="Keep icons visible, or hide it completely.">
            <Segmented<SidebarCollapse>
              value={a.sidebarCollapse}
              onChange={(sidebarCollapse) => setAppearance({ sidebarCollapse })}
              options={[
                { value: 'icon', label: 'Icons' },
                { value: 'offcanvas', label: 'Hidden' },
              ]}
            />
          </Row>
        </CardContent>
      </Card>

      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>Real components, using your settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Badge</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="destructive">High</Badge>
          </div>
          <Input placeholder="Search tasks" />
          <div className="flex items-center gap-2 text-sm">
            <Checkbox defaultChecked /> Write homepage copy
          </div>
          <Progress value={64} />
        </CardContent>
      </Card>
    </div>
  )
}

function NotificationsTab() {
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const [on, setOn] = useState<Record<string, boolean>>({
    due: true,
    summary: true,
    longTimer: true,
    review: false,
    update: true,
  })
  const rows = [
    { id: 'due', title: 'Due date reminders', description: 'When a task is due today or becomes overdue.' },
    { id: 'summary', title: 'Daily summary', description: 'Every morning: what is due and how yesterday went.' },
    { id: 'longTimer', title: 'Timer left running', description: 'When a timer has run for more than 4 hours.' },
    { id: 'review', title: 'Weekly review', description: 'A Friday reminder to review your week.' },
    { id: 'update', title: 'New version available', description: 'Desktop app only. Shown with a restart button.' },
  ]
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>What to notify me about</CardTitle>
          <CardDescription>Delivered on the desktop app, in this browser, and on mobile later.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {rows.map((r) => (
            <Row key={r.id} title={r.title} description={r.description}>
              <Switch checked={on[r.id]} onCheckedChange={(v) => setOn({ ...on, [r.id]: v })} aria-label={r.title} />
            </Row>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>This browser</CardTitle>
          <CardDescription>Browsers need your permission before showing notifications.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          {perm === 'unsupported' ? (
            <span className="text-muted-foreground text-sm">This browser does not support notifications.</span>
          ) : perm === 'granted' ? (
            <Badge variant="secondary">Enabled</Badge>
          ) : perm === 'denied' ? (
            <span className="text-muted-foreground text-sm">Blocked. Allow notifications for this site in the browser settings.</span>
          ) : (
            <Button onClick={async () => setPerm(await Notification.requestPermission())}>Enable browser notifications</Button>
          )}
          {perm === 'granted' && (
            <Button variant="outline" onClick={() => new Notification('timedesk', { body: 'Notifications are working.' })}>
              Send a test
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function IntegrationsTab() {
  const items = [
    { name: 'Google Calendar', text: 'Show events and count meeting time.', state: 'Available in phase 5' },
    { name: 'Outlook Calendar', text: 'The same, for Microsoft accounts.', state: 'Later' },
    { name: 'Chrome extension', text: 'Track websites and get reminders in the browser.', state: 'Available in phase 5' },
  ]
  return (
    <Card>
      <CardContent className="divide-y">
        {items.map((i) => (
          <Row key={i.name} title={i.name} description={i.text}>
            <Badge variant="outline">{i.state}</Badge>
          </Row>
        ))}
      </CardContent>
    </Card>
  )
}

function AccountTab() {
  const { user } = useProfile()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>You sign in with your username or email. An admin approves each new account.</CardDescription>
      </CardHeader>
      <CardContent className="max-w-md space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input id="username" defaultValue={user?.username ?? ''} disabled />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" defaultValue={user?.email ?? ''} disabled />
        </div>
      </CardContent>
    </Card>
  )
}
