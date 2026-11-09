import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CalendarDays, Loader2, RefreshCw } from 'lucide-react'
import type { GoogleSyncResult } from '@timedesk/shared'
import { Row } from '@/components/setting-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { loadStore } from '@/data/store'
import { ApiError } from '@/lib/api'
import { isDesktop } from '@/lib/desktop'
import { disconnectGoogle, setGooglePushTasks, startGoogleConnect, syncGoogle, useGoogleStatus } from '@/lib/google'

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Could not reach the server.')

const summary = (r: GoogleSyncResult) => {
  const parts = [
    r.updatedTasks ? `${r.updatedTasks} task${r.updatedTasks === 1 ? '' : 's'} updated from Google` : '',
    r.pushed ? `${r.pushed} task${r.pushed === 1 ? '' : 's'} added to Google` : '',
    r.unlinked ? `${r.unlinked} event${r.unlinked === 1 ? '' : 's'} removed in Google` : '',
  ].filter(Boolean)
  return parts.length ? `Synced: ${parts.join(', ')}.` : 'Everything is already in step.'
}

/** Connect Google Calendar, choose what is shared, and sync. The browser never holds a Google token. */
export function CalendarTab() {
  const { status, loading, error: statusError, refresh } = useGoogleStatus()
  const [params, setParams] = useSearchParams()
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'sync' | 'push' | ''>('')
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [waiting, setWaiting] = useState(false)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  // Google sends the browser back here with ?google=connected or ?google=error.
  const back = params.get('google')
  useEffect(() => {
    if (!back) return
    if (back === 'connected') setInfo('Google Calendar is connected.')
    else setError('Google Calendar could not be connected. Try again.')
    void refresh()
    const next = new URLSearchParams(params)
    next.delete('google')
    setParams(next, { replace: true })
  }, [back]) // eslint-disable-line react-hooks/exhaustive-deps -- run once per return from Google

  const stopPolling = () => {
    if (poll.current) clearInterval(poll.current)
    poll.current = null
    setWaiting(false)
  }
  useEffect(() => stopPolling, [])
  useEffect(() => {
    if (status?.connected && waiting) {
      stopPolling()
      setInfo('Google Calendar is connected.')
    }
  }, [status?.connected, waiting])

  async function connect() {
    setError('')
    setInfo('')
    setBusy('connect')
    try {
      await startGoogleConnect()
      if (isDesktop()) {
        // The system browser did the sign-in. Look for the result until it arrives (3 minutes at most).
        setWaiting(true)
        const until = Date.now() + 180_000
        poll.current = setInterval(() => {
          if (Date.now() > until) stopPolling()
          else void refresh()
        }, 2000)
      }
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy('')
    }
  }

  async function run<T>(kind: typeof busy, job: () => Promise<T>, done?: (r: T) => void) {
    setError('')
    setInfo('')
    setBusy(kind)
    try {
      const r = await job()
      done?.(r)
      await refresh()
    } catch (e) {
      setError(message(e))
      await refresh()
    } finally {
      setBusy('')
    }
  }

  if (loading) return <p className="text-muted-foreground text-sm">Loading...</p>
  if (!status) {
    // Only reached when the check failed and there is no earlier answer to fall back on.
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-destructive">{statusError ? 'Could not check Google Calendar.' : 'Google Calendar is not available.'}</span>
        <Button size="sm" variant="outline" onClick={() => void refresh()}>
          Retry
        </Button>
      </div>
    )
  }

  if (!status.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Google Calendar</CardTitle>
          <CardDescription>Not set up on this server yet.</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>Whoever runs timedesk needs to add a Google client id and secret first. Once that is done, a Connect button appears here.</p>
          <p>The steps are in the deploy guide, section &quot;Google Calendar&quot;.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {info && (
        <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
          {info}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-4" /> Google Calendar
            {status.connected ? <Badge>Connected</Badge> : <Badge variant="outline">Not connected</Badge>}
          </CardTitle>
          <CardDescription>
            {status.connected
              ? `Signed in as ${status.email ?? 'your Google account'}. Your events show up in timedesk and your tasks can show up in Google.`
              : 'See your events next to your tasks, add events from timedesk, and keep tasks with a due date on your Google Calendar. timedesk only asks to manage events, never your email or files.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {!status.connected ? (
            <div className="flex flex-wrap items-center gap-3 py-2">
              <Button onClick={connect} disabled={busy === 'connect' || waiting}>
                {busy === 'connect' || waiting ? <Loader2 className="animate-spin" /> : <CalendarDays />} Connect Google Calendar
              </Button>
              {waiting && <span className="text-muted-foreground text-sm">Finish the sign-in in your browser. This page updates by itself.</span>}
            </div>
          ) : (
            <>
              <Row title="Add my tasks to Google Calendar" description="Tasks with a due date appear as all-day events. Move or rename one in either place and the other follows when you sync.">
                <Switch
                  checked={status.pushTasks}
                  disabled={busy === 'push'}
                  onCheckedChange={(v) => run('push', () => setGooglePushTasks(v))}
                  aria-label="Add my tasks to Google Calendar"
                />
              </Row>
              <Row
                title="Sync now"
                description={status.lastSyncAt ? `Last synced ${new Date(status.lastSyncAt).toLocaleString()}.` : 'Pull changes made in Google, and add tasks that are not there yet.'}
              >
                <Button
                  variant="outline"
                  disabled={busy === 'sync'}
                  onClick={() =>
                    run('sync', syncGoogle, async (r) => {
                      setInfo(summary(r))
                      if (r.updatedTasks) await loadStore() // tasks changed on the server: bring them in
                    })
                  }
                >
                  {busy === 'sync' ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
                </Button>
              </Row>
              <Row title="Disconnect" description="Stops sharing and removes the saved access from timedesk. Events already in Google stay.">
                <Button variant="outline" disabled={busy === 'disconnect'} onClick={() => run('disconnect', disconnectGoogle, () => setInfo('Google Calendar is disconnected.'))}>
                  Disconnect
                </Button>
              </Row>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
