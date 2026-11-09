/** What each server-side tool is called in the UI once it ran. The tools themselves live in apps/api. */
export const TOOL_LABELS: Record<string, string> = {
  list_tasks: 'Looked up tasks',
  create_task: 'Created a task',
  set_task_status: 'Changed a task status',
  update_task: 'Edited a task',
  delete_task: 'Deleted a task',
  list_projects: 'Looked up projects',
  create_project: 'Created a project',
  update_project: 'Edited a project',
  delete_project: 'Deleted a project',
  list_calendar_events: 'Looked up your calendar',
  create_calendar_event: 'Added a calendar event',
  update_calendar_event: 'Changed a calendar event',
  delete_calendar_event: 'Deleted a calendar event',
  start_timer: 'Started the timer',
  stop_timer: 'Stopped the timer',
  timer_status: 'Checked the timer',
  time_report: 'Built a time report',
  daily_summary: 'Read your day',
  weekly_review: 'Read your week',
  plan_day: 'Looked at your tasks and calendar',
  ask_user: 'Asked you',
}

/** The same, while it is still running or waiting. */
export const TOOL_PENDING: Record<string, string> = {
  delete_task: 'Delete a task',
  delete_project: 'Delete a project',
  delete_calendar_event: 'Delete a calendar event',
  create_calendar_event: 'Add a calendar event',
  update_calendar_event: 'Change a calendar event',
}
