import { Link, useLocation } from 'react-router'
import { BarChart3, ChevronsUpDown, LayoutDashboard, ListChecks, LogOut, Moon, Sun, Timer } from 'lucide-react'
import { formatDuration, entryDuration } from '@timedesk/shared'
import { LogoMark } from '@/components/logo'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { useStore } from '@/data/store'
import { useNow } from '@/data/use-now'
import { profile } from '@/lib/profile'
import { setTheme, useTheme } from '@/lib/theme'

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/timer', label: 'Timer', icon: Timer },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
] as const

export function AppSidebar() {
  const { pathname } = useLocation()
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <LogoMark className="size-8 shrink-0" />
              <span className="text-lg font-semibold tracking-tight">timedesk</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton isActive={pathname === to} tooltip={label} render={<Link to={to} />}>
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <RunningChip />
        <ProfileMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** Small live readout in the sidebar so a running timer is visible from every page. */
function RunningChip() {
  const { tasks, entries } = useStore()
  const running = entries.find((e) => e.endedAt === null)
  const now = useNow(!!running)
  const { state } = useSidebar()
  if (!running || state === 'collapsed') return null
  const title = running.taskId ? tasks.find((t) => t.id === running.taskId)?.title : null
  return (
    <Link to="/timer" className="bg-live text-live-foreground block rounded-md px-3 py-2">
      <p className="truncate text-xs">{title ?? 'Stopwatch'}</p>
      <p className="text-lg leading-tight font-semibold">{formatDuration(entryDuration(running, now))}</p>
    </Link>
  )
}

function ProfileMenu() {
  const theme = useTheme()
  const { isMobile } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg">{profile.initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{profile.name}</span>
              <span className="text-sidebar-foreground/70 truncate text-xs">{profile.email}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align="end" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{profile.email}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun /> : <Moon />}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <LogOut />
              Sign out (login is not built yet)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
