import { useEffect, useMemo, useState } from 'react'
import { Coffee, ExternalLink, Maximize2, Minimize2, PanelBottom, Play, Square, Timer, X } from 'lucide-react'
import {
  DEFAULT_DESKTOP_SETTINGS,
  entryDuration,
  formatDuration,
  formatShort,
  overlapMs,
  periodStart,
  pomodoroPhase,
  type DesktopSettings,
  type WidgetMode,
} from '@timedesk/shared'
import { ProjectDot } from '@/components/project-dot'
import { actions, bindStore, lastTimerTarget, loadStore, setMutationHook, useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { useProfile } from '@/lib/auth-client'
import { getDesktop } from '@/lib/desktop'
import { useAppearance } from '@/lib/appearance'
import { formatGoal, useTimerPrefs } from '@/lib/timer-prefs'
import { cn } from '@/lib/utils'

/**
 * The floating timer: a small always-on-top window of the desktop app. It is a page of this same web app, so it
 * uses the same data, theme and sign-in. The desktop app decides when it shows and how big the window is;
 * this page fills whatever size it is given, in one of four styles.
 */

const NO_DRAG = '[-webkit-app-region:no-drag]'

const MODES: { mode: WidgetMode; label: string; icon: typeof Timer }[] = [
  { mode: 'compact', label: 'Compact', icon: Minimize2 },
  { mode: 'expanded', label: 'Expanded', icon: Maximize2 },
  { mode: 'dock', label: 'Bottom bar', icon: PanelBottom },
  { mode: 'pomodoro', label: 'Pomodoro', icon: Timer },
]

function useWidgetSettings() {
  const d = getDesktop()
  const [settings, setSettings] = useState<DesktopSettings>(DEFAULT_DESKTOP_SETTINGS)
  useEffect(() => {
    if (!d) return
    const read = () => void d.getSettings().then(setSettings)
    read()
    const t = setInterval(read, 4000) // a safety net; the desktop app also tells us at once
    const off = d.onDataChanged(read)
    return () => {
      clearInterval(t)
      off()
    }
  }, [d])
  const setMode = (widgetMode: WidgetMode) => {
    setSettings((s) => ({ ...s, widgetMode }))
    void d?.setSettings({ widgetMode }).then(setSettings)
  }
  return { settings, setMode }
}

export default function WidgetPage() {
  const { user } = useProfile()
  const d = getDesktop()
  const userId = user?.id
  const { settings, setMode } = useWidgetSettings()
  const { entries, tasks, projects, ready } = useStore()
  const prefs = useTimerPrefs()
  useAppearance() // applies the saved theme to this window too

  // Same data as the main window: load it, refresh often, and reload at once when the other window changes something.
  useEffect(() => {
    if (!userId) return
    bindStore(userId)
    const t = setInterval(() => void loadStore(), 5000)
    const off = d?.onDataChanged(() => void loadStore())
    setMutationHook(() => d?.dataChanged())
    return () => {
      clearInterval(t)
      off?.()
      setMutationHook(null)
    }
  }, [userId, d])

  // A transparent page background would show the window's own colour behind rounded corners; keep it solid.
  useEffect(() => {
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
  }, [])

  const running = entries.find((e) => e.endedAt === null)
  const now = useNow(true)
  const task = running ? tasks.find((t) => t.id === running.taskId) : undefined
  const project = projects.find((p) => p.id === (running?.projectId ?? task?.projectId))
  const label = running ? (task?.title ?? project?.name ?? 'Stopwatch') : 'Not tracking'
  const clock = formatDuration(running ? entryDuration(running, now) : 0)

  const today = useMemo(() => {
    const from = periodStart('day', now)
    return entries.reduce((sum, e) => sum + overlapMs(e, from, now + 1, now), 0)
  }, [entries, now])
  const goalMs = prefs.dailyGoalMinutes * 60_000
  const goalPct = goalMs > 0 ? Math.min(100, Math.round((today / goalMs) * 100)) : 0

  const resumeTarget = lastTimerTarget(entries)
  const resumeLabel = resumeTarget
    ? (tasks.find((t) => t.id === resumeTarget.taskId)?.title ?? projects.find((p) => p.id === resumeTarget.projectId)?.name ?? 'Stopwatch')
    : 'Stopwatch'

  const mode = settings.widgetMode
  const toggle = () => (running ? void actions.stopTimer() : void actions.resumeLast())

  if (!ready) return <div className="bg-background text-muted-foreground flex h-svh w-svw items-center justify-center text-xs">Loading</div>

  const stopBtn = (
    <button
      type="button"
      onClick={toggle}
      aria-label={running ? 'Stop timer' : `Start timer on ${resumeLabel}`}
      className={cn(
        NO_DRAG,
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
        running ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-primary text-primary-foreground hover:bg-primary/90',
      )}
    >
      {running ? <Square className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
    </button>
  )
  const live = <span className={cn('size-2 shrink-0 rounded-full', running ? 'animate-pulse bg-red-500' : 'bg-muted-foreground/40')} />
  const windowButtons = (
    <div className={cn(NO_DRAG, 'flex items-center')}>
      <IconBtn label="Open timedesk" onClick={() => d?.openMainWindow()}>
        <ExternalLink />
      </IconBtn>
      <IconBtn label="Hide the floating timer" onClick={() => d?.hideWidget()}>
        <X />
      </IconBtn>
    </div>
  )
  const styles = (
    <div className={cn(NO_DRAG, 'bg-muted flex items-center gap-0.5 rounded-lg p-0.5')} role="group" aria-label="Style">
      {MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          title={m.label}
          aria-label={`${m.label} style`}
          aria-pressed={mode === m.mode}
          onClick={() => setMode(m.mode)}
          className={cn(
            'text-muted-foreground inline-flex size-6 items-center justify-center rounded-md [&_svg]:size-3.5',
            mode === m.mode ? 'bg-background text-foreground shadow-xs' : 'hover:text-foreground',
          )}
        >
          <m.icon />
        </button>
      ))}
    </div>
  )

  const root = 'bg-background text-foreground [-webkit-app-region:drag] h-svh w-svw overflow-hidden border select-none'

  /* ----------------------------- compact ----------------------------- */
  if (mode === 'compact') {
    return (
      <div className={cn(root, 'flex items-center gap-2.5 pr-1 pl-3')}>
        {live}
        <span className="font-mono text-[17px] font-semibold tabular-nums">{clock}</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{label}</span>
        {stopBtn}
        <IconBtn label="Expand" onClick={() => setMode('expanded')} className={NO_DRAG}>
          <Maximize2 />
        </IconBtn>
      </div>
    )
  }

  /* ---------------------------- bottom bar ---------------------------- */
  if (mode === 'dock') {
    return (
      <div className={cn(root, 'flex items-center gap-3 px-3')}>
        {live}
        <span className="font-mono text-sm font-semibold tabular-nums">{clock}</span>
        <span className="min-w-0 flex-1 truncate text-sm">
          {label}
          {project && running && <span className="text-muted-foreground"> · {project.name}</span>}
        </span>
        {goalMs > 0 && (
          <div className="hidden w-28 items-center gap-2 sm:flex" title={`${formatShort(today)} of ${formatGoal(prefs.dailyGoalMinutes)} today`}>
            <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
              <div className="bg-primary h-full rounded-full" style={{ width: `${goalPct}%` }} />
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">{goalPct}%</span>
          </div>
        )}
        <span className="text-muted-foreground hidden text-xs tabular-nums md:inline">{formatShort(today)} today</span>
        {stopBtn}
        <div className={cn(NO_DRAG, 'flex items-center')}>
          <IconBtn label="Expand" onClick={() => setMode('expanded')}>
            <Maximize2 />
          </IconBtn>
          <IconBtn label="Open timedesk" onClick={() => d?.openMainWindow()}>
            <ExternalLink />
          </IconBtn>
          <IconBtn label="Hide the floating timer" onClick={() => d?.hideWidget()}>
            <X />
          </IconBtn>
        </div>
      </div>
    )
  }

  /* ----------------------------- pomodoro ----------------------------- */
  if (mode === 'pomodoro') {
    const phase = running ? pomodoroPhase(running.startedAt, now, prefs.pomodoroFocus, prefs.pomodoroBreak) : null
    const R = 44
    const C = 2 * Math.PI * R
    const frac = phase ? phase.remaining / phase.total : 1
    const mm = phase ? String(Math.floor(phase.remaining / 60)).padStart(2, '0') : String(prefs.pomodoroFocus).padStart(2, '0')
    const ss = phase ? String(phase.remaining % 60).padStart(2, '0') : '00'
    return (
      <div className={cn(root, 'flex flex-col items-center gap-2.5 p-3')}>
        <div className="flex w-full items-center justify-between">
          {styles}
          {windowButtons}
        </div>
        <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
          {phase?.phase === 'break' ? <Coffee className="size-3.5" /> : <Timer className="size-3.5" />}
          {phase ? (phase.phase === 'focus' ? `Focus ${phase.round}` : 'Break') : 'Ready to focus'}
        </p>
        <div className="relative size-28">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r={R} fill="none" strokeWidth="7" className="stroke-muted" />
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
              className={cn('transition-[stroke-dashoffset] duration-1000 ease-linear', phase?.phase === 'break' ? 'stroke-emerald-500' : 'stroke-primary')}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-2xl font-semibold tabular-nums">
              {mm}:{ss}
            </span>
            <span className="text-muted-foreground text-[11px]">{phase ? 'left' : `${prefs.pomodoroFocus} min focus`}</span>
          </div>
        </div>
        <p className="max-w-full truncate text-sm font-medium">{running ? label : resumeLabel}</p>
        <div className="flex w-full items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            className={cn(
              NO_DRAG,
              'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium',
              running ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {running ? <Square className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
            {running ? 'Stop' : 'Start focus'}
          </button>
        </div>
      </div>
    )
  }

  /* ----------------------------- expanded ----------------------------- */
  return (
    <div className={cn(root, 'flex flex-col gap-2.5 p-3')}>
      <div className="flex items-center justify-between">
        {styles}
        {windowButtons}
      </div>
      <div className="flex items-center gap-2">
        {live}
        <span className="text-muted-foreground text-xs">{running ? 'Tracking' : 'Not tracking'}</span>
      </div>
      <div className="font-mono text-[34px] leading-none font-semibold tracking-tight tabular-nums">{clock}</div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{running ? label : `Resume: ${resumeLabel}`}</p>
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {project && <ProjectDot project={project} />}
          {project?.name ?? (running ? 'No project' : ' ')}
        </p>
      </div>
      {goalMs > 0 && (
        <div className="space-y-1">
          <div className="text-muted-foreground flex justify-between text-[11px]">
            <span>Today</span>
            <span className="tabular-nums">
              {formatShort(today)} of {formatGoal(prefs.dailyGoalMinutes)}
            </span>
          </div>
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div className="bg-primary h-full rounded-full transition-[width]" style={{ width: `${goalPct}%` }} />
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        className={cn(
          NO_DRAG,
          'mt-auto inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-sm font-medium',
          running ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-primary text-primary-foreground hover:bg-primary/90',
        )}
      >
        {running ? <Square className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
        {running ? 'Stop' : 'Start'}
      </button>
    </div>
  )
}

function IconBtn({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn('text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-7 items-center justify-center rounded-md [&_svg]:size-3.5', className)}
    >
      {children}
    </button>
  )
}
