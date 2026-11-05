import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppFile } from '../src/app-files.ts'

const root = resolve('/app-root/dist/app')
const files = new Set([join(root, 'index.html'), join(root, 'assets', 'index-abc123.js'), join(root, 'assets', 'font.woff2'), join(root, 'favicon.svg')])
const exists = (p: string) => files.has(p)
const serve = (path: string) => resolveAppFile(root, path, exists)

describe('serving the bundled interface', () => {
  it('serves the home page for the root address', () => {
    expect(serve('/')).toEqual({ file: join(root, 'index.html'), isIndex: true })
  })

  it('serves real files as themselves', () => {
    expect(serve('/assets/index-abc123.js')).toEqual({ file: join(root, 'assets', 'index-abc123.js'), isIndex: false })
    expect(serve('/favicon.svg')?.file).toBe(join(root, 'favicon.svg'))
  })

  it('gives every in-app page address the home page, so a reload on /tasks still works', () => {
    for (const p of ['/tasks', '/settings', '/projects/new', '/assistant']) expect(serve(p)).toEqual({ file: join(root, 'index.html'), isIndex: true })
  })

  it('a missing file with an extension is a real not-found, not a page', () => {
    expect(serve('/assets/missing.js')).toBeNull()
    expect(serve('/nope.png')).toBeNull()
  })

  it('ignores the query string and the fragment', () => {
    expect(serve('/assets/index-abc123.js?v=2')?.file).toBe(join(root, 'assets', 'index-abc123.js'))
    expect(serve('/tasks?filter=open#top')?.isIndex).toBe(true)
  })

  it.each([
    ['/../secret.txt'],
    ['/assets/../../secret.txt'],
    ['/%2e%2e/secret.txt'],
    ['/%2e%2e%2f%2e%2e%2fsecret.txt'],
    ['/..%5c..%5csecret.txt'],
    ['/assets/%00.js'],
    ['/%E0%A4%A'],
    ['/C:/Windows/win.ini'],
  ])('never leaves the interface folder: %s', (path) => {
    const out = serve(path)
    // Either refused, or answered with the home page. Never a file outside the folder.
    if (out !== null) {
      expect(out.file.startsWith(root)).toBe(true)
      expect(out.isIndex).toBe(true)
    }
  })
})
