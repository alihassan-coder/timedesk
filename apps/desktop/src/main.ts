import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { BrowserWindow, Notification, app, dialog, globalShortcut, ipcMain, nativeImage, net, powerMonitor, protocol, safeStorage, screen, session, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveAppFile } from './app-files.ts'
import { linuxAutostartEntry, linuxAutostartPath } from './autostart.ts'
import { DEFAULT_DESKTOP_SETTINGS, IPC, type AppInfo, type DesktopSettings, type TimerState, type UpdateStatus } from './bridge.ts'
import { APP_ORIGIN, contentSecurityPolicy, isInternalUrl, isSafeExternalUrl, resolveConfig } from './config.ts'
import { createTracker, type ActivitySample, type ForegroundWindow } from './tracker.ts'
import { createTray } from './tray.ts'
import { setupUpdater } from './updater.ts'
import { anchorOf, anchorOnScreen, createIdleWatcher, describeAway, sanitizeDesktopSettings, shouldShowWidget, widgetBounds, windowTitle, type Rect } from './widgets.ts'
import { sanitizeBounds, type Bounds } from './window-state.ts'

// Running from source gets its own ID, so Windows never mixes it up with (or reuses a stale icon from) an installed copy.
const APP_ID = app.isPackaged ? 'com.timedesk.app' : 'com.timedesk.app.dev'
const startHidden = process.argv.includes('--hidden')

// The bundled interface is served from app://timedesk. It must be declared before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

if (process.env.TIMEDESK_USER_DATA) app.setPath('userData', process.env.TIMEDESK_USER_DATA)
app.setAppUserModelId(APP_ID) // needed for Windows notifications
// AppImages cannot use Chromium's setuid sandbox, and newer Ubuntu restricts user namespaces, so the AppImage runs without it.
// The .deb install keeps the sandbox.
if (process.platform === 'linux' && process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox')

const log = (msg: string) => console.log(`[timedesk] ${msg}`)
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
        writeFileSync(file, linuxAutostartEntry(process.env.APPIMAGE ?? process.execPath))
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

const tracker = createTracker({
  getWindow: foreground,
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

// ---- window ---------------------------------------------------------------------------------------------
let win: BrowserWindow | null = null
let quitting = false
let lastUpdate: UpdateStatus = { state: 'idle' }
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
    webPreferences: { preload: asset('preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  })
  // With our own app ID, Windows takes the taskbar icon from the app details, not the window: set it explicitly so the
  // timedesk logo shows (not the Electron atom) in development and in the installed app.
  if (process.platform === 'win32') win.setAppDetails({ appId: APP_ID, appIconPath: asset('icon.ico'), appIconIndex: 0 })
  if (bounds.maximized) win.maximize()
  win.once('ready-to-show', () => {
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

  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return
    const maximized = win.isMaximized()
    writeJson(boundsFile, { ...(maximized ? (readJson<Bounds>(boundsFile) ?? win.getBounds()) : win.getBounds()), maximized })
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  win.on('close', (e) => {
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
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  quickWin.setBounds({ x: Math.round(area.x + (area.width - QUICK_SIZE.width) / 2), y: Math.round(area.y + area.height * 0.28), ...QUICK_SIZE })
  quickWin.show()
  pinOnTop(quickWin, true)
  quickWin.focus()
  const w = quickWin
  const announce = () => w.webContents.send(IPC.quickAddShown)
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', announce)
  else announce()
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
async function askAboutIdle(since: number) {
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

// ---- messages from the web app -------------------------------------------------------------------------
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max

function registerIpc(tray: ReturnType<typeof createTray>, updater: ReturnType<typeof setupUpdater>) {
  // The login token is handed out only to our own pages, never to anything else that might load in the window.
  const fromOurPage = (e: { senderFrame: { url: string } | null }) => !!e.senderFrame && isInternalUrl(e.senderFrame.url, config.startUrl)
  const tokenFile = userFile('auth-token.bin')
  let sessionToken: string | null = null // used when the system cannot encrypt (some Linux setups): lasts until the app quits

  ipcMain.handle(IPC.tokenGet, (e) => {
    if (!fromOurPage(e)) return null
    if (sessionToken) return sessionToken
    try {
      if (!safeStorage.isEncryptionAvailable() || !existsSync(tokenFile)) return null
      return safeStorage.decryptString(readFileSync(tokenFile))
    } catch {
      return null
    }
  })
  ipcMain.handle(IPC.tokenSet, (e, token: unknown) => {
    if (!fromOurPage(e) || !isStr(token, 4000) || token.length < 8) return
    sessionToken = token
    if (safeStorage.isEncryptionAvailable()) {
      try {
        mkdirSync(dirname(tokenFile), { recursive: true })
        writeFileSync(tokenFile, safeStorage.encryptString(token))
      } catch (err) {
        log('could not save the login token: ' + (err as Error).message)
      }
    }
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
    const n = new Notification({ title: p.title, body: p.body, icon: nativeImage.createFromPath(asset('icon.png')) })
    n.on('click', showWindow)
    n.show()
  })

  ipcMain.on(IPC.timer, (_e, s: Partial<TimerState>) => {
    if (typeof s?.running !== 'boolean') return
    const wasRunning = timer.running
    timer = {
      running: s.running,
      label: isStr(s.label, 200) ? s.label : '',
      startedAt: typeof s.startedAt === 'number' ? s.startedAt : null,
      showInTitle: s.showInTitle !== false,
    }
    if (timer.running && !wasRunning) widgetDismissed = false // a new timer brings the floating timer back
    tray.update(timer)
    syncWidget()
  })

  ipcMain.handle(IPC.getSettings, () => settings)
  ipcMain.handle(IPC.setSettings, (_e, patch: unknown) => {
    const before = settings
    settings = sanitizeDesktopSettings(settings, patch)
    writeJson(userFile('settings.json'), settings)
    applyAutoStart()
    syncTracking()
    if (settings.widget !== before.widget) widgetDismissed = false
    if (settings.shortcuts !== before.shortcuts) applyShortcuts()
    syncWidget()
    widgetWin?.webContents.send(IPC.dataChangedEvent) // the floating timer re-reads its style at once
    return settings
  })

  ipcMain.on(IPC.signedIn, (_e, v: unknown) => {
    signedIn = v === true
    syncTracking()
    if (!signedIn) {
      idle.reset()
      quickWin?.hide()
    }
    syncWidget()
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
  ipcMain.handle(IPC.pull, () => tracker.drain())
  ipcMain.on(IPC.requeue, (_e, samples: ActivitySample[]) => {
    if (Array.isArray(samples)) tracker.requeue(samples.filter((s) => isStr(s?.id, 64) && isStr(s?.app, 120) && typeof s.seconds === 'number'))
  })

  ipcMain.handle(IPC.updateStatus, () => lastUpdate)
  ipcMain.handle(IPC.checkUpdates, () => updater.check())
  ipcMain.on(IPC.installUpdate, () => {
    quitting = true
    updater.install()
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
        lastUpdate = s
        win?.webContents.send(IPC.updateEvent, s)
      },
    })
    registerIpc(tray, updater)
    applyAutoStart()
    createWindow()
    applyShortcuts()
    startTimers()
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
