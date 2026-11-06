import { useEffect } from 'react'
import { entryDuration, formatDuration } from '@timedesk/shared'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { isDesktop } from '@/lib/desktop'
import { useTimerPrefs } from '@/lib/timer-prefs'

/**
 * Shows the running time in the browser tab, for example "● 00:42:10 · Write docs". The desktop app sets its own
 * window title (so the time also shows in the taskbar and Alt-Tab), so this only runs in a normal browser.
 */
export function useTitleTimer() {
  const { entries, tasks, projects } = useStore()
  const { titleTime } = useTimerPrefs()
  const running = entries.find((e) => e.endedAt === null)
  const now = useNow(!!running)
  const label = running ? (tasks.find((t) => t.id === running.taskId)?.title ?? projects.find((p) => p.id === running.projectId)?.name ?? 'Stopwatch') : ''
  const clock = running ? formatDuration(entryDuration(running, now)) : ''

  useEffect(() => {
    if (isDesktop()) return
    document.title = running && titleTime ? `● ${clock} · ${label} — timedesk` : 'timedesk'
    return () => {
      document.title = 'timedesk'
    }
  }, [running, titleTime, clock, label])
}
