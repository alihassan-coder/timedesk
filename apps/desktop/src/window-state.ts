export interface Bounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

export interface Display {
  x: number
  y: number
  width: number
  height: number
}

export const DEFAULT_BOUNDS: Bounds = { width: 1280, height: 820 }
const MIN_W = 800
const MIN_H = 560

/**
 * Makes sure a remembered window position is usable. If the monitor it was on is gone, or the size is
 * nonsense, fall back to the default size and let the system place it.
 */
export function sanitizeBounds(saved: Partial<Bounds> | null | undefined, displays: Display[]): Bounds {
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return { ...DEFAULT_BOUNDS }
  const width = Math.max(MIN_W, Math.round(saved.width))
  const height = Math.max(MIN_H, Math.round(saved.height))
  const base: Bounds = { width, height, maximized: !!saved.maximized }

  if (typeof saved.x !== 'number' || typeof saved.y !== 'number') return base
  const visible = displays.some((d) => saved.x! + 100 > d.x && saved.x! < d.x + d.width - 100 && saved.y! >= d.y - 10 && saved.y! < d.y + d.height - 100)
  return visible ? { ...base, x: Math.round(saved.x), y: Math.round(saved.y) } : base
}
