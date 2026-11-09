import { Menu, Tray, nativeImage, type NativeImage } from 'electron'
import type { TimerState } from './bridge.ts'
import { trayStatus } from './widgets.ts'

export interface TrayHandlers {
  open: () => void
  toggleTimer: () => void
  quit: () => void
}

/** System tray icon with the running timer in its tooltip and a small menu. */
export function createTray(icon: NativeImage | string, handlers: TrayHandlers) {
  const image = typeof icon === 'string' ? nativeImage.createFromPath(icon) : icon
  const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  let timer: TimerState = { running: false, label: '', startedAt: null }
  let shown: string | null = null

  function refresh() {
    const status = trayStatus(timer, Date.now())
    // The menu is rebuilt only when what it shows changed (the line of text also tells whether the timer runs).
    if (status === shown) return
    shown = status
    tray.setToolTip(`timedesk\n${status}`)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open timedesk', click: handlers.open },
        { type: 'separator' },
        { label: status, enabled: false },
        { label: timer.running ? 'Stop timer' : 'Start stopwatch', click: handlers.toggleTimer },
        { type: 'separator' },
        { label: 'Quit timedesk', click: handlers.quit },
      ]),
    )
  }

  tray.on('click', handlers.open)
  refresh()
  const ticker = setInterval(refresh, 30_000)

  return {
    update(state: TimerState) {
      timer = state
      refresh()
    },
    destroy() {
      clearInterval(ticker)
      tray.destroy()
    },
  }
}
