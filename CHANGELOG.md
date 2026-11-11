# Changelog

## Unreleased

The backend is unchanged. Update the desktop app to get the Linux fixes.

### Linux (issue #2)
- **No window on some laptops:** on GNOME Wayland with some Intel graphics, the GPU process crashed and the app ran invisibly. Now, when the GPU crashes before the window appears, or no window is ready after 45 seconds, timedesk restarts in safe mode: native Wayland without hardware acceleration. If even that shows nothing, it quits, so clicking the icon can start it again. Safe mode lasts until the next update. `TIMEDESK_X11=1` forces the old way
- **App tracking works in the installed app:** the package no longer ships an empty native file that stopped the tracker from loading. The release build now checks this. The `.deb` recommends `x11-utils` (xprop), which tracking uses
- **A saved login from another keyring** is removed with a clear message, and you sign in again, instead of failing quietly every start. Uses Electron's new async keyring calls (no more deprecation warnings)

### Projects
- Cards in a row line up: the footer always sits at the bottom
- Long descriptions show two lines, with Show more and Show less
- Each card uses its project's colour for the progress bar. While a timer runs on the project, the card shows a ring, a live clock and a Stop button, and it shows how many tasks are open

### Buttons
- Main buttons are glossy pills in your accent colour, and outline buttons are soft raised pills. On hover a soft light passes over the button, it lifts slightly and its icon grows; a press sinks it. No motion if your system asks for less

### Website
- The desktop download links and the sidebar show the current desktop version (they said 0.3.1 after 0.4.0 was out). The version now comes from the desktop app itself

## 0.4.0

Needs the backend update and database migrations `0004_reviews_and_completed` to `0007_top_tasks` (`pnpm --filter @timedesk/db db:migrate`, run before the API goes live). Update the desktop app to get the focus guard, multitasking widget and the Linux icon fix.

### Today's top 3
- Pick the 3 tasks that matter most today: a card at the top of the dashboard with a tick box, Start and Stop for each, and "Pick a task" listing the most pressing ones first. Or click the star on any task
- Tempo knows your top 3: plans put them first, summaries say how many you finished, and you can ask it to set them

### Wrap up the day
- One screen at the end of the day (dashboard button, sidebar, Ctrl+K, and a reminder on the dashboard after 4 pm): stop running timers, fill in the gaps, see what you tracked and finished, move what is left to tomorrow, and pick tomorrow's top 3
- **Fill in the gaps:** the parts of the day no timer covered, with what they probably were: a meeting from your Google Calendar, the apps you used (desktop app tracking), or just "not tracked". The project is guessed from your history (which project you usually track while that app is in front). Pick a project or task and Add, or Skip. Also on the Timesheet for any day of the week
- Time added this way works offline like everything else

### Google Calendar
- "Sync now" no longer fails with "Google Calendar did not answer" on the first sync, or after about three weeks without one (Google only reports changes of the last ~20 days; timedesk now reads its events in full when needed)
- Problems with Google show Google's reason in the server log
- An empty `GOOGLE_REDIRECT_URI=` line in `.env` no longer stops the API from starting
- `scripts/setup-google-calendar.sh` walks you through creating the Google keys

### Linux
- The dock and taskbar show the timedesk logo instead of a generic gear icon. The AppImage adds itself to the app menu

### Works offline
- Fixed: starting a timer, losing the internet and pressing Stop did not stop the timer. Every change (timer start and stop, tasks, projects) now happens on screen at once, is kept on this device, and goes to the server in order when there is a connection. Stop records the moment you pressed it, not when the internet came back
- Changes survive a reload or a restart while offline. The top bar shows "Offline · 2 changes waiting" or "Saving..."; click it to try again
- The app opens without a connection: the web app keeps its files on the device, and both the web and the desktop app remember who is signed in, so an offline start no longer sends you to the sign-in page
- Several windows of the app (the desktop app's floating timer and quick add, two browser tabs) share the same list of waiting changes
- The server accepts the same change twice without doing it twice, so a retry after a dropped connection is always safe. A device clock that is a little off is corrected instead of refused
- Signing out first sends what is waiting (for a few seconds); anything left is kept for that person and sent when they sign in again on this device

### Multitasking
- Track two (or more) tasks at once: the timer menu in the top bar has "Also track" next to "Switch to". Each running timer is listed with its own Stop, plus Stop all
- The time they overlap is shared between them in every total (an hour with two timers counts 30 minutes for each), so your day always adds up to the clock. Reports, timesheet, dashboard, weekly review, the floating timer and Tempo all count it this way
- Tempo can start a timer alongside the running one, says which timers are running, and stops one by name or all of them

### Project colours
- Twelve preset colours instead of five, and any colour you like: a colour picker or a hex code such as #ff6600 (for a client's brand colour). Existing projects keep their colour

### Tempo asks before it acts
- Deleting a task, a project or a calendar event, and adding or changing calendar events, now shows an approval card in the chat: Allow or Don't allow. Nothing happens until you choose
- When a request is unclear (two tasks with similar names), Tempo asks which one you mean with clickable choices instead of guessing
- Failed actions are shown as failed (before, "Deleted a task" could show a tick when nothing was found); errors from the AI provider (wrong key, rate limit, model gone) say what happened, with Try again
- A chat is saved even when you leave it while Tempo is answering. Offline, the chat says it needs a connection

### Stability and speed
- Opens at once from what this device has, instead of waiting for the server to wake up; pages load in the background so the first click is instant; the layout and dashboard no longer redraw every second while a timer runs
- One message bar on every page for errors, with a close button (before, errors only showed on the dashboard and never went away). A page that crashes shows its error in place while the sidebar keeps working
- Many smaller fixes found by a review of the whole app: see the commit for the full list

### Focus guard (desktop)
- Settings, Desktop, **Focus guard**: an on/off switch (off by default), your lists of distracting apps (for example Discord, Steam) and sites (words in the browser tab title, for example YouTube, reddit.com), with one-click suggestions, and how long a distraction may last before the nudge (10 seconds to 2 minutes)
- While a timer runs, the desktop app checks which program is in front every 5 seconds. When a listed app or site stays in front past the delay you get a notification ("Back to Write docs?"), and again every 2 minutes if it goes on. A quick look is counted but not nudged
- The floating timer turns orange and shows "YouTube 0:42 · back to Write docs?" in every style
- Rests during Pomodoro breaks (when the Pomodoro style is chosen); time away from the computer counts as away, not distracted
- Each finished session (a minute or longer) is saved to your account: focused and distracted time, nudges, and which of your listed names took time. Window titles are matched on your computer and never saved or sent
- Dashboard: a **Focus** card with today's and the last 7 days' focus score, interruptions and the biggest distraction, live while a session runs
- Tempo's daily summary and weekly review include your focus score and top distractions
- Included in the JSON export, deleted with the account. API: `POST/GET/DELETE /focus/sessions`, `GET /focus/summary`

### Faster start
- The web app is split per page: the first screen now downloads about 583 KB of JavaScript (198 KB compressed) instead of 1.5 MB (458 KB). Charts, the Tempo chat and the calendar load when you open them. Same for the desktop app's built-in interface
- After a new version is deployed, an open tab that asks for an old page file reloads once instead of showing an error

### Tempo
- **Plan my day**: Tempo orders your open tasks by what needs attention (overdue, due today, started, high priority), fits them around your Google Calendar events and your daily goal, and proposes time blocks from the current time
- **Daily summary**: time tracked by project compared with the day before, tasks finished, what is still due, your daily goal and the apps you used most
- **Weekly review**: the week compared with the one before, best day, days the goal was met, wins, what carries over, and the reflection you wrote, plus your plan from the week before
- One click from the dashboard (the card highlights the one that fits the time of day), from Ctrl+K, and from the Weekly review page
- Tempo now knows your own time zone, so "today" and "tomorrow" are right even late at night. Before, it used the server's clock (UTC)
- The numbers come from exact calculations on your data; the AI only writes them up. Window titles from app tracking are never sent to the AI provider, only app names and totals

### Weekly review
- Pick any week (Monday to Sunday) with the arrows
- Fixed: "Wins" listed every task you had ever finished; it now lists only tasks finished in that week (tasks now remember when they were finished)
- Fixed: "Save review" did not save anything. Your reflection is now stored with your account, per week

### Your data
- Settings, Account: download everything as JSON (projects, tasks, time, reviews, settings, Tempo chats and memories, app activity; no keys or tokens)
- Download tracked time as a CSV for Excel or Google Sheets
- Delete your account and all its data, after typing your username and password

### Other
- The desktop app card in the sidebar showed version 0.1.0; it now shows the current version

## 0.3.1

Fixes for the floating timer. The backend is unchanged, so no backend update is needed.

### Desktop
- Fixed: on Windows the floating timer could be hidden behind other windows (including timedesk itself), because "always on top" was not being applied. It now stays on top
- Changing the floating timer's style keeps its bottom-right corner in place, so it no longer jumps up the screen
- Linux: the floating timer and quick add use the toolbar window type, so taskbars and Alt-Tab lists leave them out
- The floating timer is now tested on a real Linux (Ubuntu with a window manager) on every change, in addition to Windows

## 0.3.0

### Google Calendar (two-way)
- Connect your Google account in Settings -> Calendar. See your events on the Calendar page and in the Tasks day, week and month views, and add, edit or delete events from timedesk
- Tasks with a due date are mirrored to Google as all-day events. Move or rename one in either place and the other follows (drag a task to another day and Google updates; "Sync now" brings in changes made in Google). Finished tasks get a check mark
- Tempo can list, add, change and delete calendar events
- Optional: needs a Google client id and secret on the API (see docs/DEPLOY.md). Without them the feature says it is not set up
- Needs a **database migration** (`pnpm --filter @timedesk/db db:migrate`) and an API redeploy
- Fixed: editing one field of a task or project (for example moving a task's date or completing it) no longer resets its other fields (priority, project, due date, repeat) to their defaults

### Desktop
- **Floating timer:** a small always-on-top window with the running time, the task and a Stop button. Four styles you choose in Settings, Desktop: Compact, Expanded, Bottom bar and Pomodoro. Drag it anywhere; it remembers where. Show it automatically (while a timer runs and timedesk is not in front), always, or never
- The running time is also in the window title, so it shows in the taskbar and Alt-Tab
- **Shortcuts from any program:** Ctrl+Alt+T starts (resumes the last timer) or stops the timer, Ctrl+Alt+N opens Quick add
- **Quick add:** type a task in plain words, for example "Call the printer tomorrow !high #website"
- **Idle check:** after you come back from being away (5 to 30 minutes, your choice), choose to keep the time, remove it, or stop the timer when you left
- Pomodoro: focus and break periods with a notification at each switch
- Needs a new desktop release (the floating timer is part of the app)

### API
- Stopping a timer can name the time it really ended (used by the idle check)

### Web
- **Command palette:** Ctrl+K jumps to any page, starts a timer on a task, stops the timer, or adds a task from plain words
- The running time shows in the browser tab title
- Settings, Timer: daily goal, Pomodoro lengths, and the title switch (saved to your account)

### Web
- Tasks: new **Day, Week and Month** views next to List and Board, with previous/next/Today navigation and a clear date heading. Tasks without a date wait in a tray you can drag onto a day
- Drag and drop: move a task to another day (week and month views) or to another column (board) and it is saved straight away
- Projects: rename, change the description and colour, or delete from the project's menu. Deleting keeps its tasks and tracked time (they become "No project")
- Model picker in the Tempo chat is wide enough to read long model names, opens upward and scrolls
- The default colour mode is now light (an existing saved choice is kept)
- Tempo's answers now render markdown properly: headings, lists, bold, code blocks with a Copy button, tables and links. Raw HTML in an answer is shown as text and never runs
- Reports: a **Custom** range with start and end dates and quick presets (7, 30, 90 days). The chart groups by day, week or month depending on the length, and a wrong range explains itself
- Apps and sites: choose Today, 7 days, 30 days or a custom range; search by app or window title; filter by app; page through sessions (10, 25 or 50 rows); delete a single session

### API
- New: `GET /activity/sessions` (paged, searchable, filterable by app and dates) and `DELETE /activity/:id`. Needs a redeploy

### Tempo AI
- Can build a time report for any date range ("last week", "1 to 15 October")
- New tools: rename or re-describe a project, and delete a project
- Text-to-speech models no longer appear in the Groq chat model list

## 0.2.0

The desktop app now carries its own copy of the interface.

### Desktop
- The installer contains the web interface (built from the same `apps/web` source, no duplicated code) and opens it from inside the app. It no longer needs the website to be live to open
- Sign-in uses a token instead of a cookie, so it works from the app and keeps working wherever the backend lives. The token is kept encrypted by Windows or the Linux keyring, never in page storage
- Strict security policy on the bundled interface: it can only load its own files and talk to its own backend; inline and remote scripts are blocked
- Opening an old v0.1.0 install updates it to this version automatically

### API
- Token sign-in alongside cookie sign-in, and the desktop app is a second trusted origin
- Needs a redeploy of the API

### Release
- The release now needs the repository variable `TIMEDESK_API_URL` (the backend address). `TIMEDESK_WEB_URL` is no longer needed

## 0.1.0

First complete version: web app, API and Windows/Linux desktop app.

### Web
- Sign up, sign in by username or email, admin approval of new accounts, Team members page
- Projects, tasks (status, priority, due date, recurrence), list and board views, due-date groups
- Top-bar timer, stopwatch, weekly timesheet, reports by day, month, quarter and year, weekly review, dashboard charts
- Appearance settings: light, dark or system, six accent colours, radius, font, text size, sidebar style (saved to your account)
- Notifications settings and due-date reminders (browser notifications with permission)
- Apps and sites page (data from the desktop app)
- Error screen instead of a blank page, and a proper "page not found"

### Tempo AI
- Streaming assistant that works on your data through tools: tasks, projects, timer, reports
- Bring your own key: OpenAI, Anthropic, Gemini, Groq, xAI Grok. Keys encrypted on the server
- Long-term memory with mem0 on Neon pgvector (OpenAI or Gemini embeddings)
- Voice mode: dictation and spoken replies
- Chat history in the database with a local cache

### API
- Hono + Better Auth + Drizzle + AI SDK 7 on Neon Postgres
- Layered: routes, controllers, services, validators
- Security headers, request size limit, strict CORS, encrypted keys, per-user data isolation
- Activity tracking endpoints, chats, settings

### Desktop (Windows and Linux)
- System tray with the running timer, native notifications, start with the computer
- Optional app tracking (off by default, private to the owner), idle-aware
- Auto-update from GitHub Releases with a restart banner
- "Can't reach timedesk" retry page
- Windows installer; Linux AppImage and .deb built by GitHub Actions
- Optional Windows code signing (Azure Artifact Signing or a .pfx certificate), see docs/SIGNING.md

### Known limits
- No offline mode yet (needs the sync engine)
- No password reset by email, no two-factor sign-in
- Windows installer is unsigned until a certificate is added
- Voice dictation is not available inside the desktop app
- App tracking on Linux Wayland may record nothing
