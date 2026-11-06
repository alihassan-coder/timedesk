import { useEffect, useRef } from 'react'
import { pomodoroPhase, type ActivitySample, type DesktopSettings } from '@timedesk/shared'
import { actions, lastTimerTarget, loadStore, setMutationHook, useStore } from '@/data/store'
import { api } from '@/lib/api'
import { getDesktop } from '@/lib/desktop'
import { notify } from '@/lib/notify'
import { getTimerPrefs, useTimerPrefs } from '@/lib/timer-prefs'

/**
 * Connects the page to the desktop app: tray timer, "start/stop" from the tray and the global shortcut, who is
 * signed in, what to do with idle minutes, Pomodoro alerts, keeping the floating timer in step, and uploading
 * what the app tracker recorded. Renders nothing, and does nothing in a normal browser.
 */
export function DesktopEffects() {
  const { entries, tasks, projects } = useStore()
  const { titleTime } = useTimerPrefs()
  const running = entries.find((e) => e.endedAt === null)
  const runningRef = useRef(running)
  const entriesRef = useRef(entries)
  useEffect(() => {
    runningRef.current = running
    entriesRef.current = entries
  }, [running, entries])

  // The running timer, for the tray, the window title and the floating timer.
  useEffect(() => {
    const d = getDesktop()
    if (!d) return
    const label = running ? (tasks.find((t) => t.id === running.taskId)?.title ?? projects.find((p) => p.id === running.projectId)?.name ?? 'Stopwatch') : ''
    d.setTimerState({ running: !!running, label, startedAt: running?.startedAt ?? null, showInTitle: titleTime })
  }, [running, tasks, projects, titleTime])

  // Start or stop the timer from the tray menu or the global shortcut. Starting resumes what the last timer was on.
  useEffect(() => {
    const d = getDesktop()
    if (!d) return
    return d.onTrayAction((action) => {
      if (action !== 'toggle-timer') return
      if (runningRef.current) void actions.stopTimer()
      else void actions.startTimer(lastTimerTarget(entriesRef.current) ?? {})
    })
  }, [])

  // Keep this window and the floating timer in step: tell the other window about our changes, reload on theirs.
  useEffect(() => {
    const d = getDesktop()
    if (!d) return
    setMutationHook(() => d.dataChanged())
    const off = d.onDataChanged(() => void loadStore())
    return () => {
      off()
      setMutationHook(null)
    }
  }, [])

  // Coming back after being away: the desktop app asked what to do, and this applies the answer.
  useEffect(() => {
    const d = getDesktop()
    if (!d) return
    return d.onIdleDecision(({ action, at }) => {
      const current = runningRef.current
      if (!current || at <= current.startedAt) return
      const target = { taskId: current.taskId, projectId: current.projectId }
      void actions.stopTimer(at).then(() => (action === 'remove' ? actions.startTimer(target) : undefined))
    })
  }, [])

  // Pomodoro: a notification when a focus or break period ends (only when that style is chosen).
  useEffect(() => {
    const d = getDesktop()
    if (!d) return
    let settings: DesktopSettings | null = null
    let last = ''
    const readSettings = () => void d.getSettings().then((s) => (settings = s))
    readSettings()
    const refresh = setInterval(readSettings, 10_000)
    const tick = setInterval(() => {
      const r = runningRef.current
      const prefs = getTimerPrefs()
      if (!r || settings?.widgetMode !== 'pomodoro' || !prefs.pomodoroNotify) {
        last = ''
        return
      }
      const p = pomodoroPhase(r.startedAt, Date.now(), prefs.pomodoroFocus, prefs.pomodoroBreak)
      const key = `${r.id}:${p.round}:${p.phase}`
      if (last && key !== last) {
        if (p.phase === 'break') void notify('Focus finished', `Take a ${prefs.pomodoroBreak} minute break.`)
        else void notify('Break is over', 'Back to focus.')
      }
      last = key
    }, 1000)
    return () => {
      clearInterval(refresh)
      clearInterval(tick)
    }
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
