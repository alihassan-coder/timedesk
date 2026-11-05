import { useSyncExternalStore } from 'react'
import { PROVIDERS, type ProviderId } from './providers'

/**
 * AI settings. INTERIM: stored in this browser's localStorage. When the API exists (phase 2),
 * keys move to encrypted storage on the server in Neon and never touch the browser again.
 */
export interface AiSettings {
  keys: Partial<Record<ProviderId, string>>
  /** Model ids fetched with each key (cached so the picker is instant). */
  models: Partial<Record<ProviderId, string[]>>
  selected: { provider: ProviderId; model: string } | null
  voice: { speakReplies: boolean; autoSend: boolean; lang: string; rate: number }
}

const KEY = 'timedesk:ai'
const DEFAULTS: AiSettings = {
  keys: {},
  models: {},
  selected: null,
  voice: { speakReplies: true, autoSend: true, lang: 'en-US', rate: 1 },
}

function load(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiSettings>
      return { ...DEFAULTS, ...parsed, voice: { ...DEFAULTS.voice, ...parsed.voice } }
    }
  } catch {
    // blocked or corrupt storage: start empty
  }
  return DEFAULTS
}

let state = load()
const listeners = new Set<() => void>()

function set(next: AiSettings) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

export function useAiSettings(): AiSettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export const getAiSettings = () => state

export const aiActions = {
  setKey(provider: ProviderId, key: string) {
    const keys = { ...state.keys }
    const trimmed = key.trim()
    if (trimmed) keys[provider] = trimmed
    else delete keys[provider]
    const selected = state.selected?.provider === provider && !trimmed ? null : state.selected
    set({ ...state, keys, selected })
  },
  setModels(provider: ProviderId, models: string[]) {
    set({ ...state, models: { ...state.models, [provider]: models } })
  },
  select(provider: ProviderId, model: string) {
    set({ ...state, selected: { provider, model } })
  },
  setVoice(patch: Partial<AiSettings['voice']>) {
    set({ ...state, voice: { ...state.voice, ...patch } })
  },
  clearAll() {
    set(DEFAULTS)
  },
}

/** Providers that have a key, with their model lists (cached or suggested). */
export function availableModels(s: AiSettings) {
  return PROVIDERS.filter((p) => s.keys[p.id]).map((p) => ({
    provider: p,
    models: s.models[p.id]?.length ? s.models[p.id]! : p.suggested,
  }))
}
