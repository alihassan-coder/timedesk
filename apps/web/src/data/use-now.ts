import { useEffect, useState } from 'react'

/**
 * Current time, refreshed every second while `active` (a timer is running), else every minute. Ticks are lined up
 * with the clock (on the second or the minute), so every live timer on screen changes at the same moment.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const step = active ? 1000 : 60_000
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(Date.now())
      timer = setTimeout(tick, step - (Date.now() % step) + 5)
    }
    timer = setTimeout(tick, step - (Date.now() % step) + 5)
    return () => clearTimeout(timer)
  }, [active])
  return now
}
