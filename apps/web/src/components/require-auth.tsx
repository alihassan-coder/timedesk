import { Navigate, Outlet, useLocation } from 'react-router'
import { LogoMark } from '@/components/logo'
import { useProfile } from '@/lib/auth-client'
import { getDesktop } from '@/lib/desktop'

/** The desktop app's small windows. They never show the sign-in page: it would not fit, and it would load the whole app there. */
const SMALL_WINDOWS = ['/widget', '/quick-add']

/**
 * Everything inside needs a signed-in, approved account. Signed-out visitors go to /login.
 * A known user always wins over "loading", so a background session refetch never unmounts the page. The person this
 * device remembers counts too, so the app opens at once and keeps working offline (see useProfile).
 */
export function RequireAuth() {
  const { user, isPending } = useProfile()
  const { pathname } = useLocation()
  if (user) return <Outlet />
  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LogoMark className="animate-pulse" />
      </div>
    )
  }
  if (SMALL_WINDOWS.includes(pathname)) {
    return (
      <div className="bg-background text-muted-foreground flex h-svh w-svw items-center justify-center gap-2 border px-3 text-xs">
        <span>Sign in to timedesk first.</span>
        <button type="button" className="text-foreground underline" onClick={() => getDesktop()?.openMainWindow()}>
          Open timedesk
        </button>
      </div>
    )
  }
  return <Navigate to="/login" replace />
}

/**
 * Login and register are for signed-out visitors. Never unmount while the session is loading:
 * the register form keeps its "request sent" state even when the session refetches in the background.
 */
export function PublicOnly() {
  const { user } = useProfile()
  if (user) return <Navigate to="/" replace />
  return <Outlet />
}
