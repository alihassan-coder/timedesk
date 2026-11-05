import { Navigate, Outlet } from 'react-router'
import { LogoMark } from '@/components/logo'
import { useProfile } from '@/lib/auth-client'

/**
 * Everything inside needs a signed-in, approved account. Signed-out visitors go to /login.
 * A known user always wins over "loading", so a background session refetch never unmounts the page.
 */
export function RequireAuth() {
  const { user, isPending } = useProfile()
  if (user) return <Outlet />
  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LogoMark className="animate-pulse" />
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
