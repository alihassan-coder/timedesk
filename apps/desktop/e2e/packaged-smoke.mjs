// Smoke test for the PACKAGED app (release/win-unpacked/timedesk.exe, or a Linux unpacked build).
//   WEB_URL=http://localhost:5180 node e2e/packaged-smoke.mjs [path-to-exe]
// Checks: it starts, the page loads inside it, the bridge works, it reports itself as packaged, and app
// tracking can read the foreground window (the native helper must be unpacked from the archive).
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const exe = process.argv[2] ?? new URL('../release/win-unpacked/timedesk.exe', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []

const env = { ...process.env, TIMEDESK_USER_DATA: mkdtempSync(join(tmpdir(), 'td-packaged-')), TIMEDESK_IDLE_LIMIT_SECONDS: '999999' }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(exe, [`--web-url=${WEB}`, '--remote-debugging-port=9342'], { env, stdio: 'ignore' })

try {
  let ws
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const page = (await (await fetch('http://localhost:9342/json')).json()).find((t) => t.type === 'page')
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
      }
    } catch { /* still starting */ }
    await sleep(500)
  }
  if (!ws) throw new Error('the packaged app did not start')

  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  const ev = (expr) => new Promise((res) => { const i = ++id; pending.set(i, (d) => res(d.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })) })
  const waitFor = async (expr, label, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(250) } throw new Error('timeout waiting for: ' + label) }
  const step = async (name, fn) => { try { await fn(); results.push('PASS  ' + name) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`) } }

  await step('starts and loads the web app inside the packaged window', async () => {
    await waitFor('document.body && document.body.innerText.includes("Sign in")', 'login page')
  })
  await step('the bridge reports a packaged app with the right version', async () => {
    const info = await ev('window.timedesk.info()')
    if (!info?.packaged || info.version !== '0.1.0') throw new Error(JSON.stringify(info))
  })
  await step('app tracking works from the packaged archive (native helper found)', async () => {
    await ev('window.timedesk.setSettings({ trackApps: true })')
    await ev('window.timedesk.setSignedIn(true)')
    await waitFor('window.timedesk.pullActivity().then((s) => s.length > 0)', 'a recorded sample', 20000)
  })
  await step('settings are stored on this computer', async () => {
    const s = await ev('window.timedesk.getSettings()')
    if (!s.trackApps) throw new Error(JSON.stringify(s))
  })
  try { ws.close() } catch { /* ignore */ }
} catch (e) {
  results.push('ERROR ' + e.message)
} finally {
  console.log(results.join('\n'))
  try { child.kill() } catch { /* ignore */ }
  await sleep(500)
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0)
}
