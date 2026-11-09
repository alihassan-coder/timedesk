import { api } from '@/lib/api'
import { getAppearance, replaceAppearance, subscribeAppearance, type Appearance } from '@/lib/appearance'
import { getAiPrefs, replaceAiPrefs, subscribeAiPrefs, type AiPrefs } from '@/lib/ai/settings'
import { getNotifyPrefs, replaceNotifyPrefs, subscribeNotifyPrefs, type NotifyPrefs } from '@/lib/notify'
import { getTimerPrefs, replaceTimerPrefs, subscribeTimerPrefs, type TimerPrefs } from '@/lib/timer-prefs'

/**
 * Keeps appearance and assistant preferences the same on every device, local-first:
 *  - this device always applies its own choices at once (no waiting for the network)
 *  - the choices are saved to the database a moment after you stop changing things
 *  - on start, the newer side wins: a change made on another device is applied here, and a change
 *    made here while offline is uploaded.
 */
interface Remote {
  data: { appearance?: Partial<Appearance>; aiPrefs?: Partial<AiPrefs>; notifications?: Partial<NotifyPrefs>; timer?: Partial<TimerPrefs> }
  updatedAt: string | null
}

const metaKey = (userId: string) => `timedesk:settings-meta:${userId}`

function readMeta(userId: string): number {
  try {
    return Number(localStorage.getItem(metaKey(userId))) || 0
  } catch {
    return 0
  }
}
function writeMeta(userId: string, at: number) {
  try {
    localStorage.setItem(metaKey(userId), String(at))
  } catch {
    // ignore
  }
}

let stop: (() => void) | null = null
// Bumped by every start and stop. A sync whose number is no longer current was cancelled while it waited
// for the network, and must not apply settings or subscribe (that would leak listeners or mix two people).
let generation = 0

export async function startSettingsSync(userId: string) {
  stop?.()
  stop = null
  const mine = ++generation

  let applyingRemote = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const upload = () =>
    api('/settings', { method: 'PATCH', body: { appearance: getAppearance(), aiPrefs: getAiPrefs(), notifications: getNotifyPrefs(), timer: getTimerPrefs() } }).catch(() => {
      // offline: the local timestamp stays newer, so it uploads on the next start
    })

  const onLocalChange = () => {
    if (applyingRemote) return
    writeMeta(userId, Date.now())
    clearTimeout(timer)
    timer = setTimeout(upload, 600)
  }

  try {
    const remote = await api<Remote>('/settings')
    if (mine !== generation) return
    const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0
    const hasRemote = Object.keys(remote.data).length > 0

    if (hasRemote && remoteTime > readMeta(userId)) {
      applyingRemote = true
      if (remote.data.appearance) replaceAppearance(remote.data.appearance)
      if (remote.data.aiPrefs) replaceAiPrefs(remote.data.aiPrefs)
      if (remote.data.notifications) replaceNotifyPrefs(remote.data.notifications)
      if (remote.data.timer) replaceTimerPrefs(remote.data.timer)
      applyingRemote = false
      writeMeta(userId, remoteTime)
    } else if (!hasRemote || readMeta(userId) > remoteTime) {
      await upload()
    }
  } catch {
    // offline: keep using local settings
  }
  if (mine !== generation) return

  const offA = subscribeAppearance(onLocalChange)
  const offB = subscribeAiPrefs(onLocalChange)
  const offC = subscribeNotifyPrefs(onLocalChange)
  const offD = subscribeTimerPrefs(onLocalChange)
  stop = () => {
    offA()
    offB()
    offC()
    offD()
    clearTimeout(timer)
  }
}

export function stopSettingsSync() {
  generation++
  stop?.()
  stop = null
}
