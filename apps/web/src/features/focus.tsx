import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Plus, ShieldCheck, X } from 'lucide-react'
import {
  FOCUS_NUDGE_CHOICES,
  formatHours,
  IDLE_FOCUS_STATE,
  periodStart,
  SUGGESTED_FOCUS_APPS,
  SUGGESTED_FOCUS_SITES,
  type DesktopSettings,
  type FocusState,
  type FocusSummary,
} from '@timedesk/shared'
import { Row } from '@/components/setting-row'
import { SimpleSelect } from '@/components/simple-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { clockOf } from '@/lib/clock'
import { getDesktop } from '@/lib/desktop'

/** Focus guard as the desktop app sees it right now. Idle in a normal browser. */
export function useFocusState(): FocusState {
  const [state, setState] = useState<FocusState>(IDLE_FOCUS_STATE)
  useEffect(() => {
    const d = getDesktop()
    if (!d) return
    let live = true
    void d.getFocusState().then((s) => live && setState(s))
    const off = d.onFocusState(setState)
    return () => {
      live = false
      off()
    }
  }, [])
  return state
}

const nudgeLabel = (s: number) => (s < 60 ? `After ${s} seconds` : `After ${s / 60} minute${s === 60 ? '' : 's'}`)

/** Settings for Focus guard. They belong to this computer, like the rest of the Desktop tab. */
export function FocusGuardCard({ settings, change }: { settings: DesktopSettings; change: (patch: Partial<DesktopSettings>) => void }) {
  const choices = FOCUS_NUDGE_CHOICES.includes(settings.focusNudgeSeconds as (typeof FOCUS_NUDGE_CHOICES)[number])
    ? FOCUS_NUDGE_CHOICES
    : [...FOCUS_NUDGE_CHOICES, settings.focusNudgeSeconds].sort((a, b) => a - b)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" /> Focus guard
        </CardTitle>
        <CardDescription>
          While a timer runs, timedesk notices when an app or site from your lists is in front and nudges you back. You get a focus score on the dashboard and in
          Tempo&apos;s summaries. It is checked on this computer: window titles are never saved or sent, only which of your listed names took time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="divide-y">
          <Row title="Turn on Focus guard" description="Works whenever a timer is running. Rests during Pomodoro breaks, and time away from the computer does not count.">
            <Switch checked={settings.focusGuard} onCheckedChange={(v) => change({ focusGuard: v })} aria-label="Focus guard" />
          </Row>
          <Row title="Nudge me" description="How long a distraction may stay in front before the reminder. A quick look is fine.">
            <SimpleSelect
              className="w-48"
              value={String(settings.focusNudgeSeconds)}
              onChange={(v) => change({ focusNudgeSeconds: Number(v) })}
              options={choices.map((s) => ({ value: String(s), label: nudgeLabel(s) }))}
            />
          </Row>
        </div>
        <FocusList
          title="Distracting apps"
          hint="Program names, for example Discord or Steam."
          noun="app"
          items={settings.focusApps}
          suggestions={SUGGESTED_FOCUS_APPS}
          onChange={(focusApps) => change({ focusApps })}
        />
        <FocusList
          title="Distracting sites"
          hint="Words from the browser tab title, for example YouTube or reddit.com."
          noun="site"
          items={settings.focusSites}
          suggestions={SUGGESTED_FOCUS_SITES}
          onChange={(focusSites) => change({ focusSites })}
        />
        <p className="text-muted-foreground text-xs">On Linux this needs X11; Wayland desktops may not say which window is in front.</p>
      </CardContent>
    </Card>
  )
}

function FocusList({
  title,
  hint,
  noun,
  items,
  suggestions,
  onChange,
}: {
  title: string
  hint: string
  noun: string
  items: string[]
  suggestions: string[]
  onChange: (items: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const has = (v: string) => items.some((i) => i.toLowerCase() === v.trim().toLowerCase())
  const add = (v: string) => {
    const item = v.trim()
    if (item && !has(item)) onChange([...items, item])
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    add(draft)
    setDraft('')
  }
  const more = suggestions.filter((s) => !has(s))
  const id = `focus-${noun}`
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium" id={`${id}-title`}>
          {title}
        </p>
        <p className="text-muted-foreground text-sm">{hint}</p>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-labelledby={`${id}-title`}>
        {items.map((item) => (
          <li key={item} className="bg-secondary text-secondary-foreground flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-sm">
            {item}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              onClick={() => onChange(items.filter((i) => i !== item))}
              className="hover:bg-background/70 inline-flex size-5 items-center justify-center rounded-full"
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="text-muted-foreground text-sm">Nothing listed, so nothing counts as a distraction.</li>}
      </ul>
      <form onSubmit={submit} className="flex max-w-sm gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} placeholder={`Add an ${noun}`} aria-label={`Add a distracting ${noun}`} />
        <Button type="submit" variant="outline" disabled={!draft.trim() || has(draft)}>
          Add
        </Button>
      </form>
      {more.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Suggestions:</span>
          {more.map((s) => (
            <Button key={s} size="xs" variant="ghost" className="text-muted-foreground h-6 rounded-full px-2" onClick={() => add(s)}>
              <Plus className="size-3" /> {s}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Today's and this week's focus, on the dashboard. Shown once there is something to show, or as a hint in the desktop app. */
export function FocusSummaryCard({ now }: { now: number }) {
  const [data, setData] = useState<{ today: FocusSummary; week: FocusSummary } | null>(null)
  const [guardOn, setGuardOn] = useState<boolean | null>(null)
  const live = useFocusState()
  const dayStart = periodStart('day', now)

  useEffect(() => {
    let alive = true
    const range = (from: number) => `from=${encodeURIComponent(new Date(from).toISOString())}`
    const load = () =>
      Promise.all([api<FocusSummary>(`/focus/summary?${range(dayStart)}`), api<FocusSummary>(`/focus/summary?${range(dayStart - 6 * 86_400_000)}`)])
        .then(([today, week]) => alive && setData({ today, week }))
        .catch(() => undefined)
    void load()
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
    // A finished session was just uploaded (pending dropped back): load again.
  }, [dayStart, live.pending])

  useEffect(() => {
    void getDesktop()
      ?.getSettings()
      .then((s) => setGuardOn(s.focusGuard))
  }, [])

  if (!data) return null
  const { today, week } = data
  if (week.sessions === 0 && !live.active) {
    if (guardOn !== false) return null
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> Stay on track with Focus guard
          </CardTitle>
          <CardDescription>While a timer runs, get a gentle nudge when YouTube, Discord or anything else you list takes over, and see a focus score here.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<Link to="/settings?tab=desktop" />}>
            Set up Focus guard
          </Button>
        </CardContent>
      </Card>
    )
  }

  const top = week.topDistractions[0]
  const facts = [
    { label: 'Focus today', value: today.score === null ? '-' : `${today.score}%`, note: today.sessions ? `${formatHours(today.focusedSeconds * 1000)} focused` : 'No session yet today' },
    { label: 'Last 7 days', value: week.score === null ? '-' : `${week.score}%`, note: `${week.sessions} session${week.sessions === 1 ? '' : 's'}` },
    { label: 'Interruptions today', value: String(today.interruptions), note: `${week.interruptions} in 7 days` },
    { label: 'Biggest distraction', value: top?.name ?? 'None', note: top ? `${formatHours(top.seconds * 1000)} in 7 days` : 'Nothing listed took time' },
  ]
  return (
    <Card data-testid="focus-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" /> Focus
        </CardTitle>
        <CardDescription>
          {live.active
            ? live.distracted
              ? `Right now: ${live.match} has been in front for ${clockOf(live.streakSeconds)}.`
              : live.onBreak
                ? 'Pomodoro break: Focus guard is resting.'
                : 'Focus guard is on for the running timer.'
            : 'Time on work versus the apps and sites you listed, while a timer ran.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label}>
            <p className="text-muted-foreground text-sm">{f.label}</p>
            <p className="truncate text-2xl font-semibold">{f.value}</p>
            <p className="text-muted-foreground text-xs">{f.note}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
