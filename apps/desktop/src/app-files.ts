import { isAbsolute, join, normalize, relative, resolve } from 'node:path'

export interface AppFile {
  /** Absolute path of the file to serve. */
  file: string
  /** True when this is the interface's home page (used for every in-app address that is not a file). */
  isIndex: boolean
}

/**
 * Maps an address inside the app (for example /assets/index-abc.js or /tasks) to a file in the bundled interface.
 * - A real file is served as itself.
 * - Anything else that looks like a page (no file extension) gets index.html, so deep links like /tasks work after a reload.
 * - A missing file with an extension is a real "not found", not a page.
 * - It never leaves the interface folder, whatever the address says (../ tricks, encoded dots, drive letters).
 * Returns null when the request must be refused.
 */
export function resolveAppFile(root: string, urlPath: string, exists: (absolutePath: string) => boolean): AppFile | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0])
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  const base = resolve(root)
  const wanted = normalize(join(base, decoded === '/' || decoded === '' ? 'index.html' : decoded))
  const inside = relative(base, wanted)
  if (inside.startsWith('..') || isAbsolute(inside)) return null

  const index = join(base, 'index.html')
  if (exists(wanted) && wanted !== base) return { file: wanted, isIndex: wanted === index }

  const lastSegment = decoded.split('/').pop() ?? ''
  if (/\.[A-Za-z0-9]+$/.test(lastSegment)) return null // a missing asset is a 404
  return { file: index, isIndex: true }
}
