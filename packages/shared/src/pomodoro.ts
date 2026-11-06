export interface PomodoroPhase {
  phase: 'focus' | 'break'
  /** Which focus round this is, starting at 1. */
  round: number
  /** Seconds left in this phase. */
  remaining: number
  /** Length of this phase in seconds. */
  total: number
}

/**
 * Where a Pomodoro cycle is, worked out only from when the timer started: focus for `focusMin`, then a break
 * of `breakMin`, over and over. No state to store, so every window agrees.
 */
export function pomodoroPhase(startedAt: number, now: number, focusMin: number, breakMin: number): PomodoroPhase {
  const focus = Math.max(1, Math.round(focusMin)) * 60
  const rest = Math.max(1, Math.round(breakMin)) * 60
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
  const cycle = focus + rest
  const pos = elapsed % cycle
  const round = Math.floor(elapsed / cycle) + 1
  return pos < focus
    ? { phase: 'focus', round, remaining: focus - pos, total: focus }
    : { phase: 'break', round, remaining: cycle - pos, total: rest }
}
