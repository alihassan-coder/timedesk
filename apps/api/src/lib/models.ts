import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createOpenAI } from '@ai-sdk/openai'
import { createXai } from '@ai-sdk/xai'
import type { LanguageModel } from 'ai'
import type { AiProvider } from '../validators/index.ts'

/** Builds a language model for a provider using the user's own API key. Tests pass a mock instead. */
export type ModelFactory = (provider: AiProvider, modelId: string, apiKey: string) => LanguageModel

export const realModelFactory: ModelFactory = (provider, modelId, apiKey) => {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey })(modelId)
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId)
    case 'google':
      return createGoogle({ apiKey })(modelId)
    case 'groq':
      return createGroq({ apiKey })(modelId)
    case 'xai':
      return createXai({ apiKey })(modelId)
  }
}

export const PROVIDER_NAMES: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  groq: 'Groq',
  xai: 'xAI Grok',
}

/** Fallback list if a provider will not list its models. The real list is fetched with the user's key. */
export const SUGGESTED_MODELS: Record<AiProvider, string[]> = {
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
  anthropic: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  groq: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
  xai: ['grok-4', 'grok-3-mini'],
}

/** How long a provider gets to list its models before the suggestions are used instead. */
const LIST_TIMEOUT_MS = 5_000

/**
 * Lists model ids that a key can use. Never throws and never hangs: on any problem, including a provider that does not
 * answer within 5 seconds, it returns the suggestions.
 */
export async function listModels(provider: AiProvider, apiKey: string): Promise<string[]> {
  const fallback = SUGGESTED_MODELS[provider]
  const signal = AbortSignal.timeout(LIST_TIMEOUT_MS)
  try {
    if (provider === 'google') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=100`, { headers: { 'x-goog-api-key': apiKey }, signal })
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
      provider === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${apiKey}` }
    const res = await fetch(urls[provider], { headers, signal })
    if (!res.ok) return fallback
    const json = (await res.json()) as { data?: { id: string }[] }
    let ids = (json.data ?? []).map((m) => m.id)
    if (provider === 'openai') ids = ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(embed|audio|realtime|image|tts|whisper|transcribe|moderation|search)/.test(id))
    if (provider === 'groq') ids = ids.filter((id) => !/(whisper|tts|guard|playai|orpheus|transcribe)/.test(id))
    return ids.length ? ids.sort() : fallback
  } catch {
    // Network failure, a timeout (the abort also stops reading a slow body), or an answer that is not JSON.
    return fallback
  }
}
