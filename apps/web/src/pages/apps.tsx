import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { DesktopBanner } from '@/components/desktop-banner'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { appUsage, siteUsage } from '@/data/seed'
import { formatHours } from '@timedesk/shared'

const config = { minutes: { label: 'Minutes', color: 'var(--chart-3)' } } satisfies ChartConfig

export default function AppsPage() {
  return (
    <>
      <PageHeader title="Apps and sites" description="Which programs and websites you used today." />
      <DesktopBanner feature="App and site tracking">
        The desktop app notes the active window every few seconds. Window titles stay private to you; teammates only see totals if you share them.
      </DesktopBanner>

      <div className="space-y-6 opacity-60" aria-label="Sample data preview">
        <Badge variant="outline">Sample data</Badge>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Apps</CardTitle>
              <CardDescription>Minutes active today</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={config} className="h-64 w-full">
                <BarChart data={appUsage} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid horizontal={false} />
                  <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={110} />
                  <XAxis type="number" hide />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                  <Bar isAnimationActive={false} dataKey="minutes" fill="var(--color-minutes)" radius={4} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Websites</CardTitle>
              <CardDescription>From the Chrome extension and desktop app</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Site</TableHead>
                    <TableHead className="pr-6 text-right">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {siteUsage.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell className="pl-6">{s.name}</TableCell>
                      <TableCell className="pr-6 text-right">{formatHours(s.minutes * 60_000)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
