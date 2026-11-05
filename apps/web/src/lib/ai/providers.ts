import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createOpenAI } from '@ai-sdk/openai'
import { createXai } from '@ai-sdk/xai'
import type { LanguageModel } from 'ai'

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'groq' | 'xai'

export interface ProviderInfo {
  id: ProviderId
  name: string
  keyHint: string
  keyUrl: string
  /** Starting suggestions. The real list is fetched with your key; you can also type any model id. */
  suggested: string[]
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'openai', name: 'OpenAI', keyHint: 'sk-...', keyUrl: 'https://platform.openai.com/api-keys', suggested: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'] },
  { id: 'anthropic', name: 'Anthropic', keyHint: 'sk-ant-...', keyUrl: 'https://console.anthropic.com/settings/keys', suggested: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'] },
  { id: 'google', name: 'Google Gemini', keyHint: 'AIza...', keyUrl: 'https://aistudio.google.com/apikey', suggested: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { id: 'groq', name: 'Groq', keyHint: 'gsk_...', keyUrl: 'https://console.groq.com/keys', suggested: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'] },
  { id: 'xai', name: 'xAI Grok', keyHint: 'xai-...', keyUrl: 'https://console.x.ai', suggested: ['grok-4', 'grok-3-mini'] },
]

export const providerName = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)?.name ?? id

/** Builds a model that talks straight to the provider with the user's own key. */
export function buildModel(provider: ProviderId, modelId: string, apiKey: string): LanguageModel {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey })(modelId)
    case 'anthropic':
      return createAnthropic({ apiKey, headers: { 'anthropic-dangerous-direct-browser-access': 'true' } })(modelId)
    case 'google':
      return createGoogle({ apiKey })(modelId)
    case 'groq':
      return createGroq({ apiKey })(modelId)
    case 'xai':
      return createXai({ apiKey })(modelId)
  }
}

/** Lists model ids for a key. Falls back to the suggestions if the provider blocks browser calls. */
export async function fetchModels(provider: ProviderId, apiKey: string): Promise<string[]> {
  const fallback = PROVIDERS.find((p) => p.id === provider)?.suggested ?? []
  try {
    if (provider === 'google') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`)
      if (!res.ok) return fallback
      const json = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
      const ids = (json.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name.replace('models/', ''))
        .filter((id) => id.startsWith('gemini'))
      return ids.length ? ids : fallback
    }
    const urls = {
      openai: 'https://api.openai.com/v1/models',
      anthropic: 'https://api.anthropic.com/v1/models?limit=100',
      groq: 'https://api.groq.com/openai/v1/models',
      xai: 'https://api.x.ai/v1/models',
    } as const
    const headers: Record<string, string> =
      provider === 'anthropic'
        ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
        : { Authorization: `Bearer ${apiKey}` }
    const res = await fetch(urls[provider], { headers })
    if (!res.ok) return fallback
    const json = (await res.json()) as { data?: { id: string }[] }
    let ids = (json.data ?? []).map((m) => m.id)
    if (provider === 'openai') ids = ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(embed|audio|realtime|image|tts|whisper|transcribe|moderation|search)/.test(id))
    if (provider === 'groq') ids = ids.filter((id) => !/(whisper|tts|guard|playai)/.test(id))
    return ids.length ? ids.sort() : fallback
  } catch {
    return fallback
  }
}
