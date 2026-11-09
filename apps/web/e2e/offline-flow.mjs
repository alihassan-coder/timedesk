// Browser end-to-end: working offline. The bug from real use (start a timer, the internet drops, stop it: it did not
// stop) and the rest of offline work: changes wait on the device, survive a reload with no connection, and reach the
// server with the right times once it is back. Also several timers at once.
// Needs the PRODUCTION build served (the offline page needs the service worker), and a FRESH in-memory API:
//   VITE_API_URL=http://localhost:3001 npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173
//   WEB_ORIGIN=http://localhost:4173 MOCK_AI=1 pnpm --filter @timedesk/api dev:memory
//   WEB_URL=http://localhost:4173 node e2e/offline-flow.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const WEB = process.env.WEB_URL ?? 'http://localhost:4173'
const API = process.env.API_URL ?? 'http://localhost:3001'
const memory = await fetch(API + '/__memory').then((r) => r.ok).catch(() => false)
if (!memory) {
  console.error('Refusing to run: ' + API + ' is not the in-memory API.')
  process.exit(2)
}
const PORT = 9336
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'td-off-'))}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0
const pending = new Map()
const results = []
for (let i = 0; i < 40 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://localhost:${PORT}/json`)).json()).find((t) => t.type === 'page')
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl)
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
      ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
    }
  } catch { /* starting */ }
  if (!ws) await sleep(250)
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value }
const waitFor = async (expr, label, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true } catch { /* navigating */ } await sleep(150) } throw new Error(`timeout waiting for: ${label}`) }
const goto = async (path) => { await send('Page.navigate', { url: WEB + path }); await sleep(1000) }
const setField = (sel, val) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const enter = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`)
const ctrlK = () => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))`)
/** A real-looking press (menus open on pointer events). */
const press = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' })); return true })()`)
const clickText = (text) => ev(`(() => { const b = [...document.querySelectorAll('button,a,[role=menuitem]')].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
const exists = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const call = (method, path, body) => fetch(API + '/v1' + path, { method, headers: { 'content-type': 'application/json', Origin: WEB, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())
const step = async (name, fn) => { try { await fn(); results.push(`PASS  ${name}`) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`) } }
const offline = (on) => send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
const PALETTE = 'input[aria-label="Command palette"]'
let cookie = ''

try {
  await send('Page.enable')
  await send('Network.enable')

  await step('sign up and sign in', async () => {
    await goto('/register')
    await waitFor(exists('#name'), 'register form')
    for (const [sel, v] of [['#name', 'Admin Boss'], ['#username', 'boss'], ['#email', 'admin@local.test'], ['#password', 'correct-horse-battery'], ['#confirm', 'correct-horse-battery']]) await setField(sel, v)
    await sleep(300)
    await clickText('Request access')
    await waitFor(bodyHas('Request sent'), 'request sent')
    await goto('/login')
    await waitFor(exists('#login'), 'login form')
    await setField('#login', 'boss')
    await setField('#password', 'correct-horse-battery')
    await sleep(300)
    await ev(`[...document.querySelectorAll('button[type=submit]')].find((b) => b.textContent.trim() === 'Sign in').click()`)
    await waitFor(bodyHas('Welcome to timedesk'), 'dashboard')
    const r = await fetch(API + '/api/auth/sign-in/username', { method: 'POST', headers: { 'content-type': 'application/json', Origin: WEB }, body: JSON.stringify({ username: 'boss', password: 'correct-horse-battery' }) })
    cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    await call('POST', '/tasks', { title: 'Write report' })
    await call('POST', '/tasks', { title: 'Render video' })
    await goto('/')
    await waitFor(`navigator.serviceWorker.getRegistration().then((r) => !!r?.active)`, 'service worker ready', 15000)
  })

  let startedAt = 0
  await step('start a timer on a task', async () => {
    await ctrlK()
    await waitFor(exists(PALETTE), 'palette')
    await setField(PALETTE, 'start write')
    await waitFor(bodyHas('Start timer: Write report'), 'start command')
    await enter(PALETTE)
    await waitFor(exists('[aria-label="Stop timer"]'), 'timer running')
    // The start reaches the server
    const t = Date.now()
    while (Date.now() - t < 8000 && !(await call('GET', '/time-entries/running')).entry) await sleep(250)
    const { entry } = await call('GET', '/time-entries/running')
    if (!entry) throw new Error('the start did not reach the server')
    startedAt = Date.parse(entry.startedAt)
  })

  let stoppedAt = 0
  await step('the internet drops, Stop is pressed: the timer stops at once, and the app says the change is waiting', async () => {
    await offline(true)
    await waitFor(bodyHas('Offline'), 'offline badge')
    await sleep(2500)
    stoppedAt = Date.now()
    await ev(`document.querySelector('[aria-label="Stop timer"]').click()`)
    await waitFor(`!document.querySelector('[aria-label="Stop timer"]')`, 'timer stopped on screen')
    await waitFor(bodyHas('1 change waiting'), 'one change waiting')
  })

  await step('a task added offline (quick add) is kept on the device', async () => {
    await ctrlK()
    await waitFor(exists(PALETTE), 'palette')
    await setField(PALETTE, 'Call the bank')
    await waitFor(bodyHas('Add task'), 'add task command')
    await enter(PALETTE)
    await waitFor(bodyHas('2 changes waiting'), 'two changes waiting')
  })

  await step('reloading with no connection still opens the app, with the changes still there', async () => {
    await send('Page.reload')
    await sleep(2500)
    await waitFor(bodyHas('2 changes waiting'), 'app opened offline with the waiting changes', 15000)
    await goto('/tasks')
    await waitFor(bodyHas('Call the bank'), 'the offline task is listed', 15000)
    if (await ev(exists('[aria-label="Stop timer"]'))) throw new Error('the stopped timer is running again after the reload')
  })

  await step('back online: the changes go out, and the server has the time Stop was pressed (not when it arrived)', async () => {
    await sleep(3000) // make "when it arrived" clearly later than "when Stop was pressed"
    await offline(false)
    await waitFor(`!document.body.innerText.includes('waiting')`, 'everything sent', 20000)
    const { entries } = await call('GET', '/time-entries')
    const e = entries[0]
    if (!e?.endedAt) throw new Error('the timer is still running on the server: ' + JSON.stringify(entries))
    const end = Date.parse(e.endedAt)
    if (Math.abs(end - stoppedAt) > 1500) throw new Error(`stopped at ${new Date(end).toISOString()}, but Stop was pressed at ${new Date(stoppedAt).toISOString()}`)
    if (Date.parse(e.startedAt) !== startedAt) throw new Error('the start time changed')
    const { tasks } = await call('GET', '/tasks')
    if (!tasks.some((t) => t.title === 'Call the bank')) throw new Error('the offline task did not reach the server')
  })

  await step('multitasking: track a second task alongside the first, then stop them one by one', async () => {
    await goto('/')
    await ctrlK()
    await waitFor(exists(PALETTE), 'palette')
    await setField(PALETTE, 'start write')
    await waitFor(bodyHas('Start timer: Write report'), 'start command')
    await enter(PALETTE)
    await waitFor(exists('[aria-label="Stop timer"]'), 'first timer')
    await press('[aria-label="Timer options"]')
    await waitFor(exists('[aria-label="Also track Render video"]'), 'also-track menu')
    await press('[aria-label="Also track Render video"]')
    await waitFor(exists('[aria-label="2 timers running"]'), 'two timers running')
    const t = Date.now()
    while (Date.now() - t < 8000 && (await call('GET', '/time-entries/running')).entries.length < 2) await sleep(250)
    if ((await call('GET', '/time-entries/running')).entries.length !== 2) throw new Error('the server does not have both timers')
    await press('[aria-label="2 timers running"]')
    await waitFor(exists('[aria-label="Stop Render video"]'), 'per-timer stop')
    await press('[aria-label="Stop Render video"]')
    await waitFor(`!document.querySelector('[aria-label="2 timers running"]') && !!document.querySelector('[aria-label="Stop timer"]')`, 'one timer left')
    await ev(`document.querySelector('[aria-label="Stop timer"]').click()`)
    await waitFor(`!document.querySelector('[aria-label="Stop timer"]')`, 'all stopped')
    const t2 = Date.now()
    while (Date.now() - t2 < 8000 && (await call('GET', '/time-entries/running')).entries.length > 0) await sleep(250)
    if ((await call('GET', '/time-entries/running')).entries.length !== 0) throw new Error('a timer is still running on the server')
  })

  await step('a project with a custom colour', async () => {
    await goto('/projects')
    await clickText('New project')
    await waitFor(exists('#pname'), 'new project form')
    await setField('#pname', 'Client brand')
    await setField('[aria-label="Custom colour code"]', '#ff6600')
    await sleep(200)
    await ev(`document.querySelector('#pname').form.requestSubmit()`)
    const t = Date.now()
    let p
    while (Date.now() - t < 8000 && !(p = (await call('GET', '/projects')).projects.find((x) => x.name === 'Client brand'))) await sleep(250)
    if (p?.customColor !== '#ff6600') throw new Error('custom colour not saved: ' + JSON.stringify(p))
  })
} catch (e) {
  results.push('ERROR ' + e.message)
} finally {
  console.log(results.join('\n'))
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0)
}
