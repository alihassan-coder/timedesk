import { Link } from 'react-router'
import { CloudOff, LoaderCircle, LogIn, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dismissError, syncNow, useStore } from '@/data/store'
import { useProfile } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

const waiting = (n: number) => (n === 1 ? '1 change waiting' : `${n} changes waiting`)

/**
 * A small badge in the top bar: nothing when everything is saved, "Saving" while changes go out, "Offline" with the
 * number of changes waiting on this device, or a sign-in link when the session ended. Clicking it tries again now.
 */
export function SyncStatus() {
  const { sync, pending } = useStore()
  const { offline } = useProfile()
  const isOffline = sync === 'offline' || offline
  if (sync === 'signin') {
    return (
      <Button size="sm" variant="outline" className="text-amber-700 dark:text-amber-400" render={<Link to="/login" />}>
        <LogIn /> Sign in to send {waiting(pending)}
      </Button>
    )
  }
  if (!isOffline && (sync === 'synced' || pending === 0)) return null
  const label = isOffline ? (pending ? `Offline · ${waiting(pending)}` : 'Offline') : 'Saving...'
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={isOffline ? 'You are offline. Your changes are kept on this device and sent when the connection is back. Click to try now.' : 'Sending your changes'}
      aria-live="polite"
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
        isOffline ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
      )}
    >
      {isOffline ? <CloudOff className="size-3.5" /> : <LoaderCircle className="size-3.5 animate-spin" />}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

/** The one place store errors are shown, on every page, with a way to close it. */
export function StoreErrorBar() {
  const { error } = useStore()
  if (!error) return null
  return (
    <div role="alert" className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 border-b px-4 py-2 text-sm">
      <p className="flex-1">{error}</p>
      <button type="button" aria-label="Close the message" onClick={dismissError} className="hover:bg-destructive/10 rounded p-0.5">
        <X className="size-4" />
      </button>
    </div>
  )
}
