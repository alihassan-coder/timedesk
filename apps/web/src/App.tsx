import { BrowserRouter, Route, Routes } from 'react-router'
import { PublicOnly, RequireAuth } from '@/components/require-auth'
import Layout from '@/layout'
import ActivityPage from '@/pages/activity'
import AdminPage from '@/pages/admin'
import AppsPage from '@/pages/apps'
import AssistantPage from '@/pages/assistant'
import LoginPage from '@/pages/auth/login'
import RegisterPage from '@/pages/auth/register'
import CalendarPage from '@/pages/calendar'
import Dashboard from '@/pages/dashboard'
import DownloadPage from '@/pages/download'
import ProjectsPage from '@/pages/projects'
import ReportsPage from '@/pages/reports'
import ReviewPage from '@/pages/review'
import SettingsPage from '@/pages/settings'
import TasksPage from '@/pages/tasks'
import TimesheetPage from '@/pages/timesheet'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicOnly />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
        </Route>
        <Route element={<RequireAuth />}>
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
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
