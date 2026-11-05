# Sync engine research for timedesk (as of 2026-11-05)

Scope: offline-first sync for TS/React on web + Electron (Win/Linux) + later Capacitor, backend Postgres on Neon,
Node API (Hono/Fastify), Better Auth, Drizzle, pnpm+Turborepo. Team of 3-5. No code written.
Confidence tags: [V] verified on an official page this session, [U] unverified / from memory or secondary source.

## Comparison

| | Neon (logical repl.) | Extra service to host | Free / cost | Platforms | Conflicts | Drizzle | Maturity / license |
|---|---|---|---|---|---|---|---|
| **PowerSync** | Yes, Neon explicitly listed [V]. Enable logical replication (irreversible), role with REPLICATION+BYPASSRLS, publication `powersync`. Caveat: while connected, Neon compute never scales to zero [V] | PowerSync Service (Cloud, or self-host Docker with its own storage DB) | Cloud Free: 2 GB synced/mo, 500 MB hosted, 50 peak clients, inactive projects paused after 1 week [V]. Pro from $49/mo [V]. Open Edition self-host free | Web SDK (renderer, WASM SQLite), Node SDK (Electron main, native SQLite), Capacitor SDK **beta**, RN, Tauri alpha [V] | Server-authoritative; client write queue (PUT/PATCH/DELETE) uploaded via YOUR `uploadData()` to your API; you implement merge rules there [V] | `@powersync/drizzle-driver` for client queries; only text/integer/real columns, most constraints unsupported [V]. Server side keeps full Drizzle | Mature commercial vendor, active. Service repo shows Apache-2.0 [V] |
| **ElectricSQL** (Electric 1.x, now electric.ax) | Yes, Neon listed; needs direct (non-pooled) connection, REPLICATION role, PG 14+ [V] | Electric server (Docker) or Electric Cloud | Cloud PAYG $0 base, $1/M writes (+$2/M for Postgres Sync), $0.10/GB-mo; bills under $5/mo waived; reads free [V] | Read-path only over HTTP "shapes"; no local DB of its own. Needs TanStack DB / PGlite / own store on client | Reads only. Writes go through YOUR API; optimistic state via TanStack DB with txid matching [V]. No built-in offline-write story | Server side fine. No client DB layer | Apache-2.0 [U]. Recently moved domain/rebranded; paid pricing only went live Apr 2026 [V via search]. Pivot risk |
| **RxDB** | No native logical-replication path. Generic replication protocol against your own HTTP endpoints (pull/push, `_deleted` flag); Supabase plugin is PostgREST-based [V]. You write the endpoints | None required (your Hono API is the sync server) | Core Apache-2.0 free. Production SQLite/OPFS/IndexedDB storages are **Premium**: from $99/mo billed annually [V] | Browser, Electron, Capacitor, RN [V] | Revision-based, custom conflict handler per collection (good) | None official | Mature, small team [U]; paid plugins are lock-in |
| **Zero (Rocicorp)** | Supported; must enable logical replication; keeps Neon awake [V]. PG 15+ | zero-cache server (self-host) required | Self-host; no hosted tier found [U] | Web-first | **No offline writes** (rejected when disconnected), "not a priority" [V] | Community `drizzle-zero` [U] | Apache-2.0 [V]; repo is a mirror, PRs ported internally [V]. Disqualified by offline requirement |
| **Dexie Cloud** | Not applicable. Runs its own Node+Postgres backend; your Neon DB is not the source of truth [V] | Dexie Cloud SaaS or paid on-prem | Free: 3 prod users, 100 MB [V]; paid from 3 EUR/mo per 25 seats [V] | Browser, Electron, Capacitor, Tauri [V] | Per-property merge; Y.js CRDT for rich text [V] | None (IndexedDB) | Dexie.js open source [U]; Cloud is closed SaaS. Data not in Neon, so no SQL reporting or Drizzle migrations |
| **TanStack DB** | Not a sync engine: reactive client store with adapters (Electric, PowerSync, RxDB, Query/REST, TrailBase) [V] | None itself | Free [U] | Web; SQLite persistence packages emerging (incl. Tauri) | Optimistic mutations + offline transactions that retain/retry pending mutations [V]; conflict policy is yours | None | **Core still 1.0.0-rc.1.x** in Nov 2026 [V]. Electric+offline persistence has documented coverage limits [V] |
| **Outbox + REST** | Trivial: plain Neon, no replication, no always-on compute | None | $0 | Anything (wa-sqlite / better-sqlite3 / Capacitor SQLite, or Dexie) | Whatever you build (LWW via `updated_at`/hybrid clock) | Full Drizzle on server; shared types on client | You own all bugs: tombstones, cursors, clock skew, partial failures, client schema migrations |

## Key findings per candidate

- **PowerSync**: best fit for "SQLite on client, Postgres source of truth, bring-your-own API for writes." Auth is JWT verified via a JWKS URI or static keys, token needs `kid` and matching audience [V]; this should match Better Auth's JWT plugin JWKS endpoint (compatibility [U], must be spiked). Per-user filtering via sync rules keyed on `workspace_id`/`user_id` fits the planned sharing model. Writes go through your Hono endpoint, so Better Auth admin-approval checks and Drizzle validation stay in one place. Gotcha: returning 4xx without `complete()` blocks the upload queue forever; return 2xx with error info for validation failures [V].
- **Electric**: excellent read sync, but you assemble the rest (client DB, mutation queue, offline). More parts than PowerSync for the same result. Reasonable later if you want a TanStack DB UI.
- **RxDB**: viable only if you accept ~$1.2k/yr for production storage and writing both replication endpoints yourself.
- **Zero**: fails the offline-first requirement outright.
- **Dexie Cloud**: pleasant and cheap, but data lives in their backend, not Neon; conflicts with the "Postgres on Neon + Drizzle migrations" requirement.
- **TanStack DB**: promising UI layer; can sit on top of PowerSync later. Do not make an RC the foundation.

## Neon cost caveat (PowerSync, Electric, Zero)

Log-based engines hold a replication connection, so Neon compute will not autosuspend [V for PowerSync and Zero docs]. Budget an always-on small compute (check current Neon pricing) and enable logical replication on the production branch only (irreversible, restarts compute). Use a direct (unpooled) connection string for the replication role. Outbox+REST avoids this cost entirely.

## Recommendation: PowerSync (Cloud Free tier first) + Neon + your Hono API for writes

Why: it is the only candidate that gives a real local SQLite DB, offline writes with a durable upload queue, Postgres as truth on Neon, JWT auth you control, and Web/Electron/Capacitor SDKs, with a free tier that comfortably covers 3-5 users (50 clients, 2 GB/mo). You write a small connector plus one upload endpoint instead of a sync protocol. Escape hatch: self-host the Apache-2.0 service on a VPS later; data stays in plain Postgres, so lock-in is low.

Fallback if the always-on Neon cost or Capacitor beta is unacceptable: outbox + REST with last-write-wins on `updated_at` (viable at this scale since data is per-user and conflicts are rare), built thin with tombstones from day one.

## Main risks

1. Capacitor SDK is beta; mobile is "later," so re-check status before starting it.
2. Electron choice: web SDK in renderer (WASM SQLite, slower, shares code with web) vs Node SDK in main (native speed, needs IPC) [V via blog/examples]. Start with the web SDK; spike both.
3. Client-side Drizzle is limited (3 column types, no constraints). Use PowerSync's schema on the client, share types, keep drizzle-kit migrations server-only. Booleans/dates/JSON become text/integer on the client.
4. Neon never scales to zero while PowerSync is attached; enabling logical replication is irreversible.
5. Better Auth + PowerSync JWT is unverified: needs JWT plugin with `kid`, audience config, short-lived tokens, and token refresh that tolerates being offline (app must keep working, re-auth on reconnect). The admin-approval gate must also block token issuance for unapproved users.
6. Free-tier projects pause after 1 week of inactivity; bad for a dormant staging env.
7. Conflict semantics are hand-written in the upload handler. Timers are the hazard: model a running timer as a time entry with `started_at` and nullable `ended_at` (derive duration), never a counter; enforce one running entry per user server-side to resolve two devices both starting timers.
8. Vendor dependence on PowerSync Inc.; mitigated by self-hosting. Confirm the service license (repo page showed Apache-2.0) before committing.

## Minimal architecture sketch

```
apps/web, apps/desktop (Electron renderer), apps/mobile (Capacitor, later)
   all import packages/ui + packages/data (React hooks, PowerSync schema, repositories)

PowerSync client SDK (local SQLite), app always reads/writes locally
  (a) down: PowerSync Service (Cloud) <-- logical replication -- Neon Postgres
  (b) up:   upload queue -> POST /sync/upload (Bearer Better Auth JWT)

apps/api (Hono; Vercel or small VPS)
  - Better Auth: username+password, admin approval, JWT plugin + JWKS endpoint
  - /sync/upload: zod-validate, check user approved + workspace membership,
    apply PUT/PATCH/DELETE with Drizzle, per-field LWW, soft delete via deleted_at
  - PowerSync JWT: sub=user_id, workspace ids as claim

packages/db: Drizzle schema + drizzle-kit migrations (Neon direct URL for migrate)
PowerSync sync rules: each table filtered by workspace_id IN (user's workspaces)
Every table: client-generated UUIDv7 id, workspace_id, user_id, updated_at, deleted_at
```
These schema rules keep any engine swappable (no serial ids, soft deletes, workspace_id everywhere).

Suggested first step: 1-2 day spike with Neon + PowerSync Cloud free + Hono upload endpoint + Better Auth JWKS, tasks table only, tested in browser and Electron renderer with the network off.

## Sources

- PowerSync DB setup (Neon): https://docs.powersync.com/installation/database-setup
- PowerSync pricing: https://www.powersync.com/pricing
- PowerSync client SDKs: https://docs.powersync.com/client-sdks/overview ; Electron example: https://github.com/powersync-ja/powersync-js/blob/main/demos/example-electron/README.md
- PowerSync writes/conflicts: https://docs.powersync.com/handling-writes/writing-client-changes
- PowerSync Drizzle: https://docs.powersync.com/client-sdks/orms/js/drizzle
- PowerSync auth: https://docs.powersync.com/configuration/auth/custom
- PowerSync service repo: https://github.com/powersync-ja/powersync-service (LICENSE: Apache-2.0)
- Electric deployment: https://electric.ax/docs/guides/deployment ; pricing: https://electric.ax/pricing.md ; blog: https://electric.ax/blog/2026/04/02/electric-cloud-pricing
- TanStack DB: https://tanstack.com/db/latest/docs/overview ; Electric collection: https://tanstack.com/db/latest/docs/collections/electric-collection ; releases: https://github.com/TanStack/db/releases
- Zero: https://zero.rocicorp.dev/docs/connecting-to-postgres ; https://zero.rocicorp.dev/docs/offline ; https://github.com/rocicorp/mono
- RxDB: https://rxdb.info/rx-storage-sqlite.html ; https://rxdb.info/premium/ ; https://rxdb.info/replication-supabase.html
- Dexie Cloud: https://dexie.org/cloud/
