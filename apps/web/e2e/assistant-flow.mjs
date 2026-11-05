// Browser end-to-end for Tempo: save an API key, chat, the agent creates a task through a tool, and the chat is kept in history.
// Needs: web on :5173 and a FRESH in-memory API started with the scripted fake model:
//   MOCK_AI=1 pnpm --filter @timedesk/api dev:memory      (use PORT and WEB_ORIGIN if 3001 is taken)
// Run: node e2e/assistant-flow.mjs [screenshot-folder]
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
  console.error('Refusing to run: ' + API + ' is not the in-memory API. Start it with: MOCK_AI=1 pnpm --filter @timedesk/api dev:memory')
  process.exit(2)
}
const SHOTS = process.argv[2]
const KEY = 'sk-test-0123456789abcdef'
const profile = mkdtempSync(join(tmpdir(), 'td-e2e-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9336', `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0
const pending = new Map()
const results = []

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://localhost:9336/json')).json()
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
const waitFor = async (expr, label, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(150) } throw new Error(`timeout waiting for: ${label}`) }
const goto = async (path) => { await send('Page.navigate', { url: WEB + path }); await sleep(900) }
const setField = (sel, val, tag = 'Input') => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTML${tag}Element.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const clickText = (text) => ev(`(() => { const b = [...document.querySelectorAll('button,a,[role=menuitem]')].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
const clickExact = (text, type) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && (!${JSON.stringify(type ?? '')} || x.type === ${JSON.stringify(type ?? '')})); if (!b) return false; b.click(); return true })()`)
const exists = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`
const bodyHas = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`
const shot = async (name) => { if (!SHOTS) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64')) }
const step = async (name, fn) => { try { await fn(); results.push(`PASS  ${name}`) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`); await shot('fail-' + name.replace(/\W+/g, '-')) } }

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

  await step('without a key the assistant asks for one', async () => {
    await goto('/assistant')
    await waitFor(bodyHas('Add an API key to chat with Tempo'), 'key banner')
    await shot('20-assistant-no-key')
  })

  await step('saving an OpenAI key shows Connected and models appear', async () => {
    await goto('/settings?tab=ai')
    await waitFor(exists('input[aria-label="OpenAI API key"]'), 'key field')
    await setField('input[aria-label="OpenAI API key"]', KEY); await sleep(300)
    await clickExact('Save key', 'submit')
    await waitFor(bodyHas('Connected'), 'connected badge')
    await waitFor(bodyHas('models available'), 'models listed')
    if (await ev(bodyHas(KEY))) throw new Error('the raw key is visible on the page')
    await shot('21-key-saved')
  })

  await step('the raw key is not kept in the browser', async () => {
    const stored = await ev('JSON.stringify(localStorage) + document.cookie')
    if (stored.includes(KEY)) throw new Error('key found in browser storage')
  })

  await step('asking Tempo to add a task runs the tool and answers', async () => {
    await goto('/assistant')
    await waitFor(exists('textarea'), 'composer')
    await sleep(800)
    await setField('textarea', 'add a task: Buy milk', 'TextArea'); await sleep(300)
    await ev(`document.querySelector('[aria-label="Send message"]').click()`)
    await waitFor(bodyHas('Created a task'), 'tool chip', 15000)
    await waitFor(bodyHas('Done. I added that to your tasks.'), 'final answer', 15000)
    await shot('22-chat-tool')
  })

  await step('the new task really exists in the app', async () => {
    await goto('/tasks')
    await waitFor(bodyHas('Buy milk'), 'task in list')
  })

  await step('the chat is kept in history and reopens', async () => {
    await goto('/assistant')
    await waitFor(bodyHas('add a task: Buy milk'), 'chat title in history')
    await clickText('add a task: Buy milk')
    await waitFor(bodyHas('Done. I added that to your tasks.'), 'messages restored')
  })

  await step('the chat is saved in the database: it survives wiping this browser completely', async () => {
    await ev('localStorage.clear()')
    await goto('/assistant')
    await waitFor(bodyHas('add a task: Buy milk'), 'chat title comes back from the server')
    await clickText('add a task: Buy milk')
    await waitFor(bodyHas('Done. I added that to your tasks.'), 'messages load from the server')
    await shot('23-chat-from-db')
  })

  await step('appearance follows you: a new accent colour is saved and restored on a wiped browser', async () => {
    await goto('/settings')
    await waitFor(exists('button[aria-label="Violet"]'), 'accent swatches')
    await ev("document.querySelector('button[aria-label=\"Violet\"]').click()")
    await waitFor('document.documentElement.dataset.accent === "violet"', 'violet applied locally')
    await sleep(1500)
    await ev('localStorage.clear()')
    await goto('/')
    await waitFor('document.documentElement.dataset.accent === "violet"', 'violet restored from the server', 12000)
  })

  await step('the app keeps a fast local copy of your data and wipes it on sign out', async () => {
    await goto('/tasks')
    await waitFor(bodyHas('Buy milk'), 'task visible')
    await sleep(600)
    if (!(await ev('Object.keys(localStorage).some((k) => k.startsWith("timedesk:cache:data:"))'))) throw new Error('no local data cache was written')
    await ev('[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Admin Boss")).click()')
    await waitFor(bodyHas('Sign out'), 'menu open')
    await clickText('Sign out')
    await waitFor('location.pathname === "/login"', 'signed out')
    if (await ev('Object.keys(localStorage).some((k) => k.startsWith("timedesk:cache:"))')) throw new Error('cached data was left behind after sign out')
  })
} catch (e) {
  results.push(`ERROR ${e.message}`)
} finally {
  console.log(results.join('\n'))
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0)
}
