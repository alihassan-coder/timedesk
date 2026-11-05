# Security

## Reporting a problem

Email **alihassan.4dev@gmail.com** with what you found and how to reproduce it. Please do not open a public issue for a security problem. You will get a reply as soon as possible.

## What is protected, and how

| Area | Protection |
|---|---|
| **Passwords** | Hashed by Better Auth (scrypt). Never stored or logged in plain text. Minimum 8 characters |
| **Accounts** | Every new account is `pending` and cannot sign in until an admin approves it. Only emails in `ADMIN_EMAILS` become admin automatically. An admin cannot change their own status |
| **Sessions** | Better Auth session cookie: `HttpOnly`, `Secure` over https, `SameSite=Lax` (or `None` only if you turn on `CROSS_SITE_COOKIES`) |
| **Privacy between people** | Every query is scoped to the signed-in user. Tests prove one person cannot read, change or delete another person's tasks, projects, time, chats, settings, memories, keys or activity |
| **AI provider keys** | Encrypted with AES-256-GCM using `KEY_ENCRYPTION_SECRET` before they are stored. The API never returns a stored key (only the last 4 characters). Keys are never put in the browser |
| **App tracking** | Off until the person turns it on. Only runs while signed in and active. Window titles are visible to the owner only, with no team or admin view. One-click erase |
| **Web requests** | Strict CORS (only your web origin), security headers, a 2 MB request limit, validated input on every endpoint, no stack traces in errors |
| **Desktop app** | Context isolation and sandbox on, no Node in the page, a small allow-listed bridge, navigation locked to your site, external links open in the normal browser, only web and mail links allowed |
| **Updates** | Downloaded from your GitHub Release. Once installers are signed, the updater also checks the publisher name |
| **Secrets in git** | `.env` files are ignored. Only `.env.example` files (with empty values) are committed |

## Known gaps (please read)

- **No password reset or email verification yet.** There is no email service connected. An admin cannot reset someone's password either. A forgotten password currently means creating a new account.
- **No two-factor authentication.**
- **Encryption key trust:** AI keys are encrypted with a secret stored in the API environment. Someone who has both the database and that secret can read the keys. Keep `KEY_ENCRYPTION_SECRET` out of the database and out of git, and never change it.
- **Windows installers are not signed** until you add a certificate ([docs/SIGNING.md](docs/SIGNING.md)). Windows shows an "Unknown publisher" warning until then.
- **Rate limiting** on sign-in is Better Auth's built-in limiter. It keeps its counters per server instance, so it slows guessing but is not a strict global limit on serverless hosting.
- **No audit log** of admin actions yet.
- **Dependency audit (`pnpm audit --prod`):** 5 findings remain, none of which run in the live app: a memory-exhaustion issue in the copy of `zod` inside mem0 (your own input validation uses a patched `zod`), and four in developer tools (`drizzle-kit`, the shadcn CLI, `node-gyp`). The old `tar` in `active-win`'s install tools is forced to a patched version in `pnpm-workspace.yaml`. Re-run the audit before each release.
- The **desktop app trusts the web address it is built or configured with**. Keep that address under your control.

## If a secret leaks

1. **`BETTER_AUTH_SECRET`:** replace it and redeploy. Everyone is signed out.
2. **`KEY_ENCRYPTION_SECRET`:** if the encrypted keys may have leaked together with it, rotate the provider keys at each provider (OpenAI, Anthropic, and so on), delete the saved keys in Settings, and set a new secret.
3. **`DATABASE_URL`:** rotate the password in Neon.
4. **An AI provider key:** revoke it at the provider and remove it from Settings.
