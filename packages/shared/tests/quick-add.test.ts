import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from '../src/quick-add.ts'
import { pomodoroPhase } from '../src/pomodoro.ts'

// Friday 6 Nov 2026, 10:00 local time.
const NOW = new Date(2026, 10, 6, 10, 0).getTime()
const projects = [
  { id: 'p1', name: 'Website launch' },
  { id: 'p2', name: 'Admin' },
]
const parse = (s: string) => parseQuickAdd(s, { now: NOW, projects })

describe('quick add', () => {
  it('keeps plain text as the title with no date', () => {
    expect(parse('Buy milk')).toMatchObject({ title: 'Buy milk', due: null, priority: 'medium', projectId: null })
  })

  it('understands today and tomorrow anywhere in the text', () => {
    expect(parse('call the printer tomorrow')).toMatchObject({ title: 'call the printer', due: '2026-11-07' })
    expect(parse('today pay rent')).toMatchObject({ title: 'pay rent', due: '2026-11-06' })
    expect(parse('call the printer tomorrow').hints).toEqual(['Tomorrow'])
  })

  it('moves a weekday to the next one that is strictly after today', () => {
    expect(parse('review pull requests monday').due).toBe('2026-11-09')
    expect(parse('standup on friday').due).toBe('2026-11-13') // today is Friday: means next Friday
    expect(parse('plan sat').due).toBe('2026-11-07')
  })

  it('understands relative phrases and ISO dates', () => {
    expect(parse('report in 3 days').due).toBe('2026-11-09')
    expect(parse('retro in 2 weeks').due).toBe('2026-11-20')
    expect(parse('kickoff next week').due).toBe('2026-11-09')
    expect(parse('deadline 2026-12-24').due).toBe('2026-12-24')
    expect(parse('deadline 2026-13-45').due).toBeNull()
  })

  it('reads priority and project, and removes those tokens from the title', () => {
    const r = parse('Fix header !high #web tomorrow')
    expect(r).toMatchObject({ title: 'Fix header', priority: 'high', projectId: 'p1', due: '2026-11-07' })
    expect(r.hints).toEqual(['Tomorrow', 'High', '#Website launch'])
    expect(parse('x !l').priority).toBe('low')
  })

  it('leaves unknown tags and ordinary words alone', () => {
    expect(parse('plan #nothing monday morning')).toMatchObject({ title: 'plan #nothing morning', due: '2026-11-09', projectId: null })
    expect(parse('Monitor the sunday service')).toMatchObject({ title: 'Monitor the service', due: '2026-11-08' })
    expect(parse('Install a new tool')).toMatchObject({ due: null }) // "tool" is not a day
  })
})

describe('pomodoro', () => {
  const start = 0
  const at = (s: number) => pomodoroPhase(start, s * 1000, 25, 5)
  it('starts with focus and counts down', () => {
    expect(at(0)).toEqual({ phase: 'focus', round: 1, remaining: 1500, total: 1500 })
    expect(at(60)).toMatchObject({ phase: 'focus', remaining: 1440 })
  })
  it('switches to a break, then to the next round', () => {
    expect(at(1500)).toEqual({ phase: 'break', round: 1, remaining: 300, total: 300 })
    expect(at(1799)).toMatchObject({ phase: 'break', remaining: 1 })
    expect(at(1800)).toEqual({ phase: 'focus', round: 2, remaining: 1500, total: 1500 })
  })
  it('never goes negative if the clock is behind', () => {
    expect(pomodoroPhase(10_000, 0, 25, 5).remaining).toBe(1500)
  })
})
