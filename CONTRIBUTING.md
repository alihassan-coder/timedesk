# Contributing to timedesk

Thanks for helping. This guide covers how the code is organised, the rules every change follows, and how to check your work.

## Getting started

1. Install **Node 22+** and **pnpm 12** (`corepack enable`).
2. `pnpm install`
3. Run everything without a real database:
   ```bash
   MOCK_AI=1 pnpm --filter @timedesk/api dev:memory   # API on :3001, throwaway in-memory database, scripted AI
   pnpm --filter @timedesk/web dev                     # web on :5173
   ```
   Register with `admin@local.test`: that account is approved and admin at once.
4. For a real database and real AI keys, follow [README.md](README.md#run-it-on-your-computer).

## Branches and releases

- Work happens on **`develop`**. Open pull requests against `develop`.
- **`main`** is the released, stable version. Pushing to `main` deploys the API and web app, so only tested work is merged there.
- Desktop releases are tagged from `main` only (see [docs/DEPLOY.md](docs/DEPLOY.md)).

## How the code is organised

| Where | What goes there |
|---|---|
| `packages/shared` | Pure logic used everywhere: dates and time, reports, offline operations, splitting time between parallel timers, Focus guard rules, the desktop bridge contract. No I/O, so it is easy to test |
| `packages/db` | Drizzle schema and SQL migrations. Change the schema, then `pnpm --filter @timedesk/db db:generate` |
| `apps/api` | Hono API: `routes` (URLs only) → `controllers` (HTTP in and out) → `services` (rules) → `validators` (zod). Every query is scoped to the signed-in user |
| `apps/web` | The only UI, for the browser and the desktop app. Screens read and write data only through `src/data/store.ts` (offline first: changes go through the outbox) |
| `apps/desktop` | Electron shell. Small pure modules (`tracker.ts`, `focus.ts`, `widgets.ts`) hold the logic so it can be tested without Electron |

## Rules for changes

- **Offline first.** A change the person makes must show at once and must never be lost. Add it as an operation in `packages/shared/src/offline.ts` (with `applyOp` and `opRequest`), and make the API endpoint safe to call twice.
- **Totals match the clock.** Anything that adds up time uses `tracked` from the store (or `splitParallel`), so overlapping timers are not counted twice.
- **Privacy.** Every database query filters by the signed-in user. Add a test that another user cannot reach the data.
- **Secrets stay out of git.** Never commit `.env` files, real URLs, emails or keys. Use `.env.example` with empty values.
- **Tempo actions that cannot be undone** (deleting, changing the calendar) go through `toolApproval` so the person approves them.
- **Plain words in the UI.** Short sentences, no jargon, explain what happened and what to do next.

## Checking your work

```bash
pnpm typecheck                        # all packages
pnpm test                             # unit and integration tests (in-memory Postgres, no keys needed)
pnpm --filter @timedesk/web lint
```

Browser and desktop end-to-end tests live in `apps/web/e2e/` and `apps/desktop/e2e/`. Each file says at the top how to run it. They refuse to run against anything but the in-memory API, so they can never touch a real database.

Add tests with your change: pure logic in `packages/shared/tests`, API behaviour in `apps/api/tests` (through the real HTTP interface), desktop logic in `apps/desktop/tests`, and a browser flow for anything a person clicks through.

## Screenshots in the README

`apps/web/e2e/capture-readme.mjs` makes the pictures in `docs/media` from made-up demo data in a headless browser. Re-run it after visible changes.

## Reporting a security problem

Please do not open a public issue. See [SECURITY.md](SECURITY.md).
