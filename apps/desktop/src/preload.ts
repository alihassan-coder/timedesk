import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type DesktopSettings, type IdleDecision, type TimedeskBridge, type TimerState, type TrayAction, type UpdateStatus } from './bridge.ts'
import type { ActivitySample } from './tracker.ts'

/** The only thing the web page can reach. Everything goes through named, validated messages. */
const bridge: TimedeskBridge = {
  isDesktop: true,
  tokens: {
    get: () => ipcRenderer.invoke(IPC.tokenGet),
    set: (token: string) => ipcRenderer.invoke(IPC.tokenSet, token),
    clear: () => ipcRenderer.invoke(IPC.tokenClear),
  },
  info: () => ipcRenderer.invoke(IPC.info),
  notify: (title: string, body: string) => ipcRenderer.invoke(IPC.notify, { title, body }),
  setTimerState: (state: TimerState) => ipcRenderer.send(IPC.timer, state),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch: Partial<DesktopSettings>) => ipcRenderer.invoke(IPC.setSettings, patch),
  setSignedIn: (signedIn: boolean) => ipcRenderer.send(IPC.signedIn, signedIn),
  pullActivity: () => ipcRenderer.invoke(IPC.pull),
  requeueActivity: (samples: ActivitySample[]) => ipcRenderer.send(IPC.requeue, samples),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.updateStatus),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkUpdates),
  installUpdate: () => ipcRenderer.send(IPC.installUpdate),
  onUpdate(cb: (status: UpdateStatus) => void) {
    const handler = (_: unknown, status: UpdateStatus) => cb(status)
    ipcRenderer.on(IPC.updateEvent, handler)
    return () => ipcRenderer.removeListener(IPC.updateEvent, handler)
  },
  hideWidget: () => ipcRenderer.send(IPC.widgetHide),
  openMainWindow: () => ipcRenderer.send(IPC.openMain),
  closeOwnWindow: () => ipcRenderer.send(IPC.closeOwn),
  dataChanged: () => ipcRenderer.send(IPC.dataChanged),
  onDataChanged(cb: () => void) {
    const handler = () => cb()
    ipcRenderer.on(IPC.dataChangedEvent, handler)
    return () => ipcRenderer.removeListener(IPC.dataChangedEvent, handler)
  },
  onIdleDecision(cb: (d: IdleDecision) => void) {
    const handler = (_: unknown, d: IdleDecision) => cb(d)
    ipcRenderer.on(IPC.idleDecision, handler)
    return () => ipcRenderer.removeListener(IPC.idleDecision, handler)
  },
  onQuickAddShown(cb: () => void) {
    const handler = () => cb()
    ipcRenderer.on(IPC.quickAddShown, handler)
    return () => ipcRenderer.removeListener(IPC.quickAddShown, handler)
  },
  onTrayAction(cb: (action: TrayAction) => void) {
    const handler = (_: unknown, action: TrayAction) => cb(action)
    ipcRenderer.on(IPC.trayAction, handler)
    return () => ipcRenderer.removeListener(IPC.trayAction, handler)
  },
}

contextBridge.exposeInMainWorld('timedesk', bridge)
// Used only by the built-in "can't connect" page.
contextBridge.exposeInMainWorld('timedeskOffline', { retry: () => ipcRenderer.send(IPC.retry) })
