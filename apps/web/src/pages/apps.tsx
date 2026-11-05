import { Globe, Monitor } from 'lucide-react'
import { DesktopBanner } from '@/components/desktop-banner'
import { PageHeader } from '@/components/page-header'

export default function AppsPage() {
  return (
    <>
      <PageHeader title="Apps and sites" description="Which programs and websites you used today." />
      <DesktopBanner feature="App and site tracking">
        The desktop app notes the active window every few seconds. Window titles stay private to you; teammates only see totals if you share them.
      </DesktopBanner>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="text-muted-foreground flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm">
          <Monitor className="mt-0.5 size-5 shrink-0" />
          <p>Apps: time per program (code editor, browser, design tool) will be listed here once the desktop app is running.</p>
        </div>
        <div className="text-muted-foreground flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm">
          <Globe className="mt-0.5 size-5 shrink-0" />
          <p>Websites: time per site comes from the desktop app and the Chrome extension.</p>
        </div>
      </div>
    </>
  )
}
