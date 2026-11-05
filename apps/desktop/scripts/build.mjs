// Bundles the main process and the preload script into dist/, and copies the static files next to them.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const out = new URL('../dist/', import.meta.url)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const shared = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: true, logLevel: 'info' }

await build({ ...shared, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs', external: ['electron', 'electron-updater', 'active-win'] })
await build({ ...shared, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', external: ['electron'] })

cpSync('src/offline.html', 'dist/offline.html')
for (const f of ['icon.png', 'tray.png']) if (existsSync(`build/${f}`)) cpSync(`build/${f}`, `dist/${f}`)

// Where a packaged app finds the web app. Set TIMEDESK_WEB_URL when building the release installer.
const webUrl = process.env.TIMEDESK_WEB_URL
if (webUrl) {
  writeFileSync('dist/desktop-config.json', JSON.stringify({ webUrl }, null, 2))
  console.log(`baked web address: ${webUrl}`)
} else {
  console.log('no TIMEDESK_WEB_URL set: the app will open http://localhost:5173 unless configured at run time')
}
