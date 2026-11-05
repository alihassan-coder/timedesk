# @timedesk/api readme

Hono API for timedesk. Deploys to Vercel as its own project (Root Directory `apps/api`, entry `src/index.ts`).

## Layers (request flows top to bottom)

```
src/
  index.ts          Vercel entry: loads env, builds db + auth, exports the app
  dev.ts            Local server (pnpm dev)
  app.ts            createApp(deps): CORS, health, Better Auth handler, /v1 routes, error handler
  config/env.ts     Validated environment (fails at startup if a secret is missing)
  lib/auth.ts       Better Auth: email + username + password, admin approval, admin emails
  middleware/       requireUser (approved session), requireAdmin
  routes/           URL map only. Each line names a controller.
  controllers/      HTTP in/out: validate, call a service, shape the response
  validators/       zod schemas for every request body, query and param
  services/         Business rules and database access (one file per area)
  lib/models.ts     Builds the AI model from a provider + the user's own key (OpenAI, Anthropic, Gemini, Groq, xAI)
  lib/memory.ts     Assistant memory: mem0 open source SDK on Neon pgvector (OpenAI or Gemini key for embeddings)
  utils/            errors (AppError), validate helpers, crypto (AES-256-GCM)
  types.ts          Deps (db, auth, env) and session types
tests/              Run against the real app on an in-memory Postgres (PGlite) with the real migrations
```

Services throw `AppError` (404, 409, ...); `app.onError` turns it into JSON. Controllers never hold business rules.

## Commands

```
pnpm dev                                  start on http://localhost:3001 (reads .env)
pnpm build                                bundle for Vercel into dist/server.mjs (default export = the Hono app)
pnpm test                                 run the tests (no Neon, no AI keys needed)
MOCK_AI=1 pnpm dev:memory                 in-memory API with a scripted fake model, for browser tests
pnpm --filter @timedesk/db db:generate    new migration after a schema change
pnpm --filter @timedesk/db db:migrate     apply migrations to the Neon database in .env
```

## Environment (copy .env.example to .env)

`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEB_ORIGIN`, `ADMIN_EMAILS` (comma separated), `KEY_ENCRYPTION_SECRET`.

## Endpoints

`/health` · `/api/auth/*` (Better Auth: `sign-up/email`, `sign-in/username`, `sign-out`, `get-session`)
Everything under `/v1` needs an approved account: `GET /me`, `/projects`, `/tasks`, `/time-entries` (+ `/running`, `/start`, `/stop`),
`/chats` (list, get, put, delete: Tempo history in the database), `/settings` (appearance and assistant preferences that follow you across devices), `/ai/keys/:provider` (save/remove/list last4), `/assistant/models`, `/assistant/memories`, `POST /assistant/chat` (streams Tempo, the AI agent, with tools on your data and mem0 memory), and admin only: `/admin/users`, `/admin/users/:id/approve|reject`.
