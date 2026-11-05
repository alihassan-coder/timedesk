import { useSyncExternalStore } from 'react'
import type { ProviderId } from './providers'

/**
 * Per-device AI preferences only: which model is selected and the voice options.
 * API keys are NOT stored here. They are encrypted on the server (see server.ts).
 */
export interface AiPrefs {
  selected: { provider: ProviderId; model: string } | null
  voice: { speakReplies: boolean; autoSend: boolean; lang: string; rate: number }
}

const KEY = 'timedesk:ai-prefs'
const DEFAULTS: AiPrefs = { selected: null, voice: { speakReplies: true, autoSend: true, lang: 'en-US', rate: 1 } }

/** Older versions kept API keys, memory and chats in this browser. Remove those leftovers once. */
function removeLegacyStorage() {
  try {
    for (const k of ['timedesk:ai', 'timedesk:agent-memory', 'timedesk:chats', 'timedesk:v1', 'timedesk:theme']) localStorage.removeItem(k)
  } catch {
    // storage blocked: nothing to clean
  }
}

function load(): AiPrefs {
  removeLegacyStorage()
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<AiPrefs>
      return { ...DEFAULTS, ...p, voice: { ...DEFAULTS.voice, ...p.voice } }
    }
  } catch {
    // blocked or corrupt storage: use defaults
  }
  return DEFAULTS
}

let state = load()
const listeners = new Set<() => void>()

function set(next: AiPrefs) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

export function useAiPrefs(): AiPrefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export const aiActions = {
  select(provider: ProviderId, model: string) {
    set({ ...state, selected: { provider, model } })
  },
  setVoice(patch: Partial<AiPrefs['voice']>) {
    set({ ...state, voice: { ...state.voice, ...patch } })
  },
}

// ---- used by settings-sync.ts to keep these preferences identical across devices ----
export const getAiPrefs = () => state

export function subscribeAiPrefs(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function replaceAiPrefs(next: Partial<AiPrefs>) {
  set({ ...DEFAULTS, ...next, voice: { ...DEFAULTS.voice, ...next.voice } })
}
