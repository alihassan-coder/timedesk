import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { RefreshCw } from 'lucide-react'
import type { AppInfo, DesktopSettings } from '@timedesk/shared'
import { Row } from '@/components/setting-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { getDesktop, useUpdateStatus } from '@/lib/desktop'
import { FloatingTimerCard } from '@/pages/widget-settings-card'

/** Settings that only exist in the desktop app. Saved on this computer, not in your account. */
export function DesktopTab() {
  const desktop = getDesktop()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<DesktopSettings | null>(null)
  const update = useUpdateStatus()
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void desktop?.info().then(setInfo)
    void desktop?.getSettings().then(setSettings)
  }, [desktop])

  if (!desktop || !settings) return <p className="text-muted-foreground text-sm">These settings are available in the desktop app.</p>

  const change = async (patch: Partial<DesktopSettings>) => setSettings(await desktop.setSettings(patch))

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Startup and window</CardTitle>
          <CardDescription>Saved on this computer.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row title="Start with my computer" description="Opens hidden in the system tray when you sign in to your computer.">
            <Switch checked={settings.autoStart} onCheckedChange={(v) => change({ autoStart: v })} aria-label="Start with my computer" />
          </Row>
          <Row title="Keep running in the tray when I close the window" description="Reminders and the timer keep working. Quit from the tray menu.">
            <Switch checked={settings.closeToTray} onCheckedChange={(v) => change({ closeToTray: v })} aria-label="Keep running in the tray" />
          </Row>
        </CardContent>
      </Card>

      <FloatingTimerCard settings={settings} change={(patch) => void change(patch)} />

      <Card>
        <CardHeader>
          <CardTitle>App tracking</CardTitle>
          <CardDescription>
            Notes which program is in front every few seconds, only while you are signed in and active. It is off until you turn it on, and only you can see it.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row title="Track which apps I use" description="Shown on the Apps and sites page. On Linux this works on X11; Wayland may block it.">
            <Switch checked={settings.trackApps} onCheckedChange={(v) => change({ trackApps: v })} aria-label="Track which apps I use" />
          </Row>
          <Row title="Also record window titles" description="For example the file or page name. Turn off to record app names only.">
            <Switch checked={settings.trackTitles} onCheckedChange={(v) => change({ trackTitles: v })} disabled={!settings.trackApps} aria-label="Record window titles" />
          </Row>
        </CardContent>
        <CardContent>
          <Button variant="link" className="h-auto p-0" render={<Link to="/apps" />}>
            See what was recorded
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Updates</CardTitle>
          <CardDescription>New versions download in the background and ask before restarting.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary">
            Version {info?.version} · {info?.platform === 'win32' ? 'Windows' : info?.platform === 'linux' ? 'Linux' : info?.platform}
          </Badge>
          <Button
            variant="outline"
            disabled={checking || update.state === 'downloading'}
            onClick={async () => {
              setChecking(true)
              await desktop.checkForUpdates()
              setChecking(false)
            }}
          >
            <RefreshCw className={checking ? 'animate-spin' : ''} /> Check for updates
          </Button>
          <span className="text-muted-foreground text-sm">
            {update.state === 'ready' ? `Version ${update.version} is ready.` : update.state === 'downloading' ? `Downloading ${update.version}...` : update.state === 'error' ? 'Could not check right now.' : info?.packaged ? 'You are up to date.' : 'Updates are only checked in the installed app.'}
          </span>
        </CardContent>
      </Card>
    </div>
  )
}
