import { useEffect, useRef } from 'react'
import type { ActivitySample } from '@timedesk/shared'
import { actions, useStore } from '@/data/store'
import { api } from '@/lib/api'
import { getDesktop } from '@/lib/desktop'

/**
 * Connects the page to the desktop app: tray timer, "start/stop" from the tray, who is signed in,
 * and uploading what the app tracker recorded. Renders nothing, and does nothing in a normal browser.
 */
export function DesktopEffects() {
  const { entries, tasks, projects } = useStore()
  const running = entries.find((e) => e.endedAt === null)
  const runningRef = useRef(running)
  useEffect(() => {
    runningRef.current = running
  }, [running])

  // Timer in the tray tooltip.
  useEffect(() => {
    const d = getDesktop()
    if (!d) return
    const label = running ? (tasks.find((t) => t.id === running.taskId)?.title ?? projects.find((p) => p.id === running.projectId)?.name ?? 'Stopwatch') : ''
    d.setTimerState({ running: !!running, label, startedAt: running?.startedAt ?? null })
  }, [running, tasks, projects])

  // Start or stop the timer from the tray menu.
  useEffect(() => {
    const d = getDesktop()
    if (!d) return
    return d.onTrayAction((action) => {
      if (action !== 'toggle-timer') return
      if (runningRef.current) void actions.stopTimer()
      else void actions.startTimer({})
    })
  }, [])

  // App tracking only runs while someone is signed in, and its samples are uploaded once a minute.
  useEffect(() => {
    const d = getDesktop()
    if (!d) return
    d.setSignedIn(true)

    const upload = async () => {
      const samples = await d.pullActivity()
      if (samples.length === 0) return
      let sent = 0
      try {
        for (let i = 0; i < samples.length; i += 500) {
          await api('/activity', { method: 'POST', body: { samples: samples.slice(i, i + 500) } })
          sent = Math.min(samples.length, i + 500)
        }
      } catch {
        d.requeueActivity(samples.slice(sent) as ActivitySample[]) // try again next minute
      }
    }
    const timer = setInterval(() => void upload(), 60_000)
    return () => {
      clearInterval(timer)
      void upload()
      d.setSignedIn(false)
    }
  }, [])

  return null
}
