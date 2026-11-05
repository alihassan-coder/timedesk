import { Link } from 'react-router'
import { Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Shown where a feature needs the OS (app tracking, native notifications). Same layout, locked content. */
export function DesktopBanner({ feature, children }: { feature: string; children?: React.ReactNode }) {
  return (
    <div className="bg-muted/50 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
      <div className="bg-background flex size-10 shrink-0 items-center justify-center rounded-md border">
        <Monitor className="size-5" />
      </div>
      <div className="flex-1">
        <p className="font-medium">{feature} needs the desktop app</p>
        <p className="text-muted-foreground text-sm">
          {children ?? 'A browser cannot see other programs. Install timedesk for Windows or Linux and everything appears here.'}
        </p>
      </div>
      <Button render={<Link to="/download" />}>Get the desktop app</Button>
    </div>
  )
}
