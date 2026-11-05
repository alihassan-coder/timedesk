# @timedesk/desktop

The timedesk desktop app for **Windows and Linux**. It opens the same web UI in its own window and adds what a browser cannot do.

| Feature | How |
|---|---|
| Native notifications | Due-date reminders and "timer left running", through the system notification area |
| System tray | Timer in the tooltip, start/stop from the menu, keeps running when the window is closed |
| Start with the computer | Windows login item; Linux autostart entry |
| App tracking | Records which program is in front every 5 seconds while you are signed in and active. **Off until you turn it on.** Uploaded to your account; only you can see it |
| Auto update | Checks GitHub Releases, downloads quietly, shows "Restart to update" |
| Can't connect page | A friendly retry screen instead of a blank window |

The installer **contains its own copy of the web interface**, built from the same `apps/web` source as the website (no duplicated UI code). The app opens that copy from inside itself, so it opens even when the website is down. It talks to the same backend as the website. Because the app runs from its own address, it signs in with a **token** (kept encrypted by Windows or the Linux keyring, never in page storage) instead of a cookie. Offline use of your data needs the sync engine, which is a later step.

## Run it in development

```
pnpm dev                       # from the repo root: starts web + API
pnpm --filter @timedesk/desktop dev
```

From source, `pnpm --filter @timedesk/desktop dev` builds the interface into `dist/app` and opens it, talking to the backend at `http://localhost:3001` (set `TIMEDESK_API_URL` to change that). To open a website address instead, for example the Vite dev server with hot reload: `pnpm --filter @timedesk/desktop dev -- --web-url=http://localhost:5173`.

An address given on purpose always wins, first match: `--web-url=` flag, `TIMEDESK_WEB_URL` environment variable, `config.json` in the app's data folder (`{"webUrl": "..."}`). Otherwise the app opens its bundled interface.

Try the update banner without publishing anything: `TIMEDESK_FAKE_UPDATE=0.2.0 pnpm --filter @timedesk/desktop dev`.

If the app crashes on start with `Cannot read properties of undefined (reading 'setPath')`, your terminal has `ELECTRON_RUN_AS_NODE` set. `pnpm dev` already removes it.

## Test

```
pnpm --filter @timedesk/desktop test            # logic: config, window bounds, activity tracker, autostart
pnpm --filter @timedesk/desktop test:e2e        # real Electron window: bridge, login, update banner, tracking upload, offline page (about 2 minutes)
node e2e/packaged-smoke.mjs                     # the packaged .exe starts, reports packaged, and can track apps
```

The end-to-end tests refuse to run unless they find the throwaway in-memory API (`MOCK_AI=1 pnpm --filter @timedesk/api dev:memory`), so they can never touch a real database.

## Build installers

On **Windows**: `TIMEDESK_API_URL=https://api.example.com pnpm --filter @timedesk/desktop dist:win` writes `release/timedesk-Setup-<version>.exe` and `latest.yml`. The backend address is compiled into the interface.

**Linux installers cannot be built on Windows.** They are built on GitHub: `.github/workflows/desktop-release.yml` runs when you push a tag like `v0.1.0`, builds Windows + Linux (AppImage and .deb), and publishes them as a GitHub Release. Set the repo variable `TIMEDESK_API_URL` first. Details and a no-publish dry run are in [docs/DEPLOY.md](../../docs/DEPLOY.md).

Installers are not code-signed yet, so Windows SmartScreen shows "unrecognized app" (More info, Run anyway). A signing certificate fixes that later.

## Linux notes

- **.deb** (Ubuntu, Debian, Mint): `sudo apt install ./timedesk_0.1.0_amd64.deb`. Updating means installing the new .deb.
- **AppImage**: `chmod +x timedesk-0.1.0.AppImage && ./timedesk-0.1.0.AppImage`. It updates itself. It runs without Chromium's sandbox.
- App tracking reads the active window, which works on X11. Wayland blocks it for security, so it may record nothing there.
- Voice dictation uses the browser speech service, which Electron does not include. Typing works everywhere; dictation works in Chrome and Edge.

## Layout

```
src/main.ts         window, tray, notifications, settings, tracker loop, messages from the page
src/preload.ts      the only thing the page can reach: window.timedesk
src/config.ts       which web address to open, and which links may open inside the window
src/tracker.ts      turns "what is in front" into upload-ready samples (idle-aware, no timers inside)
src/updater.ts      GitHub Releases updates (electron-updater)
src/tray.ts  src/autostart.ts  src/window-state.ts  src/offline.html
scripts/            build (esbuild) and dev launcher
e2e/                real-window tests
```
