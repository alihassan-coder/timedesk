import { isHexColor, PROJECT_COLOR_COUNT, type Project } from '@timedesk/shared'

/**
 * Preset project colours. They are fixed (not tied to the accent) so projects stay distinguishable in charts, and
 * spread around the colour wheel at similar lightness so none disappears in light or dark mode. Slots 1-5 are the
 * original five, so existing projects keep their colour.
 */
export const PROJECT_COLORS: Record<number, string> = {
  1: 'oklch(0.62 0.19 260)', // blue
  2: 'oklch(0.6 0.22 293)', // violet
  3: 'oklch(0.65 0.17 155)', // green
  4: 'oklch(0.76 0.17 75)', // amber
  5: 'oklch(0.63 0.22 17)', // red
  6: 'oklch(0.7 0.14 200)', // cyan
  7: 'oklch(0.66 0.21 340)', // pink
  8: 'oklch(0.7 0.18 50)', // orange
  9: 'oklch(0.72 0.16 125)', // lime
  10: 'oklch(0.6 0.12 180)', // teal
  11: 'oklch(0.55 0.15 280)', // indigo
  12: 'oklch(0.55 0.06 60)', // brown
}
export const PRESET_NAMES: Record<number, string> = {
  1: 'Blue',
  2: 'Violet',
  3: 'Green',
  4: 'Amber',
  5: 'Red',
  6: 'Cyan',
  7: 'Pink',
  8: 'Orange',
  9: 'Lime',
  10: 'Teal',
  11: 'Indigo',
  12: 'Brown',
}
export const PRESETS = Array.from({ length: PROJECT_COLOR_COUNT }, (_, i) => i + 1)
export const NO_PROJECT_COLOR = 'oklch(0.7 0 0)'

/** The colour to draw a project in: the colour the person picked, or its preset. */
export const projectColor = (p: Pick<Project, 'color' | 'customColor'> | null | undefined): string =>
  !p ? NO_PROJECT_COLOR : isHexColor(p.customColor) ? p.customColor : (PROJECT_COLORS[p.color] ?? PROJECT_COLORS[1])
