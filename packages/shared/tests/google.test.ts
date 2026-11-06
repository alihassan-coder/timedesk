import { describe, expect, it } from 'vitest'
import { eventsOnDay, eventStartDay, type CalendarEvent } from '../src/google.ts'

const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({ id: 'x', title: 'E', start: '2026-11-10', end: '2026-11-11', allDay: true, description: '', link: null, ...over })
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

describe('events on a day', () => {
  it('an all-day event covers its days, and the end date is exclusive', () => {
    const e = ev({ start: '2026-11-10', end: '2026-11-13' })
    expect(eventsOnDay([e], '2026-11-09')).toHaveLength(0)
    expect(eventsOnDay([e], '2026-11-10')).toHaveLength(1)
    expect(eventsOnDay([e], '2026-11-12')).toHaveLength(1)
    expect(eventsOnDay([e], '2026-11-13')).toHaveLength(0)
  })

  it('a timed event belongs to its local day, and one crossing midnight shows on both', () => {
    const night = ev({ allDay: false, start: at(2026, 11, 10, 23), end: at(2026, 11, 11, 1) })
    expect(eventsOnDay([night], '2026-11-10')).toHaveLength(1)
    expect(eventsOnDay([night], '2026-11-11')).toHaveLength(1)
    expect(eventsOnDay([night], '2026-11-12')).toHaveLength(0)
  })

  it('an event ending exactly at midnight does not leak into the next day', () => {
    const e = ev({ allDay: false, start: at(2026, 11, 10, 22), end: at(2026, 11, 11, 0) })
    expect(eventsOnDay([e], '2026-11-11')).toHaveLength(0)
  })

  it('puts all-day events first, then by time', () => {
    const a = ev({ id: 'a', allDay: false, start: at(2026, 11, 10, 15), end: at(2026, 11, 10, 16) })
    const b = ev({ id: 'b', allDay: false, start: at(2026, 11, 10, 9), end: at(2026, 11, 10, 10) })
    const c = ev({ id: 'c' })
    expect(eventsOnDay([a, b, c], '2026-11-10').map((e) => e.id)).toEqual(['c', 'b', 'a'])
  })

  it('knows the start day of both kinds', () => {
    expect(eventStartDay(ev({}))).toBe('2026-11-10')
    expect(eventStartDay(ev({ allDay: false, start: at(2026, 11, 10, 23, 30), end: at(2026, 11, 11, 0, 30) }))).toBe('2026-11-10')
  })
})
