// End-to-end test of the BUNDLED desktop app: the interface runs from inside the app (app://timedesk), no website is running at all,
// and sign-in uses a token instead of a cookie.
//   1. build the app with the backend address:  TIMEDESK_API_URL=http://localhost:3002 pnpm --filter @timedesk/desktop build
//   2. start a FRESH in-memory API:             MOCK_AI=1 PORT=3002 pnpm --filter @timedesk/api dev:memory
//   3. run:                                     API_URL=http://localhost:3002 node e2e/bundled-flow.mjs [screenshot-folder]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electron from 'electron'

const API = process.env.API_URL ?? 'http://localhost:3001'
const memory = await fetch(API + '/__memory').then((r) => r.ok).catch(() => false)
if (!memory) {
  console.error('Refusing to run: ' + API + ' is not the in-memory API. Start it with: MOCK_AI=1 pnpm --filter @timedesk/api dev:memory')
  process.exit(2)
}
const SHOTS = process.argv[2]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const userData = mkdtempSync(join(tmpdir(), 'td-bundled-'))

const env = { ...process.env, TIMEDESK_USER_DATA: userData, TIMEDESK_FAKE_UPDATE: '0.2.0', TIMEDESK_IDLE_LIMIT_SECONDS: '999999' }
delete env.ELECTRON_RUN_AS_NODE
delete env.TIMEDESK_WEB_URL // the point of this test: no website address at all
const child = spawn(electron, ['.', '--remote-debugging-port=9343'], { cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), env, stdio: 'ignore' })

let ws, id = 0
const pending = new Map()
async function attach() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch('http://localhost:9343/json')).json()).find((t) => t.type === 'page')
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
        ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
        return
      }
    } catch { /* starting */ }
    await sleep(500)
  }
  throw new Error('could not attach to the desktop window')
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed'); return r.result?.result?.value }
const waitFor = async (expr, label, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true } catch { /* navigating */ } await sleep(200) } throw new Error('timeout waiting for: ' + label) }
const setField = (sel, val) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const clickText = (text) => ev(`(() => { const b = [...document.querySelectorAll('button,a,[role=menuitem]')].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
const clickExact = (text, type) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && (!${JSON.stringify(type ?? '')} || x.type === ${JSON.stringify(type ?? '')})); if (!b) return false; b.click(); return true })()`)
const nav = async (path) => { await ev(`location.href = 'app://timedesk${path}'`); await sleep(1500) }
const shot = async (name) => { if (!SHOTS) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')) }
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const exists = (s) => `!!document.querySelector(${JSON.stringify(s)})`
const step = async (name, fn) => { try { await fn(); results.push('PASS  ' + name) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`); await shot('fail-' + name.replace(/\W+/g, '-')) } }

try {
  await attach()
  await send('Page.enable')
  await waitFor(exists('#root'), 'the interface mounts')

  await step('the interface runs from inside the app, with no website involved', async () => {
    const o = await ev('location.origin')
    if (o !== 'app://timedesk') throw new Error('origin was ' + o)
    const info = await ev('window.timedesk.info()')
    if (info.mode !== 'bundled') throw new Error('mode was ' + info.mode)
  })

  await step('a strict security policy is on every page', async () => {
    const csp = await ev("fetch('/').then((r) => r.headers.get('content-security-policy'))")
    if (!csp || !csp.includes("script-src 'self'") || !csp.includes('connect-src')) throw new Error('policy was: ' + csp)
    if (/script-src[^;]*unsafe/.test(csp)) throw new Error('scripts are allowed to run inline')
  })

  await step('injected code is blocked: no inline scripts, no scripts from other sites', async () => {
    await ev("(() => { const s = document.createElement('script'); s.textContent = 'window.__injected = 1'; document.head.appendChild(s) })()")
    await ev("(() => { const s = document.createElement('script'); s.src = 'https://example.com/x.js'; s.onload = () => { window.__remote = 1 }; document.head.appendChild(s) })()")
    await sleep(1500)
    if (await ev('window.__injected === 1')) throw new Error('an inline script ran')
    if (await ev('window.__remote === 1')) throw new Error('a script from another site ran')
  })

  await step('files outside the app cannot be read through the app address', async () => {
    const statusMissing = await ev("fetch('/assets/does-not-exist.js').then((r) => r.status)")
    if (statusMissing !== 404) throw new Error('a missing asset answered ' + statusMissing)
    const leak = await ev("fetch('/..%2f..%2fmain.cjs').then((r) => r.text()).then((t) => t.includes('registerSchemesAsPrivileged'))")
    if (leak) throw new Error('the app\'s own program file was readable')
  })

  await step('register and sign in; the session is a token held by the app, not a cookie or page storage', async () => {
    await nav('/register')
    await waitFor(exists('#name'), 'register form')
    for (const [sel, v] of [['#name', 'Admin Boss'], ['#username', 'boss'], ['#email', 'admin@local.test'], ['#password', 'correct-horse-battery'], ['#confirm', 'correct-horse-battery']]) await setField(sel, v)
    await sleep(300)
    await clickText('Request access')
    await waitFor(bodyHas('Request sent'), 'request sent')
    await nav('/login')
    await waitFor(exists('#login'), 'login form')
    await setField('#login', 'boss'); await setField('#password', 'correct-horse-battery')
    await sleep(300)
    await clickExact('Sign in', 'submit')
    await waitFor(bodyHas('Welcome to timedesk'), 'dashboard')
    const token = await ev('window.timedesk.tokens.get()')
    if (!token || token.length < 20) throw new Error('no token was stored by the app')
    const leaked = await ev(`JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + document.cookie`)
    if (leaked.includes(token)) throw new Error('the token is in page storage or cookies')
    await shot('40-bundled-dashboard')
  })

  await step('create a project and a task, then reload: still signed in, data still there', async () => {
    await nav('/projects')
    await waitFor(bodyHas('No projects yet'), 'projects page')
    await clickText('New project')
    await waitFor(exists('#pname'), 'dialog')
    await setField('#pname', 'Bundled project'); await sleep(300)
    await clickExact('Create project', 'submit')
    await waitFor(bodyHas('Bundled project'), 'project card')
    await nav('/tasks')
    await waitFor(bodyHas('New task'), 'tasks page')
    await clickText('New task')
    await waitFor(exists('#title'), 'task dialog')
    await setField('#title', 'Task made in the bundled app'); await sleep(300)
    await clickExact('Add task', 'submit')
    await waitFor(bodyHas('Task made in the bundled app'), 'task row')
    await ev('location.reload()')
    await sleep(2000)
    await waitFor(bodyHas('Task made in the bundled app'), 'task after full reload (token reloaded from the app)', 15000)
  })

  await step('a deep link works after a reload (the app serves the home page for in-app addresses)', async () => {
    await nav('/settings')
    await waitFor(bodyHas('Make timedesk look and behave the way you work'), 'settings page loads directly')
  })

  await step('the update banner and a native notification work in the bundled app too', async () => {
    await waitFor(bodyHas('timedesk 0.2.0 is ready'), 'update banner', 15000)
    await ev("window.timedesk.notify('timedesk test', 'Hello from the bundled app')")
  })

  await step('app tracking records and uploads using the token', async () => {
    await nav('/settings?tab=desktop')
    await waitFor(exists('[aria-label="Track which apps I use"]'), 'tracking switch')
    await ev("document.querySelector('[aria-label=\"Track which apps I use\"]').click()")
    await waitFor('window.timedesk.getSettings().then((s) => s.trackApps === true)', 'tracking on', 8000)
    await waitFor(`fetch(${JSON.stringify(API + '/v1/activity/summary')}, { headers: { Authorization: 'Bearer ' + (window.__t ||= '') } }).then(() => true)`, 'api reachable', 5000).catch(() => {})
    const token = await ev('window.timedesk.tokens.get()')
    await waitFor(`fetch(${JSON.stringify(API + '/v1/activity/summary')}, { headers: { Authorization: 'Bearer ${token}' } }).then((r) => r.json()).then((j) => j.totalSeconds > 0)`, 'uploaded activity', 100000)
  })

  await step('signing out forgets the token; after a reload the sign-in screen appears', async () => {
    await ev('window.timedesk.setSettings({ trackApps: false })')
    await nav('/')
    await waitFor(bodyHas('Good '), 'dashboard')
    await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Admin Boss')).click()`)
    await waitFor(bodyHas('Sign out'), 'menu')
    await clickText('Sign out')
    await waitFor(`location.pathname === '/login'`, 'login screen')
    if (await ev('window.timedesk.tokens.get()')) throw new Error('the token was kept after sign out')
    await ev('location.reload()')
    await sleep(1500)
    await waitFor(exists('#login'), 'still on the sign-in screen after reload')
  })
} catch (e) {
  results.push('ERROR ' + e.message)
} finally {
  console.log(results.join('\n'))
  try { ws?.close() } catch { /* ignore */ }
  try { child.kill() } catch { /* ignore */ }
  await sleep(500)
  process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0)
}
