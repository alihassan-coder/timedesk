# Deploying timedesk

Three things get deployed from this repo: the **API**, the **web app** (two separate Vercel projects), and the **desktop installers** (GitHub Actions). The database is the Neon project you already have.

## 1. API (Vercel project "timedesk-api")

1. Vercel -> Add New Project -> import `alihassan-coder/timedesk`.
2. **Root Directory:** `apps/api`. Turn on **Include source files outside of the Root Directory** (the API uses `packages/db` and `packages/shared`).
3. Framework: Other (Hono is detected). Node.js 22. No build command is needed. The entry is `src/index.ts`, which default-exports the app.
4. **Environment variables** (Production, and Preview if you use it):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled connection string (the same one in `apps/api/.env`) |
| `BETTER_AUTH_SECRET` | 32+ random characters. Make a new one for production |
| `BETTER_AUTH_URL` | The public address of this API, for example `https://api.example.com` |
| `WEB_ORIGIN` | The public address of the web app, for example `https://app.example.com` (no trailing slash) |
| `ADMIN_EMAILS` | `alihassan.4dev@gmail.com,alihassan.coder@gmail.com` |
| `KEY_ENCRYPTION_SECRET` | 32+ random characters. **Never change it after people save AI keys**, or the saved keys become unreadable |
| `CROSS_SITE_COOKIES` | Leave empty with a custom domain (see below) |

5. Check: open `https://<api>/health`. It must answer `{"ok":true}`.

Generate secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 2. Web app (Vercel project "timedesk-web")

1. Import the same repo again as a second project.
2. **Root Directory:** `apps/web`. Include source files outside the root: on (it uses `packages/shared`).
3. Environment variable: `VITE_API_URL` = the API address from step 1.
4. `apps/web/vercel.json` already sends every path to `index.html`, so page refreshes work.

## 3. The login cookie: use one domain (important)

Sign-in uses a cookie. Browsers only send it when the web app and the API are on the **same site**.

- **Works:** `app.example.com` (web) and `api.example.com` (API). Same site, different subdomains. Set `WEB_ORIGIN` and `BETTER_AUTH_URL` to those.
- **Does not work by default:** two separate `*.vercel.app` addresses. `vercel.app` counts as a public suffix, so they are different sites, and login silently fails.
  - Quick workaround: set `CROSS_SITE_COOKIES=true` on the API. It sends the cookie as `SameSite=None; Secure`. Safari and some privacy settings still block that, so move to subdomains of one domain for real use.

## 4. Database

The migrations are already applied to your Neon database. For a new database, run once from your computer with its `DATABASE_URL` in `apps/api/.env`:

```
pnpm --filter @timedesk/db db:migrate
```

Tempo's memory (mem0) needs the `vector` extension. If memory errors, run in the Neon SQL editor: `CREATE EXTENSION IF NOT EXISTS vector;`

## 5. First run

1. Open the web app and register with one of the two admin emails. It is approved on the spot.
2. Settings -> AI assistant: add at least one provider key. Add an OpenAI or Gemini key to switch on memory.
3. Share the address with your team. They register, then you approve them under Team members.

## 6. Desktop installers

1. In the GitHub repo: Settings -> Secrets and variables -> Actions -> **Variables** -> add `TIMEDESK_WEB_URL` = your web address.
2. Set `version` in `apps/desktop/package.json` (for example `0.1.0`), commit, then:

```
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

3. GitHub Actions builds the Windows installer, the Linux AppImage and the `.deb`, and publishes them as a Release. Installed apps find later releases and update themselves.
4. Point the download links in `apps/web/src/lib/downloads.ts` at the Release (the file names are already right).

A Windows build on your own machine: `TIMEDESK_WEB_URL=https://app.example.com pnpm --filter @timedesk/desktop dist:win`.

## Checklist

- [ ] API `/health` answers
- [ ] Web loads and `Sign in` works (cookie: same domain)
- [ ] Admin email registers and lands on the dashboard
- [ ] A second person registers and shows up under Team members
- [ ] A provider key saves and Tempo answers
- [ ] `CROSS_SITE_COOKIES` empty if you use subdomains
- [ ] `KEY_ENCRYPTION_SECRET` stored somewhere safe
