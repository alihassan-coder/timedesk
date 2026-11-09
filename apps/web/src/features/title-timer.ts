import { useEffect } from 'react'
import { entryDuration, formatDuration, runningEntries } from '@timedesk/shared'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { timersLabel } from '@/lib/timers-label'
import { isDesktop } from '@/lib/desktop'
import { useTimerPrefs } from '@/lib/timer-prefs'

/**
 * Shows the running time in the browser tab, for example "● 00:42:10 · Write docs". The desktop app sets its own
 * window title (so the time also shows in the taskbar and Alt-Tab), so this only runs in a normal browser.
 *
 * It is a component that renders nothing, so its once-a-second tick re-renders only itself, not the whole layout.
 */
export function TitleTimer() {
  return isDesktop() ? null : TitleTimerInner()
}

function TitleTimerInner() {
  const { entries, tasks, projects } = useStore()
  const { titleTime } = useTimerPrefs()
  const timers = runningEntries(entries)
  const newest = timers[0]
  const now = useNow(!!newest)
  const label = timersLabel(timers, tasks, projects)
  const clock = newest ? formatDuration(entryDuration(newest, now)) : ''

  useEffect(() => {
    document.title = newest && titleTime ? `● ${clock} · ${label} — timedesk` : 'timedesk'
    return () => {
      document.title = 'timedesk'
    }
  }, [newest, titleTime, clock, label])
  return null
}
