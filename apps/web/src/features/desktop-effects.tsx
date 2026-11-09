import { useEffect, useMemo, useRef } from 'react'
import { pomodoroPhase, runningEntries, type ActivitySample, type DesktopSettings } from '@timedesk/shared'
import { actions, lastTimerTarget, loadStore, setMutationHook, useStore } from '@/data/store'
import { api, ApiError } from '@/lib/api'
import { getDesktop } from '@/lib/desktop'
import { notify } from '@/lib/notify'
import { timersLabel } from '@/lib/timers-label'
import { getTimerPrefs, useTimerPrefs } from '@/lib/timer-prefs'

/**
 * Connects the page to the desktop app: tray timer, "start/stop" from the tray and the global shortcut, who is
 * signed in, what to do with idle minutes, Pomodoro alerts, keeping the floating timer in step, and uploading
 * what the app tracker recorded. Renders nothing, and does nothing in a normal browser.
 */
export function DesktopEffects() {
  const { entries, tasks, projects } = useStore()
  const { titleTime, pomodoroFocus, pomodoroBreak } = useTimerPrefs()
  const timers = useMemo(() => runningEntries(entries), [entries])
  // The oldest running timer: Pomodoro and Focus guard follow it.
  const running = timers[timers.length - 1]
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
    const label = timersLabel(timers, tasks, projects)
    d.setTimerState({
      running: !!running,
      label,
      startedAt: running?.startedAt ?? null,
      showInTitle: titleTime,
      pomodoro: { focus: pomodoroFocus, break: pomodoroBreak },
    })
  }, [timers, running, tasks, projects, titleTime, pomodoroFocus, pomodoroBreak])

  // Start or stop the timer from the tray menu or the global shortcut. Starting resumes what the last timer was on.
  useEffect(() => {
    const d = getDesktop()
    if (!d) return
    return d.onTrayAction((action) => {
      if (action !== 'toggle-timer') return
      if (runningRef.current) actions.stopTimer() // all running timers
      else actions.startTimer(lastTimerTarget(entriesRef.current) ?? {})
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
      // Every timer that ran while the person was away stops when they left; "remove" starts the same ones again now.
      const away = runningEntries(entriesRef.current).filter((e) => at > e.startedAt)
      if (away.length === 0) return
      actions.stopTimer(at)
      if (action === 'remove') away.forEach((e, i) => actions.startTimer({ taskId: e.taskId, projectId: e.projectId }, { parallel: i > 0 }))
    })
  }, [])

  // Pomodoro: a notification when a focus or break period ends (only when that style is chosen).
  useEffect(() => {
    const d = getDesktop()
    if (!d) return
    let settings: DesktopSettings | null = null
    let last = ''
    const readSettings = () =>
      void d
        .getSettings()
        .then((s) => (settings = s))
        .catch(() => undefined)
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

    // After sign-out nothing is put back: what was recorded belongs to the person who left.
    let stopping = false
    /** Put back for a later try only when that can help: not after sign-out, and not when the server refused the data. */
    const keepFor = (e: unknown) => !stopping && !(e instanceof ApiError && (e.status === 422 || e.status === 401 || e.status === 403))
    const upload = async () => {
      let samples: ActivitySample[] = []
      try {
        samples = await d.pullActivity()
      } catch {
        return
      }
      for (let i = 0; i < samples.length; i += 500) {
        try {
          await api('/activity', { method: 'POST', body: { samples: samples.slice(i, i + 500) } })
        } catch (e) {
          if (keepFor(e)) d.requeueActivity(samples.slice(i)) // try again next minute
          else if (e instanceof ApiError && e.status === 422) continue // that batch can never be stored; send the rest
          return
        }
      }
    }
    // Focus guard sessions go up as soon as one finishes (the desktop app says so), and with the minute upload as a retry.
    let sendingFocus = false
    const uploadFocus = async () => {
      if (sendingFocus) return
      sendingFocus = true
      try {
        const sessions = await d.pullFocusSessions().catch(() => [])
        if (sessions.length === 0) return
        for (let i = 0; i < sessions.length; i += 100) {
          const batch = sessions.slice(i, i + 100)
          try {
            await api('/focus/sessions', { method: 'POST', body: { sessions: batch } })
          } catch (e) {
            // Offline or a server problem: try again later (the API skips sessions it already has). A batch the API
            // refuses as invalid would be refused forever, so it is dropped.
            if (keepFor(e)) d.requeueFocusSessions(sessions.slice(i))
            if (e instanceof ApiError && e.status === 422) continue
            return
          }
        }
      } finally {
        sendingFocus = false
      }
    }
    const offFocus = d.onFocusState((s) => {
      if (s.pending > 0) void uploadFocus()
    })

    const timer = setInterval(() => {
      void upload()
      void uploadFocus()
    }, 60_000)
    return () => {
      clearInterval(timer)
      offFocus()
      stopping = true
      void upload()
      void uploadFocus()
      d.setSignedIn(false)
    }
  }, [])

  return null
}

