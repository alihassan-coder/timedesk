import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { BrowserWindow, Notification, app, ipcMain, nativeImage, powerMonitor, screen, session, shell } from 'electron'
import { linuxAutostartEntry, linuxAutostartPath } from './autostart.ts'
import { DEFAULT_DESKTOP_SETTINGS, IPC, type AppInfo, type DesktopSettings, type TimerState, type UpdateStatus } from './bridge.ts'
import { isInternalUrl, isSafeExternalUrl, resolveConfig } from './config.ts'
import { createTracker, type ActivitySample, type ForegroundWindow } from './tracker.ts'
import { createTray } from './tray.ts'
import { setupUpdater } from './updater.ts'
import { sanitizeBounds, type Bounds } from './window-state.ts'

const APP_ID = 'com.timedesk.app'
const startHidden = process.argv.includes('--hidden')

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
})

let settings: DesktopSettings = { ...DEFAULT_DESKTOP_SETTINGS, ...(readJson<Partial<DesktopSettings>>(userFile('settings.json')) ?? {}) }

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
    icon: nativeImage.createFromPath(asset('icon.png')),
    autoHideMenuBar: true,
    webPreferences: { preload: asset('preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  })
  if (bounds.maximized) win.maximize()
  win.once('ready-to-show', () => {
    if (!startHidden) win?.show()
  })

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
  })

  // Only the timedesk site may load here. Other links open in the normal browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (isInternalUrl(url, config.webUrl) || url.startsWith('file:')) return
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
    void win?.loadFile(asset('offline.html'), { query: { url: config.webUrl } })
  })
  win.webContents.on('did-finish-load', () => {
    if (lastUpdate.state !== 'idle') win?.webContents.send(IPC.updateEvent, lastUpdate)
  })

  void win.loadURL(config.webUrl)
}

function showWindow() {
  if (!win) createWindow()
  if (win?.isMinimized()) win.restore()
  win?.show()
  win?.focus()
}

// ---- messages from the web app -------------------------------------------------------------------------
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max

function registerIpc(tray: ReturnType<typeof createTray>, updater: ReturnType<typeof setupUpdater>) {
  ipcMain.handle(IPC.info, (): AppInfo => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged, webUrl: config.webUrl }))

  ipcMain.handle(IPC.notify, (_e, p: { title?: unknown; body?: unknown }) => {
    if (!isStr(p?.title, 120) || !isStr(p?.body, 400) || !Notification.isSupported()) return
    const n = new Notification({ title: p.title, body: p.body, icon: nativeImage.createFromPath(asset('icon.png')) })
    n.on('click', showWindow)
    n.show()
  })

  ipcMain.on(IPC.timer, (_e, s: Partial<TimerState>) => {
    if (typeof s?.running !== 'boolean') return
    tray.update({ running: s.running, label: isStr(s.label, 200) ? s.label : '', startedAt: typeof s.startedAt === 'number' ? s.startedAt : null })
  })

  ipcMain.handle(IPC.getSettings, () => settings)
  ipcMain.handle(IPC.setSettings, (_e, patch: Partial<DesktopSettings>) => {
    const next = { ...settings }
    for (const k of Object.keys(DEFAULT_DESKTOP_SETTINGS) as (keyof DesktopSettings)[]) if (typeof patch?.[k] === 'boolean') next[k] = patch[k]
    settings = next
    writeJson(userFile('settings.json'), settings)
    applyAutoStart()
    syncTracking()
    return settings
  })

  ipcMain.on(IPC.signedIn, (_e, v: unknown) => {
    signedIn = v === true
    syncTracking()
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
  ipcMain.on(IPC.retry, () => void win?.loadURL(config.webUrl))
}

// ---- start ----------------------------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  void app.whenReady().then(() => {
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
    log(`started ${app.getVersion()} (${app.isPackaged ? 'packaged' : 'development'}) -> ${config.webUrl}`)
  })

  app.on('before-quit', () => {
    quitting = true
  })
  app.on('window-all-closed', () => {
    // Stay alive in the tray unless the person chose to quit.
    if (quitting || !settings.closeToTray) app.quit()
  })
  app.on('activate', showWindow)
}
