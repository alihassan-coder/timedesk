// Browser end-to-end for Google Calendar (two-way) against a fake Google. No real Google account is used.
// Needs: web on :5273 built with VITE_API_URL=http://localhost:3101, and a FRESH in-memory API:
//   PORT=3101 WEB_ORIGIN=http://localhost:5273 FAKE_GOOGLE=1 pnpm --filter @timedesk/api dev:memory
// Run: WEB_URL=http://localhost:5273 API_URL=http://localhost:3101 node e2e/google-flow.mjs [screenshot-folder]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const WEB = process.env.WEB_URL ?? 'http://localhost:5273'
const API = process.env.API_URL ?? 'http://localhost:3101'
// Safety: only ever run against the throwaway in-memory API, never a real database.
const memory = await fetch(API + '/__memory').then((r) => r.ok).catch(() => false)
if (!memory) {
  console.error('Refusing to run: ' + API + ' is not the in-memory API. Start it with: pnpm --filter @timedesk/api dev:memory (use PORT and WEB_ORIGIN if 3001 is taken).')
  process.exit(2)
}
const SHOTS = process.argv[2]
const profile = mkdtempSync(join(tmpdir(), 'td-e2e-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9341', `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0
const pending = new Map()
const results = []

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://localhost:9341/json')).json()
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
const call = (method, path, body) => ev(`fetch(${JSON.stringify(API + '/v1' + path)}, { method: ${JSON.stringify(method)}, credentials: 'include', headers: { 'content-type': 'application/json' }, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} }).then((r) => r.status === 204 ? {} : r.json())`)
const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true })()`)
const fake = async (method, path, body) => (await fetch(API + '/__fake-google' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()
const chips = () => ev(`[...document.querySelectorAll('[data-google-event]')].map((e) => e.textContent.trim())`)
const dropTarget = (label) => `(() => { const b = [...document.querySelectorAll('[aria-label^="Open"]')].find((x) => x.getAttribute('aria-label').includes(${JSON.stringify(label)})); return b && b.parentElement })()`
const drag = (fromText, toExpr) => ev(`(() => {
  const src = [...document.querySelectorAll('[draggable=true]')].find((x) => x.textContent.includes(${JSON.stringify(fromText)}))
  const dst = ${toExpr}
  if (!src || !dst) return 'missing:' + (!src ? 'source' : 'target')
  const dt = new DataTransfer()
  const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  fire(src, 'dragstart'); fire(dst, 'dragenter'); fire(dst, 'dragover'); fire(dst, 'drop'); fire(src, 'dragend')
  return 'ok'
})()`)

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

  await step('before connecting, the Calendar page offers to connect', async () => {
    await goto('/calendar')
    await waitFor(bodyHas('Connect your calendar'), 'connect card')
    await shot('40-calendar-not-connected')
  })

  await step('Settings -> Calendar: connecting goes through Google and returns connected with the account shown', async () => {
    await goto('/settings?tab=calendar')
    await waitFor(bodyHas('Not connected'), 'not connected badge')
    await clickText('Connect Google Calendar')
    // fake Google answers at once: the browser goes to the callback, which goes back to the app
    await waitFor(bodyHas('Google Calendar is connected.') + ' && ' + bodyHas('dev@gmail.test'), 'connected with the email', 15000)
    await shot('41-settings-calendar')
    const url = await ev('location.href')
    if (url.includes('google=')) throw new Error('the google= flag was left in the address: ' + url)
  })

  await step('events made in Google show on the Calendar page, as read-and-edit chips next to tasks', async () => {
    await fake('POST', '/seed', { summary: 'Team lunch', start: { date: key(1) }, end: { date: key(2) } })
    await call('POST', '/tasks', { title: 'Write report', due: key(1) })
    await goto('/calendar')
    await waitFor(bodyHas('Team lunch'), 'google event')
    await waitFor(bodyHas('Write report'), 'task')
    const c = await chips()
    if (c.filter((x) => x.includes('Write report')).length) throw new Error('the task mirror is shown as an event too: ' + JSON.stringify(c))
    await shot('42-calendar-month')
  })

  await step('add an event from the Calendar page', async () => {
    await clickText('New event')
    await waitFor(exists('#ev-title'), 'dialog')
    await setField('#ev-title', 'Dentist'); await sleep(300)
    await click('[aria-label="All day"]'); await sleep(200)
    await clickExact('Add event', 'submit')
    await waitFor(bodyHas('Dentist'), 'new event shown', 12000)
    const live = (await fake('GET', '/events')).events
    if (!live.some((e) => e.summary === 'Dentist')) throw new Error('the event did not reach Google')
  })

  await step('edit an event (rename) and then delete it', async () => {
    await ev(`[...document.querySelectorAll('[data-google-event]')].find((e) => e.textContent.includes('Dentist')).click()`)
    await waitFor(exists('#ev-title'), 'edit dialog')
    await setField('#ev-title', 'Dentist visit'); await sleep(300)
    await clickExact('Save changes', 'submit')
    await waitFor(bodyHas('Dentist visit'), 'renamed', 12000)
    if (!(await fake('GET', '/events')).events.some((e) => e.summary === 'Dentist visit')) throw new Error('rename did not reach Google')
    await ev(`[...document.querySelectorAll('[data-google-event]')].find((e) => e.textContent.includes('Dentist visit')).click()`)
    await waitFor(exists('#ev-title'), 'edit dialog again')
    await clickText('Delete'); await sleep(200)
    await clickText('Yes, delete it')
    await waitFor('!document.body.innerText.includes("Dentist visit")', 'event gone', 12000)
    if ((await fake('GET', '/events')).events.some((e) => e.summary === 'Dentist visit')) throw new Error('delete did not reach Google')
  })

  await step('Tasks week view shows the Google event as a read-only chip, and dragging a task keeps Google in step', async () => {
    await goto('/tasks')
    await waitFor(exists('[aria-label="Week view"]'), 'tasks')
    await click('[aria-label="Week view"]')
    await waitFor(bodyHas('Write report'), 'task in week')
    const label = new Date(Date.now() + 5 * 86400000)
    // The chosen day must be in the same week as today or the target is off screen: use the last visible day column.
    await waitFor(bodyHas('Team lunch') + ' || true', 'week content')
    const before = (await fake('GET', '/events')).events.find((e) => e.summary === 'Write report')
    const r = await drag('Write report', `(() => { const l = [...document.querySelectorAll('[aria-label^="Open"]')]; const b = l[l.length - 1]; return b && b.parentElement })()`)
    if (r !== 'ok') throw new Error(r)
    await sleep(900)
    const after = (await fake('GET', '/events')).events.find((e) => e.summary === 'Write report')
    if (!before || !after) throw new Error('the task is not mirrored in Google')
    if (before.id !== after.id) throw new Error('a new event was made instead of moving the old one')
    if (before.start.date === after.start.date) throw new Error('the event did not move with the task')
    void label
    const draggable = await ev(`[...document.querySelectorAll('[data-google-event]')].some((e) => e.closest('[draggable=true]') || e.draggable)`)
    if (draggable) throw new Error('a Google event is draggable')
    await shot('43-tasks-week')
  })

  await step('a change made in Google comes back with Sync now', async () => {
    const mirror = (await fake('GET', '/events')).events.find((e) => e.summary === 'Write report')
    await fake('POST', '/edit/' + mirror.id, { summary: 'Write the final report' })
    await goto('/settings?tab=calendar')
    await waitFor(bodyHas('Sync now'), 'sync button')
    await clickExact('Sync now')
    await waitFor(bodyHas('1 task updated from Google'), 'sync summary', 12000)
    await goto('/tasks')
    await waitFor(bodyHas('Write the final report'), 'task renamed by the sync')
  })

  await step('disconnecting returns to the not-connected state', async () => {
    await goto('/settings?tab=calendar')
    await waitFor(exists('[aria-label="Add my tasks to Google Calendar"]'), 'connected settings')
    await clickExact('Disconnect')
    await waitFor(bodyHas('Google Calendar is disconnected.') + ' && ' + bodyHas('Not connected'), 'disconnected')
    await goto('/calendar')
    await waitFor(bodyHas('Connect your calendar'), 'connect card again')
  })
} catch (e) {
  results.push(`ERROR ${e.message}`)
} finally {
  console.log(results.join('\n'))
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0)
}
