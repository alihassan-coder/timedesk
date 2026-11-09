import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Row } from '@/components/setting-row'
import { useProfile } from '@/lib/auth-client'
import { isDesktop } from '@/lib/desktop'
import { AiTab } from '@/pages/settings-ai'
import { CalendarTab } from '@/pages/settings-calendar'
import { DesktopTab } from '@/pages/settings-desktop'
import { NotificationsTab } from '@/pages/settings-notifications'
import { TimerTab } from '@/pages/settings-timer'
import { Check, Download, FileSpreadsheet, Monitor, Moon, RotateCcw, Sun, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Segmented } from '@/components/segmented'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
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
import { deleteAccount, exportAllData, exportTimeCsv } from '@/lib/account'

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
          <TabsTrigger value="timer">Timer</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          {isDesktop() && <TabsTrigger value="desktop">Desktop</TabsTrigger>}
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        <TabsContent value="appearance" className="pt-4">
          <AppearanceTab />
        </TabsContent>
        <TabsContent value="ai" className="pt-4">
          <AiTab />
        </TabsContent>
        <TabsContent value="timer" className="pt-4">
          <TimerTab />
        </TabsContent>
        <TabsContent value="notifications" className="pt-4">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="calendar" className="pt-4">
          <CalendarTab />
        </TabsContent>
        {isDesktop() && (
          <TabsContent value="desktop" className="pt-4">
            <DesktopTab />
          </TabsContent>
        )}
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

function IntegrationsTab() {
  const items = [
    { name: 'Google Calendar', text: 'See your events, add events, and keep tasks in step both ways.', state: 'calendar' },
    { name: 'Outlook Calendar', text: 'The same, for Microsoft accounts.', state: 'Later' },
    { name: 'Chrome extension', text: 'Track websites and get reminders in the browser.', state: 'Available in phase 5' },
  ]
  return (
    <Card>
      <CardContent className="divide-y">
        {items.map((i) => (
          <Row key={i.name} title={i.name} description={i.text}>
            {i.state === 'calendar' ? (
              <Button size="sm" variant="outline" render={<Link to="/settings?tab=calendar" />}>
                Set up
              </Button>
            ) : (
              <Badge variant="outline">{i.state}</Badge>
            )}
          </Row>
        ))}
      </CardContent>
    </Card>
  )
}

function AccountTab() {
  const { user } = useProfile()
  return (
    <div className="grid max-w-3xl gap-6">
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
      <YourDataCard />
      <DeleteAccountCard />
    </div>
  )
}

function YourDataCard() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const exportJson = async () => {
    setBusy(true)
    setError('')
    setDone('')
    try {
      await exportAllData()
      setDone('Your data was downloaded.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export your data.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your data</CardTitle>
        <CardDescription>Download a copy of what timedesk stores for you. It is yours to keep or move elsewhere.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        <Row
          title="Everything (JSON)"
          description="Projects, tasks, tracked time, weekly reviews, settings, Tempo chats and memories, and app activity. AI keys and Google tokens are not included."
        >
          <Button size="sm" variant="outline" aria-label="Download all my data as JSON" onClick={() => void exportJson()} disabled={busy}>
            <Download /> {busy ? 'Preparing...' : 'Download'}
          </Button>
        </Row>
        <Row title="Tracked time (CSV)" description="One row per timer session with date, start, end, hours, project and task. Opens in Excel or Google Sheets.">
          <Button size="sm" variant="outline" aria-label="Download tracked time as CSV" onClick={exportTimeCsv}>
            <FileSpreadsheet /> Download
          </Button>
        </Row>
        {(error || done) && (
          <p role={error ? 'alert' : 'status'} className={cn('pt-3 text-sm', error ? 'text-destructive' : 'text-muted-foreground')}>
            {error || done}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function DeleteAccountCard() {
  const { user } = useProfile()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const name = user?.username ?? user?.email ?? ''
  const ready = password.length > 0 && confirm.trim() === name

  const reset = (o: boolean) => {
    setOpen(o)
    if (!o) {
      setPassword('')
      setConfirm('')
      setError('')
    }
  }
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await deleteAccount(password)
      navigate('/login', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the account.')
      setBusy(false)
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription>
          Removes your account and everything in it from timedesk for good: projects, tasks, tracked time, reviews, chats, memories, app activity, AI keys
          and the Google Calendar connection. Events already in your Google Calendar stay there. Download your data first if you want a copy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={reset}>
          <DialogTrigger render={<Button variant="destructive" />}>
            <Trash2 /> Delete my account
          </DialogTrigger>
          <DialogContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (ready && !busy) void submit()
              }}
            >
              <DialogHeader>
                <DialogTitle>Delete your account?</DialogTitle>
                <DialogDescription>This cannot be undone. Everything you stored in timedesk is deleted right away.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="delete-confirm">
                  Type <span className="font-mono font-semibold">{name}</span> to confirm
                </Label>
                <Input id="delete-confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delete-password">Your password</Label>
                <Input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => reset(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={!ready || busy}>
                  {busy ? 'Deleting...' : 'Delete everything'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
