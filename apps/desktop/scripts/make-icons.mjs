// Regenerates the app icons from build/icon.svg. Run only when the logo changes. Needs Google Chrome installed.
//   node scripts/make-icons.mjs
// Writes: build/icon.png (512), build/tray.png (64) and build/icon.ico (16 to 256, what Windows needs for the taskbar and the .exe).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const svg = readFileSync(here('../build/icon.svg'), 'utf8').replace('<svg ', '<svg width="SIZE" height="SIZE" ')
const work = mkdtempSync(join(tmpdir(), 'td-icons-'))

function render(size) {
  const html = join(work, `i${size}.html`)
  const png = join(work, `i${size}.png`)
  writeFileSync(html, `<!doctype html><html><body style="margin:0;background:transparent">${svg.replaceAll('SIZE', String(size))}</body></html>`)
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${png}`, `file:///${html.replace(/\\/g, '/')}`], { stdio: 'ignore' })
  return readFileSync(png)
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map((s) => ({ size: s, data: render(s) }))
writeFileSync(here('../build/icon.png'), render(512))
writeFileSync(here('../build/tray.png'), images.find((i) => i.size === 64).data)

// An .ico is a small header plus one entry per size. Each entry can hold a PNG, which every Windows since Vista reads.
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
let offset = 6 + images.length * 16
const entries = images.map(({ size, data }) => {
  const e = Buffer.alloc(16)
  e.writeUInt8(size === 256 ? 0 : size, 0)
  e.writeUInt8(size === 256 ? 0 : size, 1)
  e.writeUInt16LE(1, 4) // colour planes
  e.writeUInt16LE(32, 6) // bits per pixel
  e.writeUInt32LE(data.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += data.length
  return e
})
writeFileSync(here('../build/icon.ico'), Buffer.concat([header, ...entries, ...images.map((i) => i.data)]))
rmSync(work, { recursive: true, force: true })
console.log('wrote build/icon.png, build/tray.png, build/icon.ico')
