# Deploying timedesk

Three things get deployed from this repo: the **API** and the **web app** (two separate Vercel projects), and the **desktop installers** (GitHub Actions). The database is a Neon Postgres project.

> **Keep your real addresses, emails and secrets out of this repository.** The repository is public. Real values live only in the Vercel project settings, the GitHub repository variables, and git-ignored `.env.production` files on your own computer. This guide uses `example.com` placeholders.

## 1. API (a Vercel project)

1. Vercel -> Add New Project -> import this repository.
2. **Root Directory:** `apps/api`. Turn on **Include source files outside of the Root Directory** (the API uses `packages/db` and `packages/shared`).
3. Framework Preset: **Other** or **Hono** (either works). Node.js 22. Everything else comes from `apps/api/vercel.json`: it installs from the repo root, runs `pnpm run build` (bundles the API into one file, `dist/server.mjs`, whose default export is the app), and tells Vercel the output folder is `dist`. Leave the build, install and output fields empty.
4. **Environment variables** (Production, and Preview if you use it):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `BETTER_AUTH_SECRET` | 32+ random characters. Make a new one for production |
| `BETTER_AUTH_URL` | The public address of this API, for example `https://api.example.com` |
| `WEB_ORIGIN` | The public address of the web app, for example `https://app.example.com` (no trailing slash) |
| `ADMIN_EMAILS` | Comma-separated emails that become admin and are approved when they register, for example `you@example.com,teammate@example.com` |
| `KEY_ENCRYPTION_SECRET` | 32+ random characters. **Never change it after people save AI keys**, or the saved keys become unreadable. If you share a database between environments, use the same value in all of them |
| `DESKTOP_ORIGIN` | Optional. The desktop app's own address, `app://timedesk` by default. Leave it unless you change the app |
| `CROSS_SITE_COOKIES` | Leave empty with subdomains of one domain (see section 3) |

5. Check: open `https://<api>/health`. It must answer `{"ok":true}`.

Generate secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 2. Web app (a second Vercel project)

1. Import the same repository again as a second project.
2. **Root Directory:** `apps/web`. Include source files outside the root: on (it uses `packages/shared`).
3. Environment variable: `VITE_API_URL` = the API address from step 1. It is baked in at build time, so redeploy the web app if you change it.
4. `apps/web/vercel.json` already sends every path to `index.html`, so page refreshes work.

## 3. The login cookie: use one domain (important)

Sign-in uses a cookie. Browsers only send it when the web app and the API are on the **same site**.

- **Works:** `app.example.com` (web) and `api.example.com` (API). Same site, different subdomains. Set `WEB_ORIGIN` and `BETTER_AUTH_URL` to those.
- **Does not work by default:** a web app and an API on unrelated domains, for example two separate `*.vercel.app` addresses (`vercel.app` is a public suffix, so they are different sites) or `app.example.com` with `something.vercel.app`. Login silently fails.
  - Workaround: set `CROSS_SITE_COOKIES=true` on the API. It sends the cookie as `SameSite=None; Secure`. Chrome allows it. **Safari and Chrome incognito block it**, so use subdomains of one domain for real use.

## 4. Database

Run migrations once from your computer, with the database's `DATABASE_URL` in `apps/api/.env`:

```
pnpm --filter @timedesk/db db:migrate
```

Tempo's memory (mem0) needs the `vector` extension. If memory errors, run in the Neon SQL editor: `CREATE EXTENSION IF NOT EXISTS vector;`

## 5. First run

1. Open the web app and register with one of the `ADMIN_EMAILS`. It is approved on the spot.
2. Settings -> AI assistant: add at least one provider key. Add an OpenAI or Gemini key to switch on memory.
3. Share the address with your team. They register, then you approve them under Team members.

## 6. Google Calendar (optional)

Without this section everything else works; the Calendar page and Settings -> Calendar simply say Google Calendar is not set up. With it, each person can connect their own Google account: their events show in timedesk, they can add and edit events here, and tasks with a due date are mirrored to Google as all-day events (changes go both ways).

**What you need from Google** (free, about 10 minutes, one time):

1. Go to the [Google Cloud console](https://console.cloud.google.com/) and create a project (any name, for example "timedesk").
2. **APIs & Services -> Library**: search for **Google Calendar API** and press **Enable**.
3. **APIs & Services -> OAuth consent screen** (Google may call it "Google Auth platform"):
   - User type: **External**. App name: timedesk. Support and developer email: yours.
   - Scopes: add `.../auth/calendar.events` and `.../auth/userinfo.email`.
   - Publishing status: leave it on **Testing**. This is fine for a small team and needs no Google review.
   - **Test users**: add the Google email of every person who will connect (up to 100). Only they can connect while it is in Testing.
4. **APIs & Services -> Credentials -> Create credentials -> OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs**: add `<your API address>/v1/integrations/google/callback`, for example `https://api.example.com/v1/integrations/google/callback`. It must match exactly, including https and no trailing slash. For local development also add `http://localhost:3001/v1/integrations/google/callback`.
   - Create it and copy the **Client ID** and **Client secret**.
5. In the **API's** Vercel project -> Settings -> Environment Variables add (Production, then redeploy):

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | The client id from step 4 |
| `GOOGLE_CLIENT_SECRET` | The client secret from step 4 |
| `GOOGLE_REDIRECT_URI` | Optional. Only if your API address differs from `BETTER_AUTH_URL`. Defaults to `<BETTER_AUTH_URL>/v1/integrations/google/callback` |

6. **Apply the database migration** (it adds the tables for the connection and the task links). From your computer, with the database's `DATABASE_URL` in `apps/api/.env`:

```
pnpm --filter @timedesk/db db:migrate
```

7. Open timedesk -> Settings -> **Calendar** -> **Connect Google Calendar**. Google shows an "unverified app" warning while the app is in Testing: choose Advanced -> Go to timedesk. In the desktop app the sign-in opens in your normal browser and the app notices when you are done.

Notes:
- Tokens: the refresh token is encrypted in the database with `KEY_ENCRYPTION_SECRET` (the same secret as the AI keys). Do not change that secret, or everyone has to connect again.
- In Testing mode Google expires the permission after **7 days**, so people may be asked to connect again weekly. Publishing the app (verification) removes that; for a team of a few people reconnecting is usually acceptable.
- Disconnecting in timedesk revokes the permission at Google and deletes the stored tokens. You can also remove timedesk at https://myaccount.google.com/permissions.

## 7. Desktop installers (GitHub Releases)

The workflow `.github/workflows/desktop-release.yml` builds the Windows installer, the Linux AppImage and the `.deb`, and publishes them as a GitHub Release. Installed apps check that release and update themselves. This needs a **public** repository (or a separate public releases repository); a private one cannot serve anonymous downloads or updates.

**One-time setup** (repository admin): Settings -> Secrets and variables -> Actions -> **Variables** -> add `TIMEDESK_API_URL` = the public address of your API (`https://...`). The installer contains its own copy of the interface and talks to that backend; the address is compiled into it. It is stored there, not in the code, and the release refuses to run without it. Also check Settings -> Actions -> General -> Workflow permissions allows the workflow to publish (the publish job asks for `contents: write`). The API must be redeployed with the token-login support before 0.2.0 installs can sign in.

**Try it without publishing:** Actions -> Desktop release -> Run workflow. It builds Windows and Linux and keeps the files as downloadable artifacts for 14 days.

**Publish a release:**

1. Set `version` in `apps/desktop/package.json` (for example `0.1.0`).
2. Add a `## 0.1.0` section to `CHANGELOG.md`. It becomes the release notes.
3. Commit and push, then tag:

```
git tag v0.1.0
git push origin v0.1.0
```

The workflow checks that the tag, the app version and the changelog agree, runs the tests, builds both systems, writes `SHA256SUMS.txt`, and creates the release with notes and install instructions. A second release for the same tag is refused.

A Windows build on your own machine: `TIMEDESK_API_URL=https://api.example.com pnpm --filter @timedesk/desktop dist:win`. Code signing (removes the Windows "Unknown publisher" warning) is in [SIGNING.md](SIGNING.md).

## Checklist

- [ ] API `/health` answers
- [ ] Web loads and `Sign in` works (cookie: same domain)
- [ ] Admin email registers and lands on the dashboard
- [ ] A second person registers and shows up under Team members
- [ ] A provider key saves and Tempo answers
- [ ] `CROSS_SITE_COOKIES` empty if you use subdomains
- [ ] `KEY_ENCRYPTION_SECRET` stored somewhere safe
- [ ] Repository variable `TIMEDESK_API_URL` set before the first release
- [ ] Google Calendar (optional): client id and secret in the API project, redirect address registered, migration applied
