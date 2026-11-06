import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { Moon, Settings, Sun } from 'lucide-react'
import { AppSidebar } from '@/components/app-sidebar'
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
import { useTitleTimer } from '@/features/title-timer'
import { useReminders } from '@/features/reminders'
import { bindChats } from '@/features/assistant/chat-store'
import { bindAi } from '@/lib/ai/server'
import { useProfile } from '@/lib/auth-client'
import { startSettingsSync } from '@/lib/settings-sync'
import { toggleMode, useAppearance } from '@/lib/appearance'
import { titleFor } from '@/lib/nav'

export default function Layout() {
  const { pathname } = useLocation()
  const { user } = useProfile()
  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    // Each part shows what this device cached, then syncs with the database.
    bindStore(userId)
    void bindChats(userId)
    bindAi(userId)
    void startSettingsSync(userId)
  }, [userId])
  useReminders()
  useTitleTimer()
  useAppearance() // re-render when the mode changes so the sun/moon icon updates
  const dark = document.documentElement.classList.contains('dark')
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <UpdateBanner />
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
        <main className={pathname === '/assistant' ? 'flex-1' : 'mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 md:p-8'}>
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
