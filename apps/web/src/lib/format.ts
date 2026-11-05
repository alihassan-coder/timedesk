/** "5 min ago", "2 h ago", "yesterday", "3 days ago". */
export function timeAgo(at: number, now = Date.now()): string {
  const mins = Math.round((now - at) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export const clock = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

export const hoursOf = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10
