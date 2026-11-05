import { BrowserRouter, Route, Routes } from 'react-router'
import Layout from '@/layout'
import ActivityPage from '@/pages/activity'
import AppsPage from '@/pages/apps'
import CalendarPage from '@/pages/calendar'
import ChatPage from '@/pages/chat'
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
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="timesheet" element={<TimesheetPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="apps" element={<AppsPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="download" element={<DownloadPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
