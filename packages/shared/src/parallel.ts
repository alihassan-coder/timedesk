import type { TimeEntry } from './types.ts'

/**
 * Multitasking: several timers may run at once (for example a render running while you answer email). Every total
 * in the app must still match the clock, so time when timers overlap is shared evenly between them: an hour with two
 * timers counts as 30 minutes for each, and the day still adds up to one hour.
 *
 * splitParallel turns entries into "pieces" that carry a `share` (1/k while k timers ran). Pieces never need `now`:
 * the timeline is only cut where a timer started or stopped, and the last piece of a running timer stays open
 * (endedAt null), so the same pieces stay correct while the clock moves. entryDuration and overlapMs apply the share.
 */
export function splitParallel(entries: TimeEntry[]): TimeEntry[] {
  // Already split, or nothing that can overlap: return as is (the common case costs one sort).
  if (entries.length < 2 || entries.some((e) => e.share !== undefined)) return entries
  const sorted = [...entries].sort((a, b) => a.startedAt - b.startedAt)
  let overlaps = false
  let reach = -Infinity
  for (const e of sorted) {
    if (e.startedAt < reach) {
      overlaps = true
      break
    }
    reach = Math.max(reach, e.endedAt ?? Infinity)
  }
  if (!overlaps) return entries

  // Only groups of timers that overlap each other are cut; everything else is kept as it is.
  const out: TimeEntry[] = []
  let group: TimeEntry[] = []
  let groupEnd = -Infinity
  const flush = () => {
    if (group.length === 1) out.push(group[0])
    else if (group.length > 1) out.push(...cutGroup(group))
    group = []
  }
  for (const e of sorted) {
    if (group.length && e.startedAt >= groupEnd) flush()
    group.push(e)
    groupEnd = Math.max(group.length === 1 ? -Infinity : groupEnd, e.endedAt ?? Infinity)
  }
  flush()
  return out
}

/** Cuts one group of overlapping timers at every start and end, and shares each piece of time between the timers in it. */
function cutGroup(group: TimeEntry[]): TimeEntry[] {
  const endOf = (e: TimeEntry) => e.endedAt ?? Infinity
  const cuts = [...new Set(group.flatMap((e) => [e.startedAt, endOf(e)]))].sort((a, b) => a - b)
  const pieces: TimeEntry[] = []
  for (const e of group) {
    if (endOf(e) <= e.startedAt) {
      pieces.push(e)
      continue
    }
    const bounds = [e.startedAt, ...cuts.filter((c) => c > e.startedAt && c < endOf(e)), endOf(e)]
    for (let i = 0; i < bounds.length - 1; i++) {
      const from = bounds[i]
      const to = bounds[i + 1]
      const k = group.filter((o) => o.startedAt <= from && endOf(o) >= to && endOf(o) > o.startedAt).length
      pieces.push({ ...e, id: `${e.id}#${i}`, startedAt: from, endedAt: to === Infinity ? null : to, share: 1 / Math.max(1, k) })
    }
  }
  return pieces
}

/** Milliseconds within [from, to) when two or more timers ran at once: how much you multitasked. */
export function multitaskMs(entries: TimeEntry[], from: number, to: number, now: number): number {
  const real = entries.filter((e) => e.share === undefined)
  const events = real.flatMap((e) => {
    const s = Math.max(e.startedAt, from)
    const t = Math.min(e.endedAt ?? now, to)
    return t > s ? [{ at: s, d: 1 }, { at: t, d: -1 }] : []
  })
  events.sort((a, b) => a.at - b.at || a.d - b.d)
  let active = 0
  let since = 0
  let total = 0
  for (const ev of events) {
    if (active >= 2) total += ev.at - since
    active += ev.d
    since = ev.at
  }
  return total
}

/** The timers running right now, newest first. */
export const runningEntries = (entries: TimeEntry[]) => entries.filter((e) => e.endedAt === null && e.share === undefined).sort((a, b) => b.startedAt - a.startedAt)
