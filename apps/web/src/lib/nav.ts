export type NavIcon =
  | 'dashboard'
  | 'tasks'
  | 'projects'
  | 'timesheet'
  | 'reports'
  | 'review'
  | 'apps'
  | 'calendar'
  | 'chat'
  | 'activity'
  | 'settings'

export interface NavItem {
  to: string
  label: string
  icon: NavIcon
  badge?: string
}

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Work',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard' },
      { to: '/tasks', label: 'Tasks', icon: 'tasks' },
      { to: '/projects', label: 'Projects', icon: 'projects' },
      { to: '/timesheet', label: 'Timesheet', icon: 'timesheet' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: 'reports' },
      { to: '/review', label: 'Weekly review', icon: 'review' },
      { to: '/apps', label: 'Apps and sites', icon: 'apps', badge: 'Desktop' },
    ],
  },
  {
    label: 'Team',
    items: [
      { to: '/calendar', label: 'Calendar', icon: 'calendar' },
      { to: '/chat', label: 'Chat', icon: 'chat', badge: '2' },
      { to: '/activity', label: 'Activity', icon: 'activity' },
    ],
  },
]

/** Pages outside the sidebar groups, still needing a title in the header. */
export const extraTitles: Record<string, string> = {
  '/settings': 'Settings',
  '/download': 'Desktop app',
}

export function titleFor(pathname: string): string {
  for (const g of navGroups) {
    const hit = g.items.find((i) => i.to === pathname)
    if (hit) return hit.label
  }
  return extraTitles[pathname] ?? 'timedesk'
}
