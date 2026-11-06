import { createHash } from 'node:crypto'
import { Memory } from 'mem0ai/oss'
import type { AiProvider } from '../validators/index.ts'

export interface MemoryItem {
  id: string
  text: string
}
export type ProviderKeys = Partial<Record<AiProvider, string>>
export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Long-term memory for the assistant, one pool per user. The real implementation is the mem0 open
 * source SDK storing vectors in Neon (pgvector). Tests use a fake with the same interface.
 */
export interface MemoryProvider {
  /** Whether memory can work with the keys this user has saved. */
  enabled(keys: ProviderKeys): boolean
  search(userId: string, keys: ProviderKeys, query: string, limit?: number): Promise<MemoryItem[]>
  remember(userId: string, keys: ProviderKeys, turns: Turn[]): Promise<void>
  list(userId: string, keys: ProviderKeys): Promise<MemoryItem[]>
  forget(userId: string, keys: ProviderKeys, id: string): Promise<boolean>
  /** Removes everything remembered about this user (when the account is deleted). */
  forgetAll(userId: string, keys: ProviderKeys): Promise<void>
}

export const noMemory: MemoryProvider = {
  enabled: () => false,
  search: async () => [],
  remember: async () => {},
  list: async () => [],
  forget: async () => false,
  forgetAll: async () => {},
}

/**
 * mem0 needs an embeddings provider. Supported: OpenAI (text-embedding-3-small, 1536 dimensions) and Google
 * Gemini (gemini-embedding-001 at 768 dimensions). OpenAI is preferred when both keys exist. Each setup has
 * its own table, because vector sizes differ. Without either key, memory stays off and the assistant still works.
 */
/** Which provider handles memory for these keys, or null when none can. Exported so it can be tested. */
export function memorySetup(keys: ProviderKeys) {
  if (keys.openai) return { embedder: 'openai' as const, apiKey: keys.openai, embeddingModel: 'text-embedding-3-small', dims: 1536, llmModel: 'gpt-4.1-mini' }
  if (keys.google) return { embedder: 'gemini' as const, apiKey: keys.google, embeddingModel: 'gemini-embedding-001', dims: 768, llmModel: 'gemini-2.5-flash' }
  return null
}

export function createMem0Memory(databaseUrl: string): MemoryProvider {
  const instances = new Map<string, Memory>()

  function instance(keys: ProviderKeys): Memory | null {
    const setup = memorySetup(keys)
    if (!setup) return null
    const id = createHash('sha256').update(setup.apiKey).digest('hex').slice(0, 16)
    let m = instances.get(id)
    if (!m) {
      m = new Memory({
        version: 'v1.1',
        embedder: { provider: setup.embedder, config: { apiKey: setup.apiKey, model: setup.embeddingModel, embeddingDims: setup.dims } },
        vectorStore: {
          provider: 'pgvector',
          config: { collectionName: 'timedesk_memories_' + setup.dims, embeddingModelDims: setup.dims, dimension: setup.dims, connectionString: databaseUrl },
        },
        llm: { provider: setup.embedder, config: { apiKey: setup.apiKey, model: setup.llmModel } },
        disableHistory: true,
      })
      instances.set(id, m)
    }
    return m
  }

  const toItem = (r: { id: string; memory: string }): MemoryItem => ({ id: r.id, text: r.memory })

  return {
    enabled: (keys) => memorySetup(keys) !== null,
    async search(userId, keys, query, limit = 5) {
      const m = instance(keys)
      if (!m) return []
      return (await m.search(query, { topK: limit, filters: { user_id: userId } })).results.map(toItem)
    },
    async remember(userId, keys, turns) {
      const m = instance(keys)
      if (!m) return
      await m.add(turns, { userId })
    },
    async list(userId, keys) {
      const m = instance(keys)
      if (!m) return []
      return (await m.getAll({ filters: { user_id: userId } })).results.map(toItem)
    },
    async forget(userId, keys, id) {
      const m = instance(keys)
      if (!m) return false
      // mem0 deletes by id only, so confirm the memory belongs to this user first.
      const mine = (await m.getAll({ filters: { user_id: userId } })).results.some((r) => r.id === id)
      if (!mine) return false
      await m.delete(id)
      return true
    },
    async forgetAll(userId, keys) {
      const m = instance(keys)
      if (!m) return
      await m.deleteAll({ userId })
    },
  }
}
