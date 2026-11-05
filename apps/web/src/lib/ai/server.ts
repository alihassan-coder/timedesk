import { useEffect, useSyncExternalStore } from 'react'
import { api, ApiError } from '@/lib/api'
import { readCache, writeCache } from '@/lib/cache'
import type { ProviderId } from './providers'
import { aiActions, useAiPrefs } from './settings'

export interface SavedKey {
  provider: ProviderId
  last4: string
}
export interface ProviderModels {
  provider: ProviderId
  name: string
  models: string[]
}
export interface MemoryItem {
  id: string
  text: string
}

interface State {
  loaded: boolean
  keys: SavedKey[]
  providers: ProviderModels[]
  memoryEnabled: boolean
  error: string
}

let state: State = { loaded: false, keys: [], providers: [], memoryEnabled: false, error: '' }
let userId: string | null = null
const listeners = new Set<() => void>()
function set(next: Partial<State>) {
  state = { ...state, ...next }
  if (userId && state.loaded && !state.error) writeCache('ai', userId, { keys: state.keys, providers: state.providers, memoryEnabled: state.memoryEnabled })
  listeners.forEach((l) => l())
}

/** Loads which keys are saved (last 4 characters only) and the models each one can use. */
export async function refreshAi() {
  try {
    const [keys, models] = await Promise.all([
      api<{ keys: SavedKey[] }>('/ai/keys'),
      api<{ providers: ProviderModels[]; memory: { enabled: boolean } }>('/assistant/models'),
    ])
    set({ loaded: true, keys: keys.keys, providers: models.providers, memoryEnabled: models.memory.enabled, error: '' })
  } catch (e) {
    set({ loaded: true, error: e instanceof ApiError ? e.message : 'Could not reach the server.' })
  }
}

/** Shows the cached keys and models at once (model lists are slow to fetch), then refreshes them. */
export function bindAi(id: string) {
  if (userId === id) return
  userId = id
  const cached = readCache<Pick<State, 'keys' | 'providers' | 'memoryEnabled'>>('ai', id)
  if (cached) set({ ...cached, loaded: true, error: '' })
  void refreshAi()
}

export async function saveKey(provider: ProviderId, key: string) {
  await api(`/ai/keys/${provider}`, { method: 'PUT', body: { key } })
  await refreshAi()
}

export async function removeKey(provider: ProviderId) {
  await api(`/ai/keys/${provider}`, { method: 'DELETE' })
  await refreshAi()
}

export const listMemories = () => api<{ memories: MemoryItem[] }>('/assistant/memories').then((r) => r.memories)
export const forgetMemory = (id: string) => api(`/assistant/memories/${id}`, { method: 'DELETE' })

export function resetAi() {
  userId = null
  set({ loaded: false, keys: [], providers: [], memoryEnabled: false, error: '' })
}

/** Keys and models for the signed-in person, loaded once and shared by every screen. */
export function useAi() {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
  useEffect(() => {
    if (!state.loaded) void refreshAi()
  }, [])

  const prefs = useAiPrefs()
  const all = s.providers.flatMap((p) => p.models.map((model) => ({ provider: p.provider, name: p.name, model })))
  // Use the chosen model if it is still available, otherwise the first one we can offer.
  const current = all.find((m) => m.provider === prefs.selected?.provider && m.model === prefs.selected?.model) ?? all[0] ?? null

  return { ...s, current, select: aiActions.select, hasKey: s.providers.length > 0 }
}
