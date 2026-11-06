import { Link } from 'react-router'
import type { DesktopSettings, WidgetMode } from '@timedesk/shared'
import { Row } from '@/components/setting-row'
import { SimpleSelect } from '@/components/simple-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const STYLES: { mode: WidgetMode; title: string; text: string }[] = [
  { mode: 'compact', title: 'Compact', text: 'A small pill: time, task and a stop button.' },
  { mode: 'expanded', title: 'Expanded', text: 'Big clock, project, daily goal and a Stop button.' },
  { mode: 'dock', title: 'Bottom bar', text: 'A thin full-width bar along the bottom of the screen.' },
  { mode: 'pomodoro', title: 'Pomodoro', text: 'A countdown ring for focus periods and breaks.' },
]

/** A tiny drawing of each style, so the choice is visual. */
function Preview({ mode }: { mode: WidgetMode }) {
  const bar = 'bg-muted-foreground/30 rounded-full'
  return (
    <div className="bg-muted/60 relative flex h-20 items-end justify-end overflow-hidden rounded-md p-2" aria-hidden>
      {mode === 'compact' && (
        <div className="bg-background flex h-6 w-24 items-center gap-1.5 rounded-full border px-2 shadow-xs">
          <span className="size-1.5 rounded-full bg-red-500" />
          <span className="font-mono text-[9px] font-semibold">00:42</span>
          <span className={cn(bar, 'h-1 flex-1')} />
        </div>
      )}
      {mode === 'expanded' && (
        <div className="bg-background flex h-14 w-24 flex-col gap-1 rounded-md border p-1.5 shadow-xs">
          <span className="font-mono text-[11px] leading-none font-semibold">00:42:10</span>
          <span className={cn(bar, 'h-1 w-12')} />
          <span className="bg-primary/40 mt-auto h-1 w-full rounded-full" />
        </div>
      )}
      {mode === 'dock' && (
        <div className="bg-background absolute inset-x-0 bottom-0 flex h-5 items-center gap-1.5 border-t px-2">
          <span className="size-1.5 rounded-full bg-red-500" />
          <span className="font-mono text-[9px] font-semibold">00:42</span>
          <span className={cn(bar, 'h-1 flex-1')} />
          <span className="bg-primary/50 h-1 w-8 rounded-full" />
        </div>
      )}
      {mode === 'pomodoro' && (
        <div className="bg-background flex h-16 w-20 items-center justify-center self-center rounded-md border shadow-xs">
          <div className="border-primary size-9 rounded-full border-[3px] border-r-muted" />
        </div>
      )}
    </div>
  )
}

/** Settings for the floating timer. They belong to this computer. */
export function FloatingTimerCard({ settings, change }: { settings: DesktopSettings; change: (patch: Partial<DesktopSettings>) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Floating timer</CardTitle>
        <CardDescription>
          A small window that stays on top, so you can see what is running without opening timedesk. Drag it anywhere. Saved on this computer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">Style</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Floating timer style">
            {STYLES.map((s) => (
              <button
                key={s.mode}
                type="button"
                role="radio"
                aria-checked={settings.widgetMode === s.mode}
                onClick={() => change({ widgetMode: s.mode })}
                className={cn(
                  'space-y-2 rounded-xl border p-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  settings.widgetMode === s.mode ? 'border-primary bg-primary/5 ring-primary ring-1' : 'hover:bg-accent/50',
                )}
              >
                <Preview mode={s.mode} />
                <div className="px-1 pb-1">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-muted-foreground text-xs">{s.text}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y">
          <Row title="When to show it" description="Automatic shows it only while a timer is running and timedesk is not the window in front.">
            <SimpleSelect
              className="w-48"
              value={settings.widget}
              onChange={(v) => change({ widget: v })}
              options={[
                { value: 'auto', label: 'Automatic' },
                { value: 'always', label: 'Always' },
                { value: 'never', label: 'Never' },
              ]}
            />
          </Row>
          <Row title="Keyboard shortcuts" description="Ctrl+Alt+T starts or stops the timer from any program. Ctrl+Alt+N adds a task. (Not available on every Linux desktop.)">
            <Switch checked={settings.shortcuts} onCheckedChange={(v) => change({ shortcuts: v })} aria-label="Keyboard shortcuts" />
          </Row>
          <Row title="Ask about idle time" description="If you step away while the timer runs, ask what to do with those minutes when you come back.">
            <SimpleSelect
              className="w-48"
              value={String(settings.idleMinutes)}
              onChange={(v) => change({ idleMinutes: Number(v) })}
              options={[
                { value: '0', label: 'Off' },
                { value: '5', label: 'After 5 minutes' },
                { value: '10', label: 'After 10 minutes' },
                { value: '15', label: 'After 15 minutes' },
                { value: '30', label: 'After 30 minutes' },
              ]}
            />
          </Row>
        </div>
        <Button variant="link" className="h-auto p-0" render={<Link to="/settings?tab=timer" />}>
          Daily goal and Pomodoro lengths
        </Button>
      </CardContent>
    </Card>
  )
}
