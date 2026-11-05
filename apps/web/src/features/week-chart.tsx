import { Bar, BarChart, Cell, XAxis } from 'recharts'
import { dailyTotals, formatHours } from '@timedesk/shared'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'

const config = { hours: { label: 'Tracked', color: 'var(--chart-1)' } } satisfies ChartConfig

export function WeekChart() {
  const { entries } = useStore()
  const running = entries.some((e) => e.endedAt === null)
  const now = useNow(running)

  const data = dailyTotals(entries, now, 7).map((d, i, all) => ({
    day: new Date(d.start).toLocaleDateString(undefined, { weekday: 'short' }),
    hours: d.ms / 3_600_000,
    ms: d.ms,
    today: i === all.length - 1,
  }))

  return (
    <ChartContainer config={config} className="h-44 w-full">
      <BarChart data={data} margin={{ left: 0, right: 0, top: 8 }}>
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent hideLabel formatter={(_v, _n, item) => formatHours(item.payload.ms)} />}
        />
        <Bar dataKey="hours" radius={4}>
          {data.map((d) => (
            <Cell key={d.day + d.ms} fill={d.today ? 'var(--chart-2)' : 'var(--color-hours)'} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
