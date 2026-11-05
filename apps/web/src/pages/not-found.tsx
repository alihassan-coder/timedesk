import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground max-w-sm text-sm">That address does not exist. Use the sidebar, or go back to the dashboard.</p>
      <Button render={<Link to="/" />}>Go to the dashboard</Button>
    </div>
  )
}
