import { Suspense, useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { Moon, Settings, Sun } from 'lucide-react'
import { AppSidebar } from '@/components/app-sidebar'
import { ErrorBoundary } from '@/components/error-boundary'
import { StoreErrorBar, SyncStatus } from '@/components/sync-status'
import { NotificationsBell } from '@/components/notifications-bell'
import { TimerWidget } from '@/components/timer-widget'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { UpdateBanner } from '@/components/update-banner'
import { bindStore } from '@/data/store'
import { CommandPalette } from '@/features/command-palette'
import { DesktopEffects } from '@/features/desktop-effects'
import { TitleTimer } from '@/features/title-timer'
import { useReminders } from '@/features/reminders'
import { bindChats } from '@/features/assistant/chat-store'
import { bindAi } from '@/lib/ai/server'
import { useProfile } from '@/lib/auth-client'
import { startSettingsSync } from '@/lib/settings-sync'
import { toggleMode, useAppearance } from '@/lib/appearance'
import { titleFor } from '@/lib/nav'
import { prefetchPages } from '@/lib/pages'

export default function Layout() {
  const { pathname } = useLocation()
  const { user } = useProfile()
  const userId = user?.id
  // Bound during render (it only acts once per person), so the very first paint already shows this device's data
  // instead of empty screens that fill in a moment later.
  if (userId) bindStore(userId)
  useEffect(() => {
    if (!userId) return
    // Each part shows what this device cached, then syncs with the database.
    void bindChats(userId)
    bindAi(userId)
    void startSettingsSync(userId)
  }, [userId])
  // Fetch the other pages' code in the background, so opening them later is instant.
  useEffect(() => prefetchPages(), [])
  useReminders()
  useAppearance() // re-render when the mode changes so the sun/moon icon updates
  const dark = document.documentElement.classList.contains('dark')
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <UpdateBanner />
        <TitleTimer />
        <DesktopEffects />
        <CommandPalette />
        <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{titleFor(pathname)}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-1">
            <SyncStatus />
            <TimerWidget />
            <NotificationsBell />
            <Button size="icon-sm" variant="ghost" aria-label="Toggle light and dark mode" onClick={toggleMode}>
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Settings" render={<Link to="/settings" />}>
              <Settings />
            </Button>
          </div>
        </header>
        <StoreErrorBar />
        <main className={pathname === '/assistant' ? 'flex-1' : 'mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 md:p-8'}>
          {/* Pages load on first visit; the sidebar and top bar stay put meanwhile. */}
          {/* A page that crashes shows its error here; the sidebar keeps working and the next page starts clean. */}
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<p className="text-muted-foreground animate-pulse py-10 text-center text-sm">Loading...</p>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
