import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { ErrorBoundary } from '@/components/error-boundary'
import { PublicOnly, RequireAuth } from '@/components/require-auth'
import Layout from '@/layout'
import LoginPage from '@/pages/auth/login'
import RegisterPage from '@/pages/auth/register'

// Each page is its own file, loaded the first time it is opened. The first screen then only downloads what it
// needs: charts, the Tempo chat (AI SDK and markdown) and the calendar come later, when someone goes there.
const ActivityPage = lazy(() => import('@/pages/activity'))
const AdminPage = lazy(() => import('@/pages/admin'))
const AppsPage = lazy(() => import('@/pages/apps'))
const AssistantPage = lazy(() => import('@/pages/assistant'))
const CalendarPage = lazy(() => import('@/pages/calendar'))
const Dashboard = lazy(() => import('@/pages/dashboard'))
const DownloadPage = lazy(() => import('@/pages/download'))
const NotFoundPage = lazy(() => import('@/pages/not-found'))
const QuickAddPage = lazy(() => import('@/pages/quick-add'))
const ProjectsPage = lazy(() => import('@/pages/projects'))
const ReportsPage = lazy(() => import('@/pages/reports'))
const ReviewPage = lazy(() => import('@/pages/review'))
const SettingsPage = lazy(() => import('@/pages/settings'))
const TasksPage = lazy(() => import('@/pages/tasks'))
const TimesheetPage = lazy(() => import('@/pages/timesheet'))
const WidgetPage = lazy(() => import('@/pages/widget'))

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        {/* The small desktop windows have no sidebar; a blank frame while their page loads is right for them. */}
        <Suspense fallback={null}>
          <Routes>
            <Route element={<PublicOnly />}>
              <Route path="login" element={<LoginPage />} />
              <Route path="register" element={<RegisterPage />} />
            </Route>
            <Route element={<RequireAuth />}>
              {/* Small windows of the desktop app: the floating timer and quick add. No sidebar. */}
              <Route path="widget" element={<WidgetPage />} />
              <Route path="quick-add" element={<QuickAddPage />} />
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="tasks" element={<TasksPage />} />
                <Route path="projects" element={<ProjectsPage />} />
                <Route path="timesheet" element={<TimesheetPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="review" element={<ReviewPage />} />
                <Route path="apps" element={<AppsPage />} />
                <Route path="calendar" element={<CalendarPage />} />
                <Route path="assistant" element={<AssistantPage />} />
                <Route path="activity" element={<ActivityPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="download" element={<DownloadPage />} />
                <Route path="admin" element={<AdminPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
