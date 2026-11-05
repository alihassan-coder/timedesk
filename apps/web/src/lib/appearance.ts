import { useSyncExternalStore } from 'react'

export type Mode = 'light' | 'dark' | 'system'
export type Accent = 'blue' | 'violet' | 'green' | 'orange' | 'rose' | 'zinc'
export type FontChoice = 'geist' | 'inter' | 'system' | 'mono'
export type TextSize = 'compact' | 'default' | 'large'
export type SidebarVariant = 'sidebar' | 'floating' | 'inset'
export type SidebarCollapse = 'icon' | 'offcanvas'

export interface Appearance {
  mode: Mode
  accent: Accent
  /** Corner radius in rem. */
  radius: number
  font: FontChoice
  size: TextSize
  sidebarVariant: SidebarVariant
  sidebarCollapse: SidebarCollapse
}

export const DEFAULT_APPEARANCE: Appearance = {
  mode: 'system',
  accent: 'blue',
  radius: 0.625,
  font: 'geist',
  size: 'default',
  sidebarVariant: 'sidebar',
  sidebarCollapse: 'icon',
}

const KEY = 'timedesk:appearance'
const ROOT_FONT_PX: Record<TextSize, number> = { compact: 14.5, default: 16, large: 17.5 }

function load(): Appearance {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) }
  } catch {
    // blocked or corrupt storage: use defaults
  }
  return DEFAULT_APPEARANCE
}

const media = window.matchMedia('(prefers-color-scheme: dark)')

function apply(a: Appearance) {
  const root = document.documentElement
  root.classList.toggle('dark', a.mode === 'dark' || (a.mode === 'system' && media.matches))
  root.dataset.accent = a.accent
  root.dataset.font = a.font
  root.style.setProperty('--radius', `${a.radius}rem`)
  root.style.fontSize = `${ROOT_FONT_PX[a.size]}px`
}

let current = load()
apply(current)
media.addEventListener('change', () => apply(current))

const listeners = new Set<() => void>()

export function setAppearance(patch: Partial<Appearance>) {
  current = { ...current, ...patch }
  apply(current)
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

export function resetAppearance() {
  setAppearance(DEFAULT_APPEARANCE)
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

/** Light/dark as it is actually showing right now (resolves "system"). */
export function toggleMode() {
  const dark = document.documentElement.classList.contains('dark')
  setAppearance({ mode: dark ? 'light' : 'dark' })
}

// ---- used by settings-sync.ts to keep appearance identical across devices ----
export const getAppearance = () => current

export function subscribeAppearance(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Applies a full appearance from the server. Missing fields fall back to the defaults. */
export function replaceAppearance(next: Partial<Appearance>) {
  setAppearance({ ...DEFAULT_APPEARANCE, ...next })
}
