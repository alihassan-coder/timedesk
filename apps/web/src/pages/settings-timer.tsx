import { Row } from '@/components/setting-row'
import { SimpleSelect } from '@/components/simple-select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { formatGoal, patchTimerPrefs, useTimerPrefs } from '@/lib/timer-prefs'

const withCurrent = (values: number[], current: number) => [...new Set([...values, current])].sort((a, b) => a - b)

/** Timer preferences. Saved to your account, so they follow you to every device. */
export function TimerTab() {
  const prefs = useTimerPrefs()
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Daily goal</CardTitle>
          <CardDescription>The progress bar in the floating timer and the bottom bar fills toward this.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row title="Tracked time per day" description="Pick Off to hide the goal.">
            <SimpleSelect
              className="w-32"
              value={String(prefs.dailyGoalMinutes)}
              onChange={(v) => patchTimerPrefs({ dailyGoalMinutes: Number(v) })}
              options={withCurrent([0, 120, 240, 300, 360, 420, 480, 600], prefs.dailyGoalMinutes).map((m) => ({ value: String(m), label: formatGoal(m) }))}
            />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pomodoro</CardTitle>
          <CardDescription>
            Used by the Pomodoro style of the floating timer in the desktop app (choose the style under Settings, Desktop). Your timer keeps running through breaks.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row title="Focus length" description="How long each focus period lasts.">
            <SimpleSelect
              className="w-32"
              value={String(prefs.pomodoroFocus)}
              onChange={(v) => patchTimerPrefs({ pomodoroFocus: Number(v) })}
              options={withCurrent([15, 20, 25, 30, 45, 50, 60, 90], prefs.pomodoroFocus).map((m) => ({ value: String(m), label: `${m} min` }))}
            />
          </Row>
          <Row title="Break length" description="The pause after each focus period.">
            <SimpleSelect
              className="w-32"
              value={String(prefs.pomodoroBreak)}
              onChange={(v) => patchTimerPrefs({ pomodoroBreak: Number(v) })}
              options={withCurrent([3, 5, 10, 15, 20], prefs.pomodoroBreak).map((m) => ({ value: String(m), label: `${m} min` }))}
            />
          </Row>
          <Row title="Notify me when a period ends" description="A system notification at the end of each focus period and each break.">
            <Switch checked={prefs.pomodoroNotify} onCheckedChange={(v) => patchTimerPrefs({ pomodoroNotify: v })} aria-label="Notify me when a Pomodoro period ends" />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Window title</CardTitle>
          <CardDescription>See the timer without opening the app: in the browser tab, and in the taskbar and Alt-Tab on the desktop.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row title="Show the running time in the title" description="For example: 00:42:10 - Write docs.">
            <Switch checked={prefs.titleTime} onCheckedChange={(v) => patchTimerPrefs({ titleTime: v })} aria-label="Show the running time in the title" />
          </Row>
        </CardContent>
      </Card>
    </div>
  )
}
