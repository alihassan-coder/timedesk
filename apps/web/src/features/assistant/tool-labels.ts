/** What each server-side tool is called in the UI. The tools themselves live in apps/api. */
export const TOOL_LABELS: Record<string, string> = {
  list_tasks: 'Looked up tasks',
  create_task: 'Created a task',
  set_task_status: 'Changed a task status',
  update_task: 'Edited a task',
  delete_task: 'Deleted a task',
  list_projects: 'Looked up projects',
  create_project: 'Created a project',
  start_timer: 'Started the timer',
  stop_timer: 'Stopped the timer',
  timer_status: 'Checked the timer',
  time_report: 'Built a time report',
}
