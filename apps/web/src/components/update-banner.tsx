import { Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getDesktop, useUpdateStatus } from '@/lib/desktop'

/** Shown only inside the desktop app when a newer version has been downloaded. */
export function UpdateBanner() {
  const status = useUpdateStatus()
  if (status.state === 'downloading') {
    return (
      <div role="status" className="bg-muted/60 flex items-center gap-2 border-b px-4 py-2 text-sm">
        <Download className="size-4" /> Downloading timedesk {status.version} in the background...
      </div>
    )
  }
  if (status.state !== 'ready') return null
  return (
    <div role="status" className="bg-primary text-primary-foreground flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
      <RefreshCw className="size-4" />
      <span className="flex-1">timedesk {status.version} is ready. Restart to update.</span>
      <Button size="sm" variant="secondary" onClick={() => getDesktop()?.installUpdate()}>
        Restart to update
      </Button>
    </div>
  )
}
