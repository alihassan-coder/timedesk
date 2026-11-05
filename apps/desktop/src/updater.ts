import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from './bridge.ts'

const FOUR_HOURS = 4 * 60 * 60 * 1000

/**
 * New versions come from GitHub Releases. The app downloads them quietly and tells the web UI
 * "version X is ready"; the person chooses when to restart. Installed .deb packages cannot update
 * themselves (use the AppImage, or reinstall the .deb); Windows and AppImage update in place.
 *
 * TIMEDESK_FAKE_UPDATE=0.2.0 pretends an update arrived, to try the banner without publishing anything.
 */
export function setupUpdater(opts: { packaged: boolean; send: (s: UpdateStatus) => void; log: (msg: string) => void }) {
  const fake = process.env.TIMEDESK_FAKE_UPDATE

  if (!opts.packaged) {
    if (fake) {
      setTimeout(() => opts.send({ state: 'downloading', version: fake }), 800)
      setTimeout(() => opts.send({ state: 'ready', version: fake }), 1800)
    }
    return { check: async () => {}, install: () => opts.log('update install ignored: not a packaged app') }
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: opts.log, warn: opts.log, error: opts.log, debug: () => {} }

  autoUpdater.on('update-available', (info) => opts.send({ state: 'downloading', version: info.version }))
  autoUpdater.on('update-downloaded', (info) => opts.send({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => {
    opts.log(`update error: ${err.message}`)
    opts.send({ state: 'error', message: err.message })
  })

  const check = async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      opts.log(`update check failed: ${(err as Error).message}`)
    }
  }
  setTimeout(check, 10_000)
  setInterval(check, FOUR_HOURS)

  return { check, install: () => autoUpdater.quitAndInstall(false, true) }
}
