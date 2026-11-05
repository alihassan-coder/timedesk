export type ProviderId = 'openai' | 'anthropic' | 'google' | 'groq' | 'xai'

export interface ProviderInfo {
  id: ProviderId
  name: string
  keyHint: string
  keyUrl: string
}

/** Display info only. Keys live encrypted on the server and models are listed by the API. */
export const PROVIDERS: ProviderInfo[] = [
  { id: 'openai', name: 'OpenAI', keyHint: 'sk-...', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic', keyHint: 'sk-ant-...', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'google', name: 'Google Gemini', keyHint: 'AIza...', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq', name: 'Groq', keyHint: 'gsk_...', keyUrl: 'https://console.groq.com/keys' },
  { id: 'xai', name: 'xAI Grok', keyHint: 'xai-...', keyUrl: 'https://console.x.ai' },
]

export const providerName = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)?.name ?? id
