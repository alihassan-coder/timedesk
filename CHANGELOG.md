# Changelog

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
