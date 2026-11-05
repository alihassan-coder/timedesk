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
}

export const noMemory: MemoryProvider = {
  enabled: () => false,
  search: async () => [],
  remember: async () => {},
  list: async () => [],
  forget: async () => false,
}

/**
 * mem0 needs an embeddings provider. For now that is OpenAI (text-embedding-3-small, 1536 dimensions);
 * without an OpenAI key, memory stays off and the assistant still works.
 */
export function createMem0Memory(databaseUrl: string): MemoryProvider {
  const instances = new Map<string, Memory>()

  function instance(keys: ProviderKeys): Memory | null {
    const apiKey = keys.openai
    if (!apiKey) return null
    const id = createHash('sha256').update(apiKey).digest('hex').slice(0, 16)
    let m = instances.get(id)
    if (!m) {
      m = new Memory({
        version: 'v1.1',
        embedder: { provider: 'openai', config: { apiKey, model: 'text-embedding-3-small', embeddingDims: 1536 } },
        vectorStore: { provider: 'pgvector', config: { collectionName: 'timedesk_memories_1536', embeddingModelDims: 1536, dimension: 1536, connectionString: databaseUrl } },
        llm: { provider: 'openai', config: { apiKey, model: 'gpt-4.1-mini' } },
        disableHistory: true,
      })
      instances.set(id, m)
    }
    return m
  }

  const toItem = (r: { id: string; memory: string }): MemoryItem => ({ id: r.id, text: r.memory })

  return {
    enabled: (keys) => !!keys.openai,
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
  }
}
