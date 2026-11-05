// Builds everything the desktop app needs into dist/:
//   main.cjs, preload.cjs   the app itself (bundled with esbuild)
//   app/                    the web interface, built from apps/web (the SAME source as the website, built a second time)
//   desktop-config.json     which backend the bundled interface talks to
//
//   TIMEDESK_API_URL=https://api.example.com node scripts/build.mjs     (the backend address, baked into the interface)
//   SKIP_UI=1 node scripts/build.mjs                                    (rebuild only the app, keep the last interface build)
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const keepUi = process.env.SKIP_UI === '1' && existsSync(here('../dist/app/index.html'))

// Wipe the app files but keep a previously built interface when SKIP_UI is set.
mkdirSync(here('../dist'), { recursive: true })
for (const f of ['main.cjs', 'main.cjs.map', 'preload.cjs', 'preload.cjs.map', 'offline.html', 'icon.png', 'icon.ico', 'tray.png', 'desktop-config.json']) rmSync(here(`../dist/${f}`), { force: true })
if (!keepUi) rmSync(here('../dist/app'), { recursive: true, force: true })

const shared = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: true, logLevel: 'info' }
await build({ ...shared, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs', external: ['electron', 'electron-updater', 'active-win'] })
await build({ ...shared, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', external: ['electron'] })

cpSync('src/offline.html', 'dist/offline.html')
for (const f of ['icon.png', 'icon.ico', 'tray.png']) if (existsSync(`build/${f}`)) cpSync(`build/${f}`, `dist/${f}`)

// The backend the bundled interface talks to. It is compiled into the interface and also written to the config
// so the app can build a strict security policy for it.
const apiUrl = process.env.TIMEDESK_API_URL || 'http://localhost:3001'
writeFileSync(here('../dist/desktop-config.json'), JSON.stringify({ apiUrl }, null, 2))
if (!process.env.TIMEDESK_API_URL) console.log('no TIMEDESK_API_URL set: the app will talk to http://localhost:3001')
else console.log(`backend address: ${apiUrl}`)

if (keepUi) {
  console.log('SKIP_UI=1: keeping the existing interface build in dist/app')
} else {
  console.log('building the web interface from apps/web ...')
  execFileSync('pnpm', ['--filter', '@timedesk/web', 'exec', 'vite', 'build', '--outDir', here('../dist/app'), '--emptyOutDir'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, VITE_API_URL: apiUrl },
  })
}
