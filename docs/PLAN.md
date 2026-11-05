# timedesk: plan

Time tracking + todos for a team of 3-5. One React codebase for web, desktop (Electron, Windows + Linux) and mobile (Capacitor, later). Offline-first, syncs when online.

## Decisions
| Area | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| UI | Vite + React 19 + Tailwind v4 + shadcn/ui (`apps/web`) |
| Desktop / mobile | Electron / Capacitor shells that load the web UI (no UI code of their own) |
| API | Node + Hono on Vercel Functions (`apps/api`), separate Vercel project from web |
| Database | Neon Postgres, Drizzle ORM, drizzle-kit migrations (Alembic is Python-only) |
| Auth | Better Auth: email + username + password, admin must approve each new account |
| Offline sync | PowerSync (see `docs/research/sync-engine.md`); fallback: outbox queue + REST |
| Hosting | Two Vercel projects: Root Directory `apps/web` and `apps/api` |

## Phases
1. **Web UI, local only** (done): tasks, stopwatch/timers, reports (day/month/quarter/year) on localStorage.
2. **API + database**: `packages/db` schema + migrations, Hono app, deploy both to Vercel.
3. **Auth**: register -> pending -> admin approves -> can sign in. Admin screen.
4. **Sync spike**: tasks table only, PowerSync, test with network off (browser + Electron). Go/no-go vs fallback.
5. **Sync everything**: tasks, time entries, running timer rule (one per user).
6. **Desktop**: Electron shell, tray, notifications, installers.
7. **Reports at scale**: daily roll-up table behind monthly/quarterly/yearly.
8. **Mobile**: Capacitor.

## Rules
- Every synced table: client-generated UUIDv7 `id`, `workspace_id`, `user_id`, `updated_at`, `deleted_at` (soft delete).
- A time entry stores `started_at` and nullable `ended_at`; at most one running entry per user.
- UI talks to data only through `apps/web/src/data/` so the storage layer can be swapped.
- Shared types and time/report logic live in `packages/shared`.

## Open items
- Domain / subdomains (owner is creating them): `app.` for web, `api.` for the API.
- Neon project + `DATABASE_URL` (owner creates; goes in `apps/api/.env`, never committed).
