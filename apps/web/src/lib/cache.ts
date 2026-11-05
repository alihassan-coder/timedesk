/**
 * Local cache so screens open instantly. The database stays the source of truth: every cached
 * value is shown first, then replaced by what the server says. Keys are per signed-in user, and
 * everything is wiped on sign out so a shared computer never shows the previous person's data.
 */
const PREFIX = 'timedesk:cache:'

const key = (name: string, userId: string) => `${PREFIX}${name}:${userId}`

export function readCache<T>(name: string, userId: string): T | null {
  try {
    const raw = localStorage.getItem(key(name, userId))
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Writes after a short pause, so rapid updates (typing, timers) cost one write instead of many. */
export function writeCache(name: string, userId: string, value: unknown, delay = 250) {
  const k = key(name, userId)
  clearTimeout(timers.get(k))
  timers.set(
    k,
    setTimeout(() => {
      try {
        localStorage.setItem(k, JSON.stringify(value))
      } catch {
        // storage full or blocked: the app still works, just without the speed-up
      }
    }, delay),
  )
}

export function clearAllCaches() {
  try {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX) || k?.startsWith('timedesk:settings-meta:')) localStorage.removeItem(k)
    }
  } catch {
    // ignore
  }
}
