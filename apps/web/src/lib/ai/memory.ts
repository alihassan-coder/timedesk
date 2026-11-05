/**
 * Agent memory behind one small interface. INTERIM implementation: facts kept in localStorage with
 * keyword search. Phase 2 replaces it with the mem0 open source SDK on the API server, storing
 * vectors in Neon (pgvector), so the agent code does not change.
 */
export interface MemoryItem {
  id: string
  text: string
  at: number
}

export interface MemoryStore {
  add(text: string): MemoryItem
  search(query: string, limit?: number): MemoryItem[]
  list(): MemoryItem[]
  remove(id: string): void
}

const KEY = 'timedesk:agent-memory'

function read(): MemoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as MemoryItem[]
  } catch {
    return []
  }
}
function write(items: MemoryItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

const words = (s: string) => s.toLowerCase().split(/\W+/).filter((w) => w.length > 2)

export const memory: MemoryStore = {
  add(text) {
    const item = { id: crypto.randomUUID(), text: text.trim(), at: Date.now() }
    write([item, ...read()].slice(0, 200))
    return item
  },
  search(query, limit = 5) {
    const q = new Set(words(query))
    return read()
      .map((m) => ({ m, score: words(m.text).filter((w) => q.has(w)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.m.at - a.m.at)
      .slice(0, limit)
      .map((x) => x.m)
  },
  list: read,
  remove(id) {
    write(read().filter((m) => m.id !== id))
  },
}
