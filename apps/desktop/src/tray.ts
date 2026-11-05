import { Menu, Tray, nativeImage, type NativeImage } from 'electron'
import type { TimerState } from './bridge.ts'

export interface TrayHandlers {
  open: () => void
  toggleTimer: () => void
  quit: () => void
}

const elapsed = (startedAt: number | null) => {
  if (!startedAt) return ''
  const mins = Math.max(0, Math.floor((Date.now() - startedAt) / 60_000))
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`
}

/** System tray icon with the running timer in its tooltip and a small menu. */
export function createTray(icon: NativeImage | string, handlers: TrayHandlers) {
  const image = typeof icon === 'string' ? nativeImage.createFromPath(icon) : icon
  const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  let timer: TimerState = { running: false, label: '', startedAt: null }

  function refresh() {
    const status = timer.running ? `Timer running: ${timer.label || 'Stopwatch'} (${elapsed(timer.startedAt)})` : 'No timer running'
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
