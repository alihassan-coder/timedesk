import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { ErrorBoundary } from '@/components/error-boundary'
import { PublicOnly, RequireAuth } from '@/components/require-auth'
import Layout from '@/layout'
import { pages } from '@/lib/pages'
import LoginPage from '@/pages/auth/login'
import RegisterPage from '@/pages/auth/register'

// Each page is its own file, loaded the first time it is opened. The first screen then only downloads what it
// needs: charts, the Tempo chat (AI SDK and markdown) and the calendar come later, when someone goes there.
const ActivityPage = lazy(pages.activity)
const AdminPage = lazy(pages.admin)
const AppsPage = lazy(pages.apps)
const AssistantPage = lazy(pages.assistant)
const CalendarPage = lazy(pages.calendar)
const Dashboard = lazy(pages.dashboard)
const DownloadPage = lazy(pages.download)
const NotFoundPage = lazy(pages.notFound)
const QuickAddPage = lazy(pages.quickAdd)
const ProjectsPage = lazy(pages.projects)
const ReportsPage = lazy(pages.reports)
const ReviewPage = lazy(pages.review)
const SettingsPage = lazy(pages.settings)
const TasksPage = lazy(pages.tasks)
const TimesheetPage = lazy(pages.timesheet)
const WidgetPage = lazy(pages.widget)
const WrapUpPage = lazy(pages.wrapUp)

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
                <Route path="wrap-up" element={<WrapUpPage />} />
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
