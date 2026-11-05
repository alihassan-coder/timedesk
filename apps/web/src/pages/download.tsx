import { Download, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { DESKTOP_VERSION, downloads } from '@/lib/downloads'

const FEATURES = [
  'Tracks which apps and websites you use, live',
  'Native reminders for due tasks and running timers',
  'Starts with your computer and lives in the tray',
  'Works offline and syncs when you reconnect',
  'Tells you when a new version is ready and updates itself',
]

export default function DownloadPage() {
  return (
    <>
      <PageHeader title="Desktop app" description="Same screens as the web app, plus everything a browser cannot do." />

      <div className="grid gap-4 md:grid-cols-3">
        {downloads.map((d) => (
          <Card key={d.id}>
            <CardHeader>
              <CardTitle>{d.label}</CardTitle>
              <CardDescription>{d.note}</CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              {d.file} · v{DESKTOP_VERSION}
            </CardContent>
            <CardFooter>
              <Button render={<a href={d.href} target="_blank" rel="noreferrer" />}>
                <Download /> Download
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What the desktop app adds</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {FEATURES.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How updates look</CardTitle>
          <CardDescription>This is the banner you will see inside the desktop app when a new version is out.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/50 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
            <RefreshCw className="size-4" />
            <span className="flex-1">
              timedesk 0.2.0 is ready <Badge variant="secondary">New</Badge>
            </span>
            <Button size="sm" variant="outline" disabled>
              Restart to update
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
