import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { BrowserWindow, Notification, app, dialog, globalShortcut, ipcMain, nativeImage, net, powerMonitor, protocol, safeStorage, screen, session, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveAppFile } from './app-files.ts'
import { LINUX_WM_CLASS, linuxAutostartEntry, linuxAutostartPath, linuxDesktopEntry, linuxDesktopEntryPath, linuxIconPath } from './autostart.ts'
import { DEFAULT_DESKTOP_SETTINGS, IPC, type AppInfo, type DesktopSettings, type TimerState, type UpdateStatus } from './bridge.ts'
import { APP_ORIGIN, contentSecurityPolicy, isInternalUrl, isSafeExternalUrl, linuxOzonePlatform, resolveConfig, startupRecovery, type SafeMode } from './config.ts'
import { pomodoroPhase, type FocusSession } from '@timedesk/shared'
import { createFocusGuard } from './focus.ts'
import { createTracker, type ActivitySample, type ForegroundWindow } from './tracker.ts'
import { createTray } from './tray.ts'
import { setupUpdater } from './updater.ts'
import { anchorOf, anchorOnScreen, crashReloadDelay, createIdleWatcher, describeAway, mergeUpdateStatus, sanitizeDesktopSettings, shouldShowWidget, widgetBounds, windowTitle, type Rect } from './widgets.ts'
import { sanitizeBounds, type Bounds } from './window-state.ts'

// Running from source gets its own ID, so Windows never mixes it up with (or reuses a stale icon from) an installed copy.
const APP_ID = app.isPackaged ? 'com.timedesk.app' : 'com.timedesk.app.dev'
const startHidden = process.argv.includes('--hidden')

// The bundled interface is served from app://timedesk. It must be declared before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

if (process.env.TIMEDESK_USER_DATA) app.setPath('userData', process.env.TIMEDESK_USER_DATA)
// Linux docks show an app's icon by matching the window's name (WM_CLASS, taken from the app name) to timedesk.desktop.
// The app name would otherwise be the package name "@timedesk/desktop", which matches nothing, so the dock showed a
// generic gear. The data folder is kept exactly where it was, so settings and the saved login stay.
if (process.platform === 'linux') {
  const data = app.getPath('userData')
  app.setName(LINUX_WM_CLASS)
  app.setPath('userData', data)
}
app.setAppUserModelId(APP_ID) // needed for Windows notifications
// AppImages cannot use Chromium's setuid sandbox, and newer Ubuntu restricts user namespaces, so the AppImage runs without it.
// The .deb install keeps the sandbox.
if (process.platform === 'linux' && process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox')

const log = (msg: string) => console.log(`[timedesk] ${msg}`)

// Wayland: always-on-top, window placement and reading the window in front only work through XWayland. Must be set before ready.
// After a start that showed no window, the next start is in safe mode (see startupRecovery and issue #2).
const safeModeFile = join(app.getPath('userData'), 'display-safe-mode.json')
const safeMode = (() => {
  try {
    return process.platform === 'linux' && existsSync(safeModeFile) ? (JSON.parse(readFileSync(safeModeFile, 'utf8')) as SafeMode) : null
  } catch {
    return null
  }
})()
const ozone = linuxOzonePlatform({ platform: process.platform, env: process.env, argv: process.argv, safeMode, appVersion: app.getVersion() })
if (ozone.force) app.commandLine.appendSwitch('ozone-platform', ozone.force)
if (ozone.disableGpu) app.disableHardwareAcceleration()
if (process.platform === 'linux') log(`display: ${ozone.force ?? 'default'} (${ozone.reason})`)
const inSafeMode = ozone.disableGpu

// Whether the main window has made it on screen (or is ready, when the app starts hidden in the tray).
let windowShown = false
let gpuCrashes = 0
function recoverStart(event: 'gpu-crash' | 'no-window', detail: string) {
  const action = startupRecovery({ platform: process.platform, inSafeMode, windowShown, event })
  if (action === 'ignore') return
  if (action === 'relaunch-safe') {
    log(`no window yet and ${detail}: starting again in safe mode (native display, no hardware acceleration)`)
    try {
      mkdirSync(dirname(safeModeFile), { recursive: true })
      writeFileSync(safeModeFile, JSON.stringify({ version: app.getVersion(), reason: event } satisfies SafeMode))
    } catch (e) {
      log(`could not remember safe mode: ${(e as Error).message}`)
    }
    app.relaunch()
  } else {
    log(`still no window in safe mode (${detail}): quitting so the app can be started again. Try TIMEDESK_X11=1 or TIMEDESK_WAYLAND=1.`)
  }
  app.exit(action === 'quit' ? 1 : 0) // exiting also frees the single-instance lock
}
// Chromium retries a crashed GPU process a few times, then falls back to software, which is what left no window in
// issue #2. Two crashes before the window appeared is enough to know this start will not work.
app.on('child-process-gone', (_e, d) => {
  if (d.type !== 'GPU' || d.reason === 'clean-exit') return
  gpuCrashes++
  log(`GPU process gone (${d.reason}, exit ${d.exitCode})`)
  if (gpuCrashes >= 2) recoverStart('gpu-crash', `the GPU process crashed ${gpuCrashes} times`)
})
const userFile = (name: string) => join(app.getPath('userData'), name)

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}
function writeJson(file: string, value: unknown) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2))
  } catch (e) {
    log(`could not write ${file}: ${(e as Error).message}`)
  }
}

// ---- configuration and settings ------------------------------------------------------------------------
const config = resolveConfig({
  argv: process.argv,
  env: process.env,
  userFile: readJson(userFile('config.json')),
  baked: readJson(join(__dirname, 'desktop-config.json')),
  hasBundledUi: existsSync(join(__dirname, 'app', 'index.html')),
})

let settings: DesktopSettings = sanitizeDesktopSettings(DEFAULT_DESKTOP_SETTINGS, readJson<Partial<DesktopSettings>>(userFile('settings.json')))

function applyAutoStart() {
  try {
    if (process.platform === 'linux') {
      const file = linuxAutostartPath(homedir())
      if (settings.autoStart) {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, linuxAutostartEntry(process.env.APPIMAGE ?? process.execPath, process.env.APPIMAGE ? linuxIconPath(homedir()) : 'timedesk'))
      } else if (existsSync(file)) {
        unlinkSync(file)
      }
    } else if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: settings.autoStart, args: ['--hidden'] })
    }
  } catch (e) {
    log(`auto start: ${(e as Error).message}`)
  }
}

/**
 * Linux AppImage: put a menu entry and the icon in the person's own folders, so the dock and the app menu show the
 * timedesk logo (not a generic gear) and timedesk can be found in the menu. Rewritten only when something changed, for
 * example after the AppImage file was moved. The .deb installs its own entry, so this is for the AppImage only.
 */
function integrateLinuxAppImage() {
  const appImage = process.env.APPIMAGE
  if (process.platform !== 'linux' || !appImage) return
  try {
    const home = homedir()
    const icon = linuxIconPath(home)
    const png = readFileSync(asset('icon.png'))
    if (!existsSync(icon) || !readFileSync(icon).equals(png)) {
      mkdirSync(dirname(icon), { recursive: true })
      writeFileSync(icon, png)
    }
    const file = linuxDesktopEntryPath(home)
    const entry = linuxDesktopEntry(appImage, icon)
    if (!existsSync(file) || readFileSync(file, 'utf8') !== entry) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, entry)
      log(`linux: menu entry written for ${appImage}`)
    }
  } catch (e) {
    log(`linux: could not add the menu entry: ${(e as Error).message}`)
  }
}

// ---- app tracking --------------------------------------------------------------------------------------
type ActiveWin = (() => Promise<{ title: string; owner: { name: string } } | undefined>) | null
let activeWin: ActiveWin | undefined

async function foreground(): Promise<ForegroundWindow | null> {
  if (activeWin === undefined) {
    try {
      activeWin = (await import('active-win')).activeWindow as unknown as ActiveWin
    } catch (e) {
      log(`app tracking unavailable: ${(e as Error).message}`)
      activeWin = null
    }
  }
  if (!activeWin) return null
  const w = await activeWin()
  return w ? { app: w.owner.name, title: w.title } : null
}

// End-to-end tests name the window "in front" in a file, so they never depend on (or touch) the real desktop.
// Only honoured when running from source, never in the installed app.
const testForeground = !app.isPackaged ? process.env.TIMEDESK_TEST_FOREGROUND : undefined
const readWindow = testForeground ? async () => readJson<ForegroundWindow>(testForeground) : foreground

const tracker = createTracker({
  getWindow: readWindow,
  getIdleSeconds: () => powerMonitor.getSystemIdleTime(),
  // Tests set this high so a machine nobody is touching still records.
  idleLimitSeconds: Number(process.env.TIMEDESK_IDLE_LIMIT_SECONDS) || undefined,
  appsOnly: () => !settings.trackTitles,
})

let signedIn = false
let trackingTimer: ReturnType<typeof setInterval> | undefined
function syncTracking() {
  const shouldRun = settings.trackApps && signedIn
  if (shouldRun && !trackingTimer) trackingTimer = setInterval(() => void tracker.tick(), 5000)
  if (!shouldRun && trackingTimer) {
    clearInterval(trackingTimer)
    trackingTimer = undefined
    tracker.reset()
  }
}

/**
 * Shows a notification that opens the main window when clicked. It stays referenced until it is done with, or it can be
 * garbage collected while still on screen and the click would do nothing.
 */
const liveNotifications = new Set<Notification>()
function notify(options: Electron.NotificationConstructorOptions) {
  const n = new Notification(options)
  liveNotifications.add(n)
  const forget = () => liveNotifications.delete(n)
  n.on('click', () => {
    forget()
    showWindow()
  })
  n.on('close', forget)
  n.on('failed', forget)
  n.show()
}

// ---- focus guard ----------------------------------------------------------------------------------------
const focus = createFocusGuard({
  getWindow: readWindow,
  getIdleSeconds: () => powerMonitor.getSystemIdleTime(),
  idleLimitSeconds: Number(process.env.TIMEDESK_IDLE_LIMIT_SECONDS) || undefined,
  rules: () => ({ apps: settings.focusApps, sites: settings.focusSites, nudgeSeconds: settings.focusNudgeSeconds }),
  nudge: ({ match, label, seconds }) => {
    log(`focus guard: nudge (${match}, ${seconds}s)`)
    if (!Notification.isSupported()) return
    notify({
      title: `Back to ${label || 'your focus'}?`,
      body: `${match} has been in front for ${seconds < 120 ? `${seconds} seconds` : `${Math.round(seconds / 60)} minutes`} during your focus time.`,
      icon: nativeImage.createFromPath(asset('icon.png')),
    })
  },
})

let focusTimer: ReturnType<typeof setInterval> | undefined
let lastFocusState = ''
/** Tells the open windows how the focus session is going (only when something changed). */
function sendFocusState() {
  const s = focus.state()
  const key = JSON.stringify(s)
  if (key === lastFocusState) return
  lastFocusState = key
  for (const w of [win, widgetWin]) if (w && !w.isDestroyed()) w.webContents.send(IPC.focusEvent, s)
}

/** Is it a Pomodoro break right now? Only when the Pomodoro style is chosen, as that is when breaks are shown. */
function onPomodoroBreak() {
  if (settings.widgetMode !== 'pomodoro' || !timer.pomodoro || !timer.startedAt) return false
  return pomodoroPhase(timer.startedAt, Date.now(), timer.pomodoro.focus, timer.pomodoro.break).phase === 'break'
}

/** A focus session runs while Focus guard is on, someone is signed in and a timer runs. */
function syncFocus() {
  const shouldRun = settings.focusGuard && signedIn && timer.running && timer.startedAt !== null
  if (shouldRun) focus.start(String(timer.startedAt), timer.label || 'Stopwatch')
  else focus.stop()
  if (shouldRun && !focusTimer) {
    focusTimer = setInterval(() => {
      void focus.tick({ onBreak: onPomodoroBreak() }).then(sendFocusState)
    }, 5000)
  }
  if (!shouldRun && focusTimer) {
    clearInterval(focusTimer)
    focusTimer = undefined
  }
  sendFocusState()
}

// ---- window ---------------------------------------------------------------------------------------------
let win: BrowserWindow | null = null
let quitting = false
let lastUpdate: UpdateStatus = { state: 'idle' }
let mainCrashes: number[] = [] // when the main window's page last crashed, for the reload back-off
const boundsFile = userFile('window.json')
const asset = (name: string) => join(__dirname, name)

function createWindow() {
  const bounds = sanitizeBounds(readJson<Bounds>(boundsFile), screen.getAllDisplays().map((d) => d.bounds))
  win = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: 'timedesk',
    backgroundColor: '#0a0a0a',
    // Windows needs a real .ico for the taskbar and title bar; Linux uses the PNG.
    icon: nativeImage.createFromPath(asset(process.platform === 'win32' ? 'icon.ico' : 'icon.png')),
    autoHideMenuBar: true,
    // The Pomodoro and reminder ticks run in this page: they must keep time while the window is hidden in the tray.
    webPreferences: { preload: asset('preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
  })
  // With our own app ID, Windows takes the taskbar icon from the app details, not the window: set it explicitly so the
  // timedesk logo shows (not the Electron atom) in development and in the installed app.
  if (process.platform === 'win32') win.setAppDetails({ appId: APP_ID, appIconPath: asset('icon.ico'), appIconIndex: 0 })
  if (bounds.maximized) win.maximize()
  win.once('ready-to-show', () => {
    windowShown = true
    if (!startHidden) win?.show()
  })

  // The window title carries the running time (set by the ticker below), so the page must not overwrite it.
  win.on('page-title-updated', (e) => e.preventDefault())
  // The floating timer shows when the main window is not the one in front.
  win.on('focus', syncWidget)
  win.on('blur', syncWidget)
  win.on('show', syncWidget)
  win.on('hide', syncWidget)
  win.on('minimize', syncWidget)
  win.on('restore', syncWidget)

  // Moving and resizing fire many times a second: write once things settle, and on close.
  let saveBoundsSoon: ReturnType<typeof setTimeout> | undefined
  const saveBounds = () => {
    clearTimeout(saveBoundsSoon)
    if (!win || win.isDestroyed() || win.isMinimized()) return
    const maximized = win.isMaximized()
    writeJson(boundsFile, { ...(maximized ? (readJson<Bounds>(boundsFile) ?? win.getBounds()) : win.getBounds()), maximized })
  }
  const saveBoundsLater = () => {
    clearTimeout(saveBoundsSoon)
    saveBoundsSoon = setTimeout(saveBounds, 400)
  }
  win.on('resize', saveBoundsLater)
  win.on('move', saveBoundsLater)

  win.on('close', (e) => {
    saveBounds()
    if (!quitting && settings.closeToTray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = null
    syncWidget()
    // Without "keep running in the tray", closing the main window quits the app (the small windows must not keep it alive).
    if (!settings.closeToTray) {
      quitting = true
      app.quit()
    }
  })

  // Only the timedesk site may load here. Other links open in the normal browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (isInternalUrl(url, config.startUrl) || url.startsWith('file:')) return
    e.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3 = cancelled, not a real failure
    log(`could not load ${url}: ${desc}`)
    // The bundled interface needs no network to open, so this page is only for a website address (development).
    if (config.mode === 'remote') void win?.loadFile(asset('offline.html'), { query: { url: config.startUrl } })
  })
  win.webContents.on('did-finish-load', () => {
    if (lastUpdate.state !== 'idle') win?.webContents.send(IPC.updateEvent, lastUpdate)
  })
  // A crashed page would leave a blank window: load it again, waiting longer if it keeps crashing.
  win.webContents.on('render-process-gone', (_e, details) => {
    const t = Date.now()
    mainCrashes = mainCrashes.filter((c) => t - c < 5 * 60_000).concat(t)
    const delay = crashReloadDelay(mainCrashes.length)
    log(`the window's page stopped (${details.reason}, exit ${details.exitCode}); reloading in ${delay} ms`)
    setTimeout(() => {
      if (win && !win.isDestroyed()) void win.loadURL(config.startUrl)
    }, delay)
  })
  win.on('unresponsive', () => log('the window is not responding'))
  win.on('responsive', () => log('the window is responding again'))

  void win.loadURL(config.startUrl)
}

function showWindow() {
  if (!win) createWindow()
  if (win?.isMinimized()) win.restore()
  win?.show()
  win?.focus()
}

// ---- floating timer, quick add, shortcuts, idle time ---------------------------------------------------
let timer: TimerState = { running: false, label: '', startedAt: null }
let widgetWin: BrowserWindow | null = null
let quickWin: BrowserWindow | null = null
let widgetDismissed = false
let placedMode: DesktopSettings['widgetMode'] | null = null
const widgetFile = userFile('widget.json')
const pageUrl = (path: string) => new URL(path, config.startUrl).toString()

/** A small frameless window that shows a page of the same interface. */
function smallWindow(path: string, size: { width: number; height: number }): BrowserWindow {
  const w = new BrowserWindow({
    ...size,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // On Linux a "toolbar" window is one that taskbars and Alt-Tab lists leave out, which is what a floating timer wants.
    ...(process.platform === 'linux' ? { type: 'toolbar' as const } : {}),
    title: 'timedesk',
    backgroundColor: '#ffffff',
    icon: nativeImage.createFromPath(asset(process.platform === 'win32' ? 'icon.ico' : 'icon.png')),
    webPreferences: { preload: asset('preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  })
  try {
    // Workspaces are a Linux and macOS idea. On Windows this call can drop the always-on-top flag, so it is skipped there.
    if (process.platform !== 'win32') w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch {
    // not supported on every desktop
  }
  // Same rule as the main window: only our own pages load here.
  w.webContents.on('will-navigate', (e, url) => {
    if (isInternalUrl(url, config.startUrl)) return
    e.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A small window whose page failed to load or crashed is thrown away; it is made again the next time it is needed.
  const discard = (why: string) => {
    log(`${path} window ${why}; it will be recreated`)
    setImmediate(() => {
      if (!w.isDestroyed()) w.destroy()
    })
  }
  w.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) discard(`could not load (${desc})`)
  })
  w.webContents.on('render-process-gone', (_e, details) => discard(`page stopped (${details.reason})`))
  w.on('unresponsive', () => log(`${path} window is not responding`))
  void w.loadURL(pageUrl(path))
  return w
}

/** Keeps a small window above every other window. Applied each time it is shown, because showing can reset it. */
function pinOnTop(w: BrowserWindow, justShown = false) {
  try {
    for (const level of ['floating', 'pop-up-menu', 'screen-saver'] as const) {
      w.setAlwaysOnTop(true, level)
      if (w.isAlwaysOnTop()) break
    }
    w.setSkipTaskbar(true)
    w.moveTop()
    if (!w.isAlwaysOnTop()) log('the window did not accept always-on-top')
    // Linux window managers ignore a "skip taskbar" request sent before the window is on screen (and Electron does not send
    // it again while it thinks the flag is already set), so a moment after the window appears it is switched off and on.
    if (process.platform === 'linux' && justShown) {
      setTimeout(() => {
        if (w.isDestroyed() || !w.isVisible()) return
        w.setSkipTaskbar(false)
        w.setSkipTaskbar(true)
      }, 500)
    }
  } catch (e) {
    log(`could not keep the window on top: ${(e as Error).message}`)
  }
}

function mainIsInFront() {
  return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused()
}

function placeWidget() {
  if (!widgetWin) return
  const areas: Rect[] = screen.getAllDisplays().map((d) => d.workArea)
  // The style changes around the window's bottom-right corner. If it is hidden or in the bottom bar, use where it was last dragged to.
  const shown = widgetWin.isVisible() && placedMode !== null && placedMode !== 'dock'
  const saved = readJson<{ right: number; bottom: number }>(widgetFile)
  const start = shown ? anchorOf(widgetWin.getBounds()) : saved && typeof saved.right === 'number' && typeof saved.bottom === 'number' ? saved : null
  const anchor = start && anchorOnScreen(start, areas) ? start : null
  const display = anchor ? screen.getDisplayNearestPoint({ x: anchor.right - 1, y: anchor.bottom - 1 }) : screen.getPrimaryDisplay()
  widgetWin.setBounds(widgetBounds(settings.widgetMode, display.workArea, anchor))
  placedMode = settings.widgetMode
}

let saveWidgetPos: ReturnType<typeof setTimeout> | undefined
function ensureWidget(): BrowserWindow {
  if (widgetWin && !widgetWin.isDestroyed()) return widgetWin
  widgetWin = smallWindow('/widget', { width: 330, height: 56 })
  widgetWin.on('move', () => {
    clearTimeout(saveWidgetPos)
    saveWidgetPos = setTimeout(() => {
      // Remember where it was dragged. The bottom bar always sits at the bottom, so it does not count.
      if (!widgetWin || widgetWin.isDestroyed() || settings.widgetMode === 'dock') return
      writeJson(widgetFile, anchorOf(widgetWin.getBounds()))
    }, 400)
  })
  widgetWin.on('closed', () => {
    widgetWin = null
    placedMode = null
  })
  placedMode = null
  return widgetWin
}

/** Shows or hides the floating timer according to the setting, the timer and which window is in front. */
function syncWidget() {
  const show = shouldShowWidget({ visibility: settings.widget, signedIn, running: timer.running, mainFocused: mainIsInFront(), dismissed: widgetDismissed })
  if (show) {
    const w = ensureWidget()
    if (placedMode !== settings.widgetMode || !w.isVisible()) placeWidget()
    const fresh = !w.isVisible()
    if (fresh) w.showInactive() // never steal the keyboard from what the person is doing
    pinOnTop(w, fresh)
    log(`floating timer: ${settings.widgetMode} bounds=${JSON.stringify(w.getBounds())} visible=${w.isVisible()} onTop=${w.isAlwaysOnTop()}`)
  } else if (widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible()) {
    widgetWin.hide()
  }
}

const QUICK_SIZE = { width: 560, height: 92 }
let quickAddWaiting = false // shown before its page finished loading: tell the page once it has
function showQuickAdd() {
  if (!signedIn) {
    showWindow() // nobody to add a task for: ask them to sign in
    return
  }
  if (!quickWin || quickWin.isDestroyed()) {
    quickWin = smallWindow('/quick-add', QUICK_SIZE)
    quickWin.on('blur', () => quickWin?.hide()) // clicking elsewhere dismisses it
    quickWin.on('closed', () => {
      quickWin = null
    })
    const w = quickWin
    quickAddWaiting = false
    w.webContents.on('did-finish-load', () => {
      if (!quickAddWaiting || w.isDestroyed()) return
      quickAddWaiting = false
      w.webContents.send(IPC.quickAddShown)
    })
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  quickWin.setBounds({ x: Math.round(area.x + (area.width - QUICK_SIZE.width) / 2), y: Math.round(area.y + area.height * 0.28), ...QUICK_SIZE })
  quickWin.show()
  pinOnTop(quickWin, true)
  quickWin.focus()
  if (quickWin.webContents.isLoading()) quickAddWaiting = true
  else quickWin.webContents.send(IPC.quickAddShown)
}

/** System-wide keys. Linux desktops that block global shortcuts (some Wayland setups) simply do not get them. */
function applyShortcuts() {
  globalShortcut.unregisterAll()
  if (!settings.shortcuts) return
  const reg = (accelerator: string, run: () => void) => {
    try {
      if (!globalShortcut.register(accelerator, run)) log(`shortcut ${accelerator} is taken or not allowed here`)
    } catch (e) {
      log(`shortcut ${accelerator}: ${(e as Error).message}`)
    }
  }
  reg('CommandOrControl+Alt+T', () => win?.webContents.send(IPC.trayAction, 'toggle-timer'))
  reg('CommandOrControl+Alt+N', showQuickAdd)
}

const idle = createIdleWatcher()
let askingAboutIdle = false // one question at a time, however many ways (idle, sleep, lock) the absence was noticed
async function askAboutIdle(since: number) {
  if (askingAboutIdle) return
  askingAboutIdle = true
  try {
    await idleDialog(since)
  } finally {
    askingAboutIdle = false
  }
}
async function idleDialog(since: number) {
  const away = Date.now() - since
  const at = new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'timedesk',
    message: `You were away for ${describeAway(away)}`,
    detail: `The timer kept running on "${timer.label || 'Stopwatch'}" since ${at}. What should happen to those minutes?`,
    buttons: ['Keep the time', `Remove ${describeAway(away)} and keep going`, `Stop the timer at ${at}`],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  if (response === 1) win?.webContents.send(IPC.idleDecision, { action: 'remove', at: since })
  if (response === 2) win?.webContents.send(IPC.idleDecision, { action: 'stop', at: since })
}

function startTimers() {
  // The window title carries the running time, so it shows in the taskbar and Alt-Tab.
  setInterval(() => {
    if (!win || win.isDestroyed()) return
    const title = windowTitle(timer, Date.now())
    if (win.getTitle() !== title) win.setTitle(title)
  }, 1000)
  setInterval(() => {
    const back = idle.check(powerMonitor.getSystemIdleTime(), Date.now(), timer.running, settings.idleMinutes)
    if (back) void askAboutIdle(back.idleSince)
  }, 10_000)
}

/**
 * Sleep and the lock screen: the open app slice and the focus streak end when the computer goes away, nothing is counted
 * while it is away, and on the way back the person is asked about the time, the same as after being idle.
 */
let awaySince: number | null = null
function watchPower() {
  const away = (why: string) => {
    if (awaySince === null) awaySince = Date.now()
    tracker.pause()
    focus.pause()
    log(`${why}: tracking paused`)
  }
  const back = (why: string) => {
    tracker.resume()
    focus.resume()
    const since = awaySince
    awaySince = null
    if (since === null) return
    log(`${why}: away for ${Math.round((Date.now() - since) / 1000)}s`)
    const ask = idle.resumed(since, Date.now(), timer.running && signedIn, settings.idleMinutes)
    if (ask) void askAboutIdle(ask.idleSince)
  }
  powerMonitor.on('suspend', () => away('suspend'))
  powerMonitor.on('lock-screen', () => away('lock'))
  powerMonitor.on('resume', () => back('resume'))
  powerMonitor.on('unlock-screen', () => back('unlock'))
}

/** A monitor plugged in, unplugged or rescaled: put the floating timer back where it belongs. */
function watchDisplays() {
  const replace = () => {
    if (widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible()) placeWidget()
  }
  screen.on('display-added', replace)
  screen.on('display-removed', replace)
  screen.on('display-metrics-changed', replace)
}

// ---- messages from the web app -------------------------------------------------------------------------
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const minutes = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 240
function pomodoroLengths(v: unknown): TimerState['pomodoro'] {
  const p = v as { focus?: unknown; break?: unknown } | undefined
  return p && minutes(p.focus) && minutes(p.break) ? { focus: p.focus as number, break: p.break as number } : undefined
}

function registerIpc(tray: ReturnType<typeof createTray>, updater: ReturnType<typeof setupUpdater>) {
  // The login token is handed out only to our own pages, never to anything else that might load in the window.
  const fromOurPage = (e: { senderFrame: { url: string } | null }) => !!e.senderFrame && isInternalUrl(e.senderFrame.url, config.startUrl)
  // The timer, the sign-in state and the recorded activity are driven only by the main window, never by a small window.
  const fromMain = (e: { senderFrame: { url: string } | null; sender: Electron.WebContents }) => fromOurPage(e) && !!win && !win.isDestroyed() && e.sender === win.webContents
  const tokenFile = userFile('auth-token.bin')
  let sessionToken: string | null = null // used when the system cannot encrypt (some Linux setups): lasts until the app quits

  // On Linux the keyring can come up a little after the app (at login, with auto start), so while encryption is not
  // available yet the saved token is tried again for a few seconds, and the file is kept. A token the working keyring
  // cannot decrypt was saved under another keyring (issue #2): it can never be read, so it is removed and the person
  // simply signs in again (which saves a fresh one). Windows reads once.
  const tokenTries = process.platform === 'linux' ? 5 : 1
  let keyringWaited = false // wait only once per run; later reads try once
  const saveToken = async (token: string) => {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return
    try {
      mkdirSync(dirname(tokenFile), { recursive: true })
      writeFileSync(tokenFile, await safeStorage.encryptStringAsync(token))
    } catch (err) {
      log('could not save the login token: ' + (err as Error).message)
    }
  }
  ipcMain.handle(IPC.tokenGet, async (e) => {
    if (!fromOurPage(e)) return null
    if (sessionToken) return sessionToken
    if (!existsSync(tokenFile)) return null
    const tries = keyringWaited ? 1 : tokenTries
    for (let i = 0; i < tries; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1000))
      if (await safeStorage.isAsyncEncryptionAvailable()) {
        keyringWaited = false
        try {
          const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(readFileSync(tokenFile))
          if (shouldReEncrypt) void saveToken(result) // the key was rotated: store it under the new one
          return result
        } catch (err) {
          const backend = process.platform === 'linux' ? ` (keyring: ${safeStorage.getSelectedStorageBackend()})` : ''
          log(`the saved login was made with another keyring and cannot be read${backend}; removing it, sign in again: ${(err as Error).message}`)
          try {
            unlinkSync(tokenFile)
          } catch {
            // already gone
          }
          return null
        }
      }
      if (sessionToken) return sessionToken // signed in meanwhile
    }
    log('the keyring is not available, so the saved login cannot be read yet')
    keyringWaited = true
    return null
  })
  ipcMain.handle(IPC.tokenSet, async (e, token: unknown) => {
    if (!fromOurPage(e) || !isStr(token, 4000) || token.length < 8) return
    sessionToken = token
    await saveToken(token)
  })
  ipcMain.handle(IPC.tokenClear, (e) => {
    if (!fromOurPage(e)) return
    sessionToken = null
    try {
      if (existsSync(tokenFile)) unlinkSync(tokenFile)
    } catch {
      // nothing to remove
    }
  })

  ipcMain.handle(IPC.info, (): AppInfo => ({ mode: config.mode, version: app.getVersion(), platform: process.platform, packaged: app.isPackaged, startUrl: config.startUrl }))

  ipcMain.handle(IPC.notify, (_e, p: { title?: unknown; body?: unknown }) => {
    if (!isStr(p?.title, 120) || !isStr(p?.body, 400) || !Notification.isSupported()) return
    notify({ title: p.title, body: p.body, icon: nativeImage.createFromPath(asset('icon.png')) })
  })

  ipcMain.on(IPC.timer, (e, s: Partial<TimerState>) => {
    if (!fromMain(e) || typeof s?.running !== 'boolean') return
    const wasRunning = timer.running
    timer = {
      running: s.running,
      label: isStr(s.label, 200) ? s.label : '',
      startedAt: typeof s.startedAt === 'number' ? s.startedAt : null,
      showInTitle: s.showInTitle !== false,
      pomodoro: pomodoroLengths(s.pomodoro),
    }
    if (timer.running && !wasRunning) widgetDismissed = false // a new timer brings the floating timer back
    tray.update(timer)
    syncWidget()
    syncFocus()
  })

  ipcMain.handle(IPC.getSettings, (e) => (fromOurPage(e) ? settings : null))
  ipcMain.handle(IPC.setSettings, (e, patch: unknown) => {
    if (!fromOurPage(e)) return settings
    const before = settings
    settings = sanitizeDesktopSettings(settings, patch)
    writeJson(userFile('settings.json'), settings)
    applyAutoStart()
    syncTracking()
    if (settings.widget !== before.widget) widgetDismissed = false
    if (settings.shortcuts !== before.shortcuts) applyShortcuts()
    syncWidget()
    syncFocus()
    widgetWin?.webContents.send(IPC.dataChangedEvent) // the floating timer re-reads its style at once
    return settings
  })

  ipcMain.on(IPC.signedIn, (e, v: unknown) => {
    if (!fromMain(e)) return
    signedIn = v === true
    syncTracking()
    if (!signedIn) {
      idle.reset()
      quickWin?.hide()
    }
    syncWidget()
    syncFocus()
    if (!signedIn) {
      // What was measured belongs to the person who just left; it is not handed to whoever signs in next.
      focus.reset()
      sendFocusState()
    }
  })

  ipcMain.handle(IPC.focusState, () => focus.state())
  ipcMain.handle(IPC.focusPull, (e) => {
    if (!fromMain(e)) return []
    const sessions = focus.drain()
    sendFocusState()
    return sessions
  })
  ipcMain.on(IPC.focusRequeue, (e, sessions: FocusSession[]) => {
    // After sign-out these belong to the person who left: they are dropped, not kept for whoever signs in next.
    if (!fromMain(e) || !signedIn || !Array.isArray(sessions)) return
    focus.requeue(sessions.filter((s) => isStr(s?.id, 64) && isStr(s?.startedAt, 40) && typeof s.focusedSeconds === 'number'))
  })

  // The floating timer and quick add are windows of this app: they can hide themselves, open the main window, and
  // tell the other windows to reload.
  ipcMain.on(IPC.widgetHide, (e) => {
    if (!fromOurPage(e)) return
    widgetDismissed = true
    syncWidget()
  })
  ipcMain.on(IPC.openMain, (e) => {
    if (fromOurPage(e)) showWindow()
  })
  ipcMain.on(IPC.closeOwn, (e) => {
    if (!fromOurPage(e)) return
    const from = BrowserWindow.fromWebContents(e.sender)
    if (from && (from === quickWin || from === widgetWin)) from.hide()
  })
  ipcMain.on(IPC.dataChanged, (e) => {
    if (!fromOurPage(e)) return
    for (const w of [win, widgetWin, quickWin]) if (w && !w.isDestroyed() && w.webContents !== e.sender) w.webContents.send(IPC.dataChangedEvent)
  })
  ipcMain.handle(IPC.pull, (e) => (fromMain(e) ? tracker.drain() : []))
  ipcMain.on(IPC.requeue, (e, samples: ActivitySample[]) => {
    if (fromMain(e) && signedIn && Array.isArray(samples)) tracker.requeue(samples.filter((s) => isStr(s?.id, 64) && isStr(s?.app, 120) && typeof s.seconds === 'number'))
  })

  ipcMain.handle(IPC.updateStatus, () => lastUpdate)
  ipcMain.handle(IPC.checkUpdates, async (e) => {
    if (fromOurPage(e)) await updater.check()
  })
  ipcMain.on(IPC.installUpdate, (e) => {
    if (!fromOurPage(e) || lastUpdate.state !== 'ready') return
    quitting = true
    updater.install()
    // Still running a few seconds later: the install did not happen, so closing the window must hide it to the tray again.
    setTimeout(() => {
      if (!quitting) return
      quitting = false
      log('the update did not restart the app')
    }, 5000)
  })
  ipcMain.on(IPC.retry, () => void win?.loadURL(config.startUrl))
}

// ---- start ----------------------------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  void app.whenReady().then(() => {
    // Serve the bundled interface from app://timedesk, with a strict security policy on every file.
    protocol.handle('app', async (request) => {
      const url = new URL(request.url)
      const file = url.host === new URL(APP_ORIGIN).host ? resolveAppFile(join(__dirname, 'app'), url.pathname, existsSync) : null
      if (!file) return new Response('Not found', { status: 404 })
      const res = await net.fetch(pathToFileURL(file.file).toString())
      const headers = new Headers(res.headers)
      headers.set('Content-Security-Policy', contentSecurityPolicy(config.apiUrl))
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(res.body, { status: res.status, headers })
    })

    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications' || permission === 'media'))

    const tray = createTray(asset('tray.png'), {
      open: showWindow,
      toggleTimer: () => win?.webContents.send(IPC.trayAction, 'toggle-timer'),
      quit: () => {
        quitting = true
        app.quit()
      },
    })
    const updater = setupUpdater({
      packaged: app.isPackaged,
      log,
      send: (s) => {
        const next = mergeUpdateStatus(lastUpdate, s)
        if (next === lastUpdate) return log(`update: kept "${lastUpdate.state}" over "${s.state}"`)
        lastUpdate = next
        if (win && !win.isDestroyed()) win.webContents.send(IPC.updateEvent, next)
      },
    })
    registerIpc(tray, updater)
    applyAutoStart()
    integrateLinuxAppImage()
    createWindow()
    // A window that is not ready after 45 s will not come: recover instead of running invisibly (Linux only).
    setTimeout(() => recoverStart('no-window', 'the window was not ready after 45 s'), 45_000).unref()
    applyShortcuts()
    startTimers()
    watchPower()
    watchDisplays()
    log(`started ${app.getVersion()} (${app.isPackaged ? 'packaged' : 'development'}) (${config.mode}) -> ${config.startUrl}`)
  })

  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => {
    // Stay alive in the tray unless the person chose to quit.
    if (quitting || !settings.closeToTray) app.quit()
  })
  app.on('activate', showWindow)
}
