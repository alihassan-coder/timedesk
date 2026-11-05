import { Activity } from 'lucide-react'
import { PageHeader } from '@/components/page-header'

export default function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity" description="Everything that changed across your projects." />
      <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center text-sm">
        <Activity className="size-8" />
        <p className="max-w-sm">
          The team activity feed arrives with shared projects. For now, your own work shows on the dashboard and in reports.
        </p>
      </div>
    </>
  )
}
