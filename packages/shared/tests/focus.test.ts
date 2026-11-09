import { describe, expect, it } from 'vitest'
import { classifyWindow, focusScore, isBrowser, sanitizeFocusList, siteWords, summarizeFocus, type FocusRules } from '../src/index.ts'

const rules: FocusRules = { apps: ['Discord', 'Steam', 'WhatsApp'], sites: ['YouTube', 'reddit.com', 'https://www.x.com/home', 'Hacker News'] }
const judge = (app: string, title = '') => classifyWindow({ app, title }, rules)

describe('which window is a distraction', () => {
  it('matches listed programs by name, ignoring case and .exe', () => {
    expect(judge('Discord')).toEqual({ kind: 'distracting', match: 'Discord' })
    expect(judge('discord.exe')).toEqual({ kind: 'distracting', match: 'Discord' })
    expect(judge('Discord PTB')).toEqual({ kind: 'distracting', match: 'Discord' })
    expect(judge('WhatsApp')).toEqual({ kind: 'distracting', match: 'WhatsApp' })
  })

  it('matches whole words only, so a work program with a similar name is left alone', () => {
    expect(judge('Steamroller Studio')).toEqual({ kind: 'ok' })
    expect(judge('Code', 'steam-notes.md - Visual Studio Code')).toEqual({ kind: 'ok' })
  })

  it('looks for sites in the tab title, but only in a browser', () => {
    expect(judge('Google Chrome', 'Lo-fi beats - YouTube - Google Chrome')).toEqual({ kind: 'distracting', match: 'YouTube' })
    expect(judge('msedge.exe', 'r/typescript - Reddit')).toEqual({ kind: 'distracting', match: 'reddit.com' })
    expect(judge('Firefox', 'Hacker News — Mozilla Firefox')).toEqual({ kind: 'distracting', match: 'Hacker News' })
    // An editor with a file named after a site is work, not a distraction.
    expect(judge('Visual Studio Code', 'youtube-api.ts - timedesk')).toEqual({ kind: 'ok' })
    expect(judge('Google Chrome', 'Pull requests · GitHub')).toEqual({ kind: 'ok' })
  })

  it('never calls timedesk itself a distraction', () => {
    expect(classifyWindow({ app: 'timedesk', title: 'YouTube' }, { apps: ['timedesk'], sites: ['YouTube'] })).toEqual({ kind: 'ok' })
  })

  it('turns an address into words to look for, without matching single letters', () => {
    expect(siteWords('https://www.YouTube.com/feed')).toEqual(['youtube.com', 'youtube'])
    expect(siteWords('x.com')).toEqual(['x.com'])
    expect(siteWords('Reddit')).toEqual(['reddit'])
    expect(siteWords('  ')).toEqual([])
  })

  it('recognises common browsers', () => {
    for (const b of ['Google Chrome', 'chrome.exe', 'Microsoft Edge', 'msedge.exe', 'Firefox', 'Brave Browser', 'Arc', 'Opera']) expect(isBrowser(b)).toBe(true)
    for (const b of ['Code', 'Slack', 'Search', 'Explorer']) expect(isBrowser(b)).toBe(false)
  })
})

describe('focus lists and score', () => {
  it('cleans a list: trims, drops blanks, repeats and non-text, limits length', () => {
    expect(sanitizeFocusList([' YouTube ', 'youtube', '', 42, 'Steam  Big', 'a'.repeat(100)])).toEqual(['YouTube', 'Steam Big', 'a'.repeat(60)])
    expect(sanitizeFocusList('YouTube')).toEqual([])
    expect(sanitizeFocusList(Array.from({ length: 80 }, (_, i) => `app${i}`))).toHaveLength(50)
  })

  it('scores focused time against distracted time, ignoring time away', () => {
    expect(focusScore(90, 10)).toBe(90)
    expect(focusScore(0, 0)).toBeNull()
    expect(focusScore(0, 30)).toBe(0)
  })

  it('adds sessions up and ranks the distractions', () => {
    const s = summarizeFocus([
      { focusedSeconds: 1500, distractedSeconds: 120, awaySeconds: 60, interruptions: 2, distractions: [{ name: 'YouTube', seconds: 100 }, { name: 'Discord', seconds: 20 }] },
      { focusedSeconds: 900, distractedSeconds: 60, awaySeconds: 0, interruptions: 1, distractions: [{ name: 'youtube', seconds: 10 }, { name: 'Discord', seconds: 50 }] },
    ])
    expect(s).toEqual({
      sessions: 2,
      focusedSeconds: 2400,
      distractedSeconds: 180,
      awaySeconds: 60,
      interruptions: 3,
      score: 93,
      topDistractions: [{ name: 'YouTube', seconds: 110 }, { name: 'Discord', seconds: 70 }],
    })
    expect(summarizeFocus([]).score).toBeNull()
  })
})
