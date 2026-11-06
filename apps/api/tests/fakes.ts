import type { MemoryProvider } from '../src/lib/memory.ts'

/** In-memory stand-in for mem0, one pool per user. Same interface the real provider has. */
export function fakeMemory() {
  const pools = new Map<string, { id: string; text: string }[]>()
  const saved: { userId: string; turns: { role: string; content: string }[] }[] = []
  let searches = 0

  const memory: MemoryProvider = {
    enabled: (keys) => !!keys.openai,
    search: async (userId) => {
      searches++
      return pools.get(userId) ?? []
    },
    remember: async (userId, _keys, turns) => {
      saved.push({ userId, turns })
    },
    list: async (userId) => pools.get(userId) ?? [],
    forget: async (userId, _keys, id) => {
      const pool = pools.get(userId) ?? []
      if (!pool.some((m) => m.id === id)) return false
      pools.set(userId, pool.filter((m) => m.id !== id))
      return true
    },
    forgetAll: async (userId) => {
      pools.delete(userId)
    },
  }

  return {
    memory,
    saved,
    searchCount: () => searches,
    /** Pretend the assistant already remembers this about the user. */
    add(userId: string, text: string) {
      const pool = pools.get(userId) ?? []
      const item = { id: `${userId}-${pool.length}`, text }
      pools.set(userId, [...pool, item])
      return item.id
    },
  }
}
