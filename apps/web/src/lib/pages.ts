/**
 * Every page's code, loaded on demand (App.tsx). The same loaders are used to fetch the pages in the background once
 * the app has started, so the first click on a page does not wait for the network.
 */
export const pages = {
  activity: () => import('@/pages/activity'),
  admin: () => import('@/pages/admin'),
  apps: () => import('@/pages/apps'),
  assistant: () => import('@/pages/assistant'),
  calendar: () => import('@/pages/calendar'),
  dashboard: () => import('@/pages/dashboard'),
  download: () => import('@/pages/download'),
  notFound: () => import('@/pages/not-found'),
  quickAdd: () => import('@/pages/quick-add'),
  projects: () => import('@/pages/projects'),
  reports: () => import('@/pages/reports'),
  review: () => import('@/pages/review'),
  settings: () => import('@/pages/settings'),
  tasks: () => import('@/pages/tasks'),
  timesheet: () => import('@/pages/timesheet'),
  widget: () => import('@/pages/widget'),
}

let prefetched = false
/** Loads the pages people use most while the browser is idle, a few at a time. Safe to call more than once. */
export function prefetchPages() {
  if (prefetched) return
  prefetched = true
  const order: (keyof typeof pages)[] = ['dashboard', 'tasks', 'timesheet', 'projects', 'reports', 'review', 'calendar', 'settings', 'assistant', 'apps']
  const idle = (cb: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 1500))
  const next = () => {
    const name = order.shift()
    if (!name) return
    void pages[name]()
      .catch(() => undefined) // offline: it loads when opened
      .finally(() => idle(next))
  }
  idle(next)
}
