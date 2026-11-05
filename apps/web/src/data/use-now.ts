import { useEffect, useState } from 'react'

/** Current time, refreshed every second while `active` (a timer is running), else every minute. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), active ? 1000 : 60_000)
    return () => clearInterval(t)
  }, [active])
  return now
}
