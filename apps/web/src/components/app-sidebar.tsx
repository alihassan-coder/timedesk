import { Link, useLocation, useNavigate } from 'react-router'
import {
  Activity,
  BarChart3,
  CalendarDays,
  CalendarCheck,
  ChevronsUpDown,
  Download,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Table2,
} from 'lucide-react'
import { LogoMark, Wordmark } from '@/components/logo'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { resetStore } from '@/data/store'
import { navGroupsFor } from '@/lib/nav'
import { authClient, useProfile } from '@/lib/auth-client'
import { toggleMode, useAppearance } from '@/lib/appearance'

const ICONS = {
  dashboard: LayoutDashboard,
  tasks: ListChecks,
  projects: FolderKanban,
  timesheet: Table2,
  reports: BarChart3,
  review: CalendarCheck,
  apps: Monitor,
  calendar: CalendarDays,
  assistant: Sparkles,
  activity: Activity,
  settings: Settings,
  admin: ShieldCheck,
}

export function AppSidebar() {
  const { pathname } = useLocation()
  const a = useAppearance()
  const { user } = useProfile()
  return (
    <Sidebar collapsible={a.sidebarCollapse} variant={a.sidebarVariant}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <LogoMark className="shrink-0" />
              <div className="grid flex-1 text-left leading-tight">
                <Wordmark className="truncate" />
                <span className="text-muted-foreground truncate text-xs">Team of 4</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {navGroupsFor(!!user?.isAdmin).map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon]
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton isActive={pathname === item.to} tooltip={item.label} render={<Link to={item.to} />}>
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {item.badge && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <GetAppCard />
        <ProfileMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function GetAppCard() {
  const { state } = useSidebar()
  if (state === 'collapsed') return null
  return (
    <div className="bg-sidebar-accent/60 space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Download className="size-4" />
        <p className="text-sm font-medium">Desktop app</p>
        <Badge variant="secondary" className="ml-auto">v0.1.0</Badge>
      </div>
      <p className="text-muted-foreground text-xs">Track apps and sites automatically and get native reminders.</p>
      <Button size="sm" className="w-full" render={<Link to="/download" />}>
        Download
      </Button>
    </div>
  )
}

function ProfileMenu() {
  const a = useAppearance()
  const { user } = useProfile()
  const navigate = useNavigate()
  const { isMobile } = useSidebar()
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg">{user?.initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user?.name}</span>
              <span className="text-muted-foreground truncate text-xs">{user?.email}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align="end" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/settings" />}>
              <Settings /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleMode} data-mode={a.mode}>
              {dark ? <Sun /> : <Moon />}
              {dark ? 'Light mode' : 'Dark mode'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={async () => { await authClient.signOut(); resetStore(); navigate('/login', { replace: true }) }}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
