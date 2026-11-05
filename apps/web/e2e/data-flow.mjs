// Browser end-to-end: a new account starts empty, then a project, a task and the timer are saved by the API and survive a reload.
// Needs: web on :5173 and a FRESH in-memory API on :3001 (pnpm --filter @timedesk/api dev:memory).
// Run: node e2e/data-flow.mjs [screenshot-folder]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const API = process.env.API_URL ?? 'http://localhost:3001'
// Safety: only ever run against the throwaway in-memory API, never a real database.
const memory = await fetch(API + '/__memory').then((r) => r.ok).catch(() => false)
if (!memory) {
  console.error('Refusing to run: ' + API + ' is not the in-memory API. Start it with: pnpm --filter @timedesk/api dev:memory (use PORT and WEB_ORIGIN if 3001 is taken).')
  process.exit(2)
}
const SHOTS = process.argv[2]
const profile = mkdtempSync(join(tmpdir(), 'td-e2e-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9335', `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0
const pending = new Map()
const results = []

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://localhost:9335/json')).json()
      const page = list.find((t) => t.type === 'page')
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
        ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
        return
      }
    } catch { /* chrome still starting */ }
    await sleep(250)
  }
  throw new Error('could not connect to chrome')
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value }
const waitFor = async (expr, label, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(150) } throw new Error(`timeout waiting for: ${label}`) }
const goto = async (path) => { await send('Page.navigate', { url: WEB + path }); await sleep(900) }
const setField = (sel, val) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const clickText = (text) => ev(`(() => { const b = [...document.querySelectorAll('button,a,[role=menuitem]')].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
const clickExact = (text, type) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && (!${JSON.stringify(type ?? '')} || x.type === ${JSON.stringify(type ?? '')})); if (!b) return false; b.click(); return true })()`)
const exists = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`
const bodyHas = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`
const shot = async (name) => { if (!SHOTS) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64')) }
const step = async (name, fn) => { try { await fn(); results.push(`PASS  ${name}`) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`); await shot('fail-' + name.replace(/\W+/g, '-')) } }

try {
  await connect()
  await send('Page.enable')

  await step('a new admin signs in and sees an EMPTY dashboard (no dummy data)', async () => {
    await goto('/register')
    await waitFor(exists('#name'), 'register form')
    for (const [sel, v] of [['#name', 'Admin Boss'], ['#username', 'boss'], ['#email', 'admin@local.test'], ['#password', 'correct-horse-battery'], ['#confirm', 'correct-horse-battery']]) await setField(sel, v)
    await sleep(300)
    await clickText('Request access')
    await waitFor(bodyHas('Request sent'), 'request sent')
    await goto('/login')
    await waitFor(exists('#login'), 'login form')
    await setField('#login', 'boss'); await setField('#password', 'correct-horse-battery')
    await sleep(300)
    await clickExact('Sign in', 'submit')
    await waitFor(bodyHas('Welcome to timedesk'), 'welcome card for a new account')
    for (const dummy of ['Sara Khan', 'Acme', 'Website redesign', 'Omar Ali']) if (await ev(bodyHas(dummy))) throw new Error('dummy data still visible: ' + dummy)
    await shot('10-empty-dashboard')
  })

  await step('create a project', async () => {
    await goto('/projects')
    await waitFor(bodyHas('No projects yet'), 'projects empty state')
    await clickText('New project')
    await waitFor(exists('#pname'), 'project dialog')
    await setField('#pname', 'Alpha launch'); await sleep(300)
    await clickExact('Create project', 'submit')
    await waitFor(bodyHas('Alpha launch'), 'project card')
  })

  await step('create a task', async () => {
    await goto('/tasks')
    await waitFor(bodyHas('New task'), 'tasks page')
    await clickText('New task')
    await waitFor(exists('#title'), 'task dialog')
    await setField('#title', 'Write the launch post'); await sleep(300)
    await clickExact('Add task', 'submit')
    await waitFor(bodyHas('Write the launch post'), 'task row')
  })

  await step('start and stop the timer', async () => {
    await clickText('Start timer')
    await waitFor(bodyHas('Stopwatch (no task)'), 'timer menu')
    await clickText('Stopwatch (no task)')
    await waitFor(exists('[aria-label="Stop timer"]'), 'timer running')
    await sleep(1200)
    await ev(`document.querySelector('[aria-label="Stop timer"]').click()`)
    await waitFor(bodyHas('Start timer'), 'timer stopped')
  })

  await step('after a full reload the data is still there (saved by the API)', async () => {
    await goto('/projects')
    await waitFor(bodyHas('Alpha launch'), 'project after reload')
    await goto('/tasks')
    await waitFor(bodyHas('Write the launch post'), 'task after reload')
    await goto('/')
    await waitFor(bodyHas('Needs attention'), 'dashboard')
    if (await ev(bodyHas('Welcome to timedesk'))) throw new Error('welcome card still shown after data exists')
    await shot('11-after-reload')
  })
} catch (e) {
  results.push(`ERROR ${e.message}`)
} finally {
  console.log(results.join('\n'))
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0)
}
