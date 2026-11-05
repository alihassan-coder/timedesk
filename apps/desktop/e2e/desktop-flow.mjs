// End-to-end test of the real desktop app: launches Electron, drives its window over the DevTools protocol.
// Needs: web on WEB_URL and a FRESH in-memory API on API_URL (MOCK_AI=1 pnpm --filter @timedesk/api dev:memory).
//   WEB_URL=http://localhost:5180 API_URL=http://localhost:3002 node e2e/desktop-flow.mjs [screenshot-folder]
// Takes about two minutes because it waits for the real once-a-minute activity upload.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import electron from 'electron'

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const API = process.env.API_URL ?? 'http://localhost:3001'
// Safety: only ever run against the throwaway in-memory API, never a real database.
const memory = await fetch(API + '/__memory').then((r) => r.ok).catch(() => false)
if (!memory) {
  console.error('Refusing to run: ' + API + ' is not the in-memory API. Start it with: MOCK_AI=1 pnpm --filter @timedesk/api dev:memory')
  process.exit(2)
}
const SHOTS = process.argv[2]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []

function launch(port, url, extraEnv = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'td-desktop-'))
  const child = spawn(electron, ['.', `--web-url=${url}`, `--remote-debugging-port=${port}`], {
    cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, TIMEDESK_USER_DATA: userData, ...extraEnv },
    stdio: 'ignore',
  })
  return child
}

async function attach(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://localhost:${port}/json`)).json()).find((t) => t.type === 'page')
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
        let id = 0
        const pending = new Map()
        ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
        const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
        const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed'); return r.result?.result?.value }
        return { ws, send, ev }
      }
    } catch { /* still starting */ }
    await sleep(500)
  }
  throw new Error('could not attach to the desktop window')
}

const mk = (cdp) => ({
  waitFor: async (expr, label, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await cdp.ev(expr)) return true } catch { /* page navigating */ } await sleep(200) } throw new Error('timeout waiting for: ' + label) },
  setField: (sel, val) => cdp.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`),
  clickText: (text) => cdp.ev(`(() => { const b = [...document.querySelectorAll('button,a,[role=menuitem],[role=tab]')].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`),
  clickExact: (text, type) => cdp.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && (!${JSON.stringify(type ?? '')} || x.type === ${JSON.stringify(type ?? '')})); if (!b) return false; b.click(); return true })()`),
  nav: async (path) => { await cdp.ev(`location.href = ${JSON.stringify(WEB + path)}`); await sleep(1200) },
  shot: async (name) => { if (!SHOTS) return; const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')) },
})
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const exists = (s) => `!!document.querySelector(${JSON.stringify(s)})`
const step = async (name, fn, h) => { try { await fn(); results.push('PASS  ' + name) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`); await h?.shot('fail-' + name.replace(/\W+/g, '-')) } }

let app, offline
try {
  app = launch(9340, WEB, { TIMEDESK_FAKE_UPDATE: '0.2.0', TIMEDESK_IDLE_LIMIT_SECONDS: '999999' })
  const cdp = await attach(9340)
  await cdp.send('Page.enable')
  const h = mk(cdp)
  await h.waitFor(exists('#root'), 'web app mounts')

  await step('the page is running inside the desktop app and can talk to it', async () => {
    if (!(await cdp.ev('window.timedesk?.isDesktop === true'))) throw new Error('window.timedesk bridge is missing')
    const info = await cdp.ev('window.timedesk.info()')
    if (info.version !== VERSION || info.packaged !== false || info.mode !== 'remote') throw new Error('unexpected app info: ' + JSON.stringify(info))
    if (info.startUrl !== WEB) throw new Error('web address was ' + info.startUrl)
  }, h)

  await step('register, then sign in from the desktop window', async () => {
    await h.nav('/register')
    await h.waitFor(exists('#name'), 'register form')
    for (const [sel, v] of [['#name', 'Admin Boss'], ['#username', 'boss'], ['#email', 'admin@local.test'], ['#password', 'correct-horse-battery'], ['#confirm', 'correct-horse-battery']]) await h.setField(sel, v)
    await sleep(300)
    await h.clickText('Request access')
    await h.waitFor(bodyHas('Request sent'), 'request sent')
    await h.nav('/login')
    await h.waitFor(exists('#login'), 'login form')
    await h.setField('#login', 'boss'); await h.setField('#password', 'correct-horse-battery')
    await sleep(300)
    await h.clickExact('Sign in', 'submit')
    await h.waitFor(bodyHas('Welcome to timedesk'), 'dashboard')
  }, h)

  await step('a downloaded update shows the restart banner', async () => {
    await h.waitFor(bodyHas('timedesk 0.2.0 is ready'), 'update banner', 15000)
    await h.waitFor(bodyHas('Restart to update'), 'restart button')
    await h.shot('30-desktop-update-banner')
  }, h)

  await step('a native notification can be sent', async () => {
    await cdp.ev("window.timedesk.notify('timedesk test', 'Hello from the end-to-end test')")
  }, h)

  await step('the Desktop settings tab exists and saves settings on this computer', async () => {
    await h.nav('/settings?tab=desktop')
    await h.waitFor(bodyHas('Track which apps I use'), 'desktop tab')
    await h.waitFor(exists('[aria-label="Track which apps I use"]'), 'tracking switch')
    await cdp.ev("document.querySelector('[aria-label=\"Track which apps I use\"]').click()")
    await h.waitFor('window.timedesk.getSettings().then((s) => s.trackApps === true)', 'trackApps saved', 8000)
    await h.shot('31-desktop-settings')
  }, h)

  await step('app tracking records what is in front and uploads it to the account', async () => {
    // The desktop window uploads once a minute. Wait for the real thing.
    await h.waitFor(`fetch(${JSON.stringify(API + '/v1/activity/summary')}, { credentials: 'include' }).then((r) => r.json()).then((j) => j.totalSeconds > 0)`, 'uploaded activity', 100000)
    const summary = await cdp.ev(`fetch(${JSON.stringify(API + '/v1/activity/summary')}, { credentials: 'include' }).then((r) => r.json())`)
    if (!summary.byApp.length) throw new Error('no apps in the summary')
    results.push('      saw apps: ' + summary.byApp.map((a) => `${a.app} ${a.seconds}s`).join(', '))
    await h.nav('/apps')
    await h.waitFor(bodyHas('Minutes per app'), 'apps page shows the chart', 10000)
    await h.shot('32-desktop-apps')
  }, h)

  await step('turning tracking off stops it', async () => {
    await cdp.ev('window.timedesk.setSettings({ trackApps: false })')
    await sleep(500)
    const left = await cdp.ev('window.timedesk.pullActivity().then((s) => s.length)')
    await sleep(7000)
    const after = await cdp.ev('window.timedesk.pullActivity().then((s) => s.length)')
    if (after !== 0) throw new Error('samples kept arriving after tracking was turned off: ' + after + ' (before: ' + left + ')')
  }, h)

  // A second copy that cannot reach the site shows the built-in "can't connect" page.
  offline = launch(9341, 'http://localhost:5999')
  const cdp2 = await attach(9341)
  await cdp2.send('Page.enable')
  const h2 = mk(cdp2)
  await step('when the site cannot be reached the app shows a friendly retry page', async () => {
    await h2.waitFor(bodyHas("Can't reach timedesk"), 'offline page', 15000)
    await h2.waitFor(bodyHas('http://localhost:5999'), 'shows the address')
    await h2.shot('33-desktop-offline')
  }, h2)
} catch (e) {
  results.push('ERROR ' + e.message)
} finally {
  console.log(results.join('\n'))
  for (const p of [app, offline]) { try { p?.kill() } catch { /* ignore */ } }
  await sleep(500)
  process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0)
}
