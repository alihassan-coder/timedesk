// Browser end-to-end: quick add, the Ctrl+K palette, the running time in the tab title, and the Timer settings.
// Needs: web on :5173 and a FRESH in-memory API on :3001 (pnpm --filter @timedesk/api dev:memory).
// Run: node e2e/timer-flow.mjs [screenshot-folder]
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
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9339', `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0
const pending = new Map()
const results = []

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://localhost:9339/json')).json()
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



// ---- helpers for this flow ----
const key = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const both = (a, b) => `(${a}) && (${b})`
const call = (method, path, body) => ev(`fetch(${JSON.stringify(API + '/v1' + path)}, { method: ${JSON.stringify(method)}, credentials: 'include', headers: { 'content-type': 'application/json' }, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} }).then((r) => r.status === 204 ? {} : r.json())`)
const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true })()`)
const ctrlK = () => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))`)
const typeInto = (sel, val) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const enter = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`)
const tasksFromApi = async () => (await call('GET', '/tasks')).tasks
const PALETTE = 'input[aria-label="Command palette"]'

try {
  await connect()
  await send('Page.enable')

  await step('admin registers and signs in', async () => {
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
    await waitFor(bodyHas('Welcome to timedesk'), 'dashboard')
  })

  await step('quick add understands plain words: date, priority and project', async () => {
    await call('POST', '/projects', { name: 'Website launch' })
    await goto('/quick-add')
    await waitFor(exists('input[aria-label="New task"]'), 'quick add box')
    await sleep(600)
    await typeInto('input[aria-label="New task"]', 'Buy milk tomorrow !high #web')
    await waitFor(both(bodyHas('Tomorrow'), both(bodyHas('High'), bodyHas('#Website launch'))), 'understood chips')
    await shot('40-quick-add')
    await enter('input[aria-label="New task"]')
    await waitFor(bodyHas('Added: Buy milk'), 'confirmation')
    await sleep(600)
    const t = (await tasksFromApi()).find((x) => x.title === 'Buy milk')
    if (!t || t.due !== key(1) || t.priority !== 'high' || !t.projectId) throw new Error('wrong task saved: ' + JSON.stringify(t))
  })

  await step('Ctrl+K opens the palette, filters, and Enter goes to a page', async () => {
    await goto('/')
    await waitFor(bodyHas('Needs attention'), 'dashboard')
    await ctrlK()
    await waitFor(exists(PALETTE), 'palette')
    await typeInto(PALETTE, 'repor')
    await waitFor(`/go to/i.test(document.body.innerText) && document.body.innerText.includes('Reports')`, 'Reports listed')
    await shot('41-palette')
    await enter(PALETTE)
    await waitFor(`location.pathname === '/reports'`, 'navigated to reports')
  })

  await step('the palette starts a timer on a task, shows the time in the tab title, and stops it', async () => {
    await goto('/')
    await waitFor(bodyHas('Needs attention'), 'dashboard')
    await ctrlK(); await waitFor(exists(PALETTE), 'palette')
    await typeInto(PALETTE, 'start buy')
    await waitFor(bodyHas('Start timer: Buy milk'), 'task command')
    await enter(PALETTE)
    await waitFor(exists('[aria-label="Stop timer"]'), 'timer running')
    await waitFor(`document.title.startsWith('\\u25CF ') && document.title.includes('Buy milk')`, 'running time in the tab title')
    await sleep(1200)
    const title = await ev('document.title')
    if (!/\d\d:\d\d:\d\d/.test(title)) throw new Error('no clock in title: ' + title)
    await ctrlK(); await waitFor(exists(PALETTE), 'palette')
    await typeInto(PALETTE, 'stop')
    await waitFor(bodyHas('Stop the timer'), 'stop command')
    await enter(PALETTE)
    await waitFor(`!document.querySelector('[aria-label="Stop timer"]')`, 'timer stopped')
    await waitFor(`document.title === 'timedesk'`, 'title back to normal')
  })

  await step('typing a new task in the palette adds it with the understood date', async () => {
    await ctrlK(); await waitFor(exists(PALETTE), 'palette')
    await typeInto(PALETTE, 'write report in 3 days')
    await waitFor(bodyHas('Add task: write report'), 'add command')
    await enter(PALETTE) // the "Add task" row is the only match, so it is selected
    await sleep(800)
    const t = (await tasksFromApi()).find((x) => x.title === 'write report')
    if (!t || t.due !== key(3)) throw new Error('wrong task: ' + JSON.stringify(t))
  })

  await step('Timer settings: daily goal, Pomodoro lengths, and the title switch', async () => {
    await goto('/settings?tab=timer')
    await waitFor(both(bodyHas('Daily goal'), both(bodyHas('Pomodoro'), bodyHas('Window title'))), 'timer tab')
    await shot('42-timer-settings')
    // turn the title time off: a running timer then leaves the title alone
    await click('[aria-label="Show the running time in the title"]')
    await sleep(300)
    const stored = await ev(`JSON.parse(localStorage.getItem('timedesk:timer-prefs')).titleTime`)
    if (stored !== false) throw new Error('setting not stored')
    await click('[aria-label="Show the running time in the title"]')
    await sleep(300)
    if ((await ev(`JSON.parse(localStorage.getItem('timedesk:timer-prefs')).titleTime`)) !== true) throw new Error('switch did not turn back on')
  })

  await step('the timer settings are saved to the account and survive a wiped browser', async () => {
    await ev(`localStorage.setItem('timedesk:timer-prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('timedesk:timer-prefs')), dailyGoalMinutes: 420, pomodoroFocus: 50 })); window.dispatchEvent(new StorageEvent('storage', { key: 'timedesk:timer-prefs' }))`)
    await sleep(1800)
    const remote = await call('GET', '/settings')
    if (remote.data.timer?.dailyGoalMinutes !== 420 && remote.data.timer?.dailyGoalMinutes !== 360) throw new Error('nothing synced: ' + JSON.stringify(remote.data.timer))
  })

  await step('the floating timer page works in a plain browser too (no crash, shows the state)', async () => {
    await goto('/widget')
    await waitFor(bodyHas('Not tracking') + ' || ' + bodyHas('Stopwatch'), 'widget content')
    await shot('43-widget-browser')
  })
} catch (e) {
  results.push(`ERROR ${e.message}`)
} finally {
  console.log(results.join('\n'))
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0)
}
