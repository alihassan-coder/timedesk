import { BrowserRouter, Route, Routes } from 'react-router'
import Layout from '@/layout'
import Dashboard from '@/pages/dashboard'
import ReportsPage from '@/pages/reports'
import TasksPage from '@/pages/tasks'
import TimerPage from '@/pages/timer'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="timer" element={<TimerPage />} />
          <Route path="reports" element={<ReportsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
