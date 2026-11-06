# timedesk: product

A TimeCamp-style work platform for one person and a team of 3-5: time tracking, projects, todos, insights, calendar, chat. One UI everywhere. The web app has every feature that works in a browser; features that need the OS show the same screen with a "Get the desktop app" prompt.

## Features by area
| Area | Features | Where it works |
|---|---|---|
| Plan | Projects; tasks with status (todo / in progress / done), priority, due date, recurrence (daily/weekly/monthly/custom); due categories (overdue, today, tomorrow, this week, later, no date); list, board, day, week and month views with drag and drop; edit and delete projects | Web |
| Track | Top-bar timer, stopwatch, weekly timesheet | Web |
| Auto-track | Which apps and sites you use, live | **Desktop only** (Chrome extension for sites later) |
| Insights | Dashboard with graphs, reports (day/month/quarter/year), weekly review, activity feed | Web |
| Collaborate | Comments on tasks/projects first, then full chat with channels | Web |
| Connect | Google Calendar (events on your day, meetings count as time), Outlook later | Web |
| Notify | Task reminders, new-version alerts | Desktop native, web push, Chrome extension, mobile push |
| Team | Admin approves each sign-up; admin sees team time; no plans or billing | Web |
| Look | Stock shadcn, light + dark | All |

## Decisions
- **Tracking privacy:** window titles and app names are visible only to their owner. Teammates and admins see totals per category only if the owner shares them.
- **Linux:** `.deb` installer (Ubuntu/Debian) first; AppImage auto-updates. App tracking works on X11, limited on Wayland. Windows is the main target.
- **Auto-update:** Electron checks GitHub Releases and shows "new version ready, restart". Windows needs a code-signing certificate to avoid SmartScreen warnings.
- **Chat** is the last phase. Task/project comments cover most of the need earlier.
- **Mobile** cannot track other apps; it gets timer, tasks, push notifications.

## Phases
1. Web design with dummy data (review) -> real local data
2. API, Neon, Drizzle, Better Auth + admin approval, sync
3. Desktop (Electron): app tracking, notifications, auto-update, .exe and .deb
4. Insights complete: productivity dashboard, weekly review, activity feed from real data
5. Google Calendar + Chrome extension
6. Mobile (Capacitor) + push
7. Full chat
