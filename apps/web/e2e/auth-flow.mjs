// Browser end-to-end: register -> blocked while pending -> admin approves -> member signs in.
// Needs: web on :5173 (pnpm dev) and the in-memory API on :3001 (pnpm --filter @timedesk/api dev:memory), fresh.
// Run: node e2e/auth-flow.mjs [screenshot-folder]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const WEB = 'http://localhost:5173'
const SHOTS = process.argv[2]
const profile = mkdtempSync(join(tmpdir(), 'td-e2e-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0
const pending = new Map()
const results = []

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://localhost:9333/json')).json()
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
const goto = async (path) => { await send('Page.navigate', { url: WEB + path }); await sleep(700) }
const setField = (sel, val) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const clickText = (text) => ev(`(() => { const b = [...document.querySelectorAll('button,a,[role=menuitem]')].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
const bodyHas = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`
const shot = async (name) => { if (!SHOTS) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64')) }
const step = async (name, fn) => { try { await fn(); results.push(`PASS  ${name}`) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`); await shot('fail-' + name.replace(/\W+/g, '-')) } }

async function register({ name, username, email, password }) {
  await goto('/register')
  await waitFor(`!!document.querySelector('#name')`, 'register form')
  for (const [sel, v] of [['#name', name], ['#username', username], ['#email', email], ['#password', password], ['#confirm', password]]) await setField(sel, v)
  await sleep(300)
  await clickText('Request access')
}
async function signIn(login, password) {
  await goto('/login')
  await waitFor(`!!document.querySelector('#login')`, 'login form')
  await setField('#login', login); await setField('#password', password)
  await sleep(300)
  await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Sign in') && b.type === 'submit').click()`)
}

try {
  await connect()
  await send('Page.enable')

  await step('signed-out visitor is sent to /login', async () => {
    await goto('/')
    await waitFor(`location.pathname === '/login'`, 'redirect to /login')
    await shot('01-login')
  })

  await step('register shows "Request sent"', async () => {
    await register({ name: 'Sam Member', username: 'sam', email: 'sam@example.com', password: 'correct-horse-battery' })
    await waitFor(bodyHas('Request sent'), 'request sent card')
    await shot('02-request-sent')
  })

  await step('pending member cannot sign in and is told why', async () => {
    await signIn('sam', 'correct-horse-battery')
    await waitFor(bodyHas('waiting for admin approval'), 'approval message')
    await shot('03-pending-blocked')
  })

  await step('admin email registers and signs in to the dashboard', async () => {
    await register({ name: 'Admin Boss', username: 'boss', email: 'admin@local.test', password: 'correct-horse-battery' })
    await waitFor(bodyHas('Request sent'), 'admin request sent')
    await signIn('boss', 'correct-horse-battery')
    await waitFor(`location.pathname === '/'`, 'dashboard url')
    await waitFor(bodyHas('Team members'), 'admin nav item')
    await shot('04-admin-dashboard')
  })

  await step('admin sees sam pending and approves', async () => {
    await clickText('Team members')
    await waitFor(`location.pathname === '/admin'`, 'admin url')
    await waitFor(bodyHas('sam@example.com'), 'sam in pending list')
    await shot('05-admin-pending')
    await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve').click()`)
    await waitFor(bodyHas('No pending accounts'), 'pending list empties')
  })

  await step('admin signs out', async () => {
    await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('admin@local.test') || b.textContent.includes('Admin Boss')).click()`)
    await waitFor(bodyHas('Sign out'), 'menu open')
    await clickText('Sign out')
    await waitFor(`location.pathname === '/login'`, 'back to login')
  })

  await step('approved member signs in by email and has no admin menu', async () => {
    await signIn('sam@example.com', 'correct-horse-battery')
    await waitFor(`location.pathname === '/'`, 'dashboard url')
    await waitFor(bodyHas('Good '), 'greeting')
    if (await ev(bodyHas('Team members'))) throw new Error('member can see the admin menu')
    await shot('06-member-dashboard')
  })

  await step('member opening /admin gets no member list', async () => {
    await goto('/admin')
    await waitFor(bodyHas('Only admins can see this page'), 'admin guard text')
  })
} catch (e) {
  results.push(`ERROR ${e.message}`)
} finally {
  console.log(results.join('\n'))
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0)
}
