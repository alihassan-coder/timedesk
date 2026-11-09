// Browser end-to-end: Tempo asks before it deletes, and asks a question with clickable answers.
// Needs: web on WEB_URL (default :5173) and a FRESH in-memory API with the scripted model:
//   MOCK_AI=1 pnpm --filter @timedesk/api dev:memory
// Run: node e2e/tempo-approval-flow.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const API = process.env.API_URL ?? 'http://localhost:3001'
const memory = await fetch(API + '/__memory').then((r) => r.ok).catch(() => false)
if (!memory) {
  console.error('Refusing to run: ' + API + ' is not the in-memory API.')
  process.exit(2)
}
const PORT = 9337
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'td-appr-'))}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })
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
const waitFor = async (expr, label, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true } catch { /* navigating */ } await sleep(150) } throw new Error(`timeout waiting for: ${label}`) }
const goto = async (path) => { await send('Page.navigate', { url: WEB + path }); await sleep(1000) }
const setField = (sel, val, tag = 'Input') => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTML${tag}Element.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const clickText = (text) => ev(`(() => { const b = [...document.querySelectorAll('button,a')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`)
const exists = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const count = (t) => `document.body.innerText.split(${JSON.stringify(t)}).length - 1`
const step = async (name, fn) => { try { await fn(); results.push(`PASS  ${name}`) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`) } }
let cookie = ''
const call = (method, path, body) => fetch(API + '/v1' + path, { method, headers: { 'content-type': 'application/json', Origin: WEB, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())
const say = async (text) => {
  await waitFor(exists('textarea'), 'composer')
  await setField('textarea', text, 'TextArea')
  await sleep(250)
  await ev(`document.querySelector('[aria-label="Send message"]').click()`)
}

try {
  await send('Page.enable')
  await step('sign up, sign in, add an AI key and a task', async () => {
    await goto('/register')
    await waitFor(exists('#name'), 'register form')
    for (const [sel, v] of [['#name', 'Admin Boss'], ['#username', 'boss'], ['#email', 'admin@local.test'], ['#password', 'correct-horse-battery'], ['#confirm', 'correct-horse-battery']]) await setField(sel, v)
    await sleep(300)
    await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Request access')).click()`)
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
    await call('PUT', '/ai/keys/openai', { key: 'sk-test-0123456789abcdef' })
    await call('POST', '/tasks', { title: 'Old draft' })
  })

  await step('Tempo asks before deleting; "Don\'t allow" leaves the task alone', async () => {
    await goto('/assistant')
    await sleep(800)
    await say('delete the task Old draft')
    await waitFor(exists('[aria-label="Tempo asks for your approval"]'), 'approval card')
    await waitFor(bodyHas('Delete the task "Old draft"'), 'says exactly what it will do')
    if (!(await call('GET', '/tasks')).tasks.some((t) => t.title === 'Old draft')) throw new Error('deleted before approval')
    await clickText("Don't allow")
    await waitFor(bodyHas('OK, I left it as it is.'), 'Tempo accepts the no')
    await waitFor(bodyHas('You said no'), 'the chip says it was refused')
    if (!(await call('GET', '/tasks')).tasks.some((t) => t.title === 'Old draft')) throw new Error('the task was deleted after "Don\'t allow"')
  })

  await step('"Allow" deletes it', async () => {
    await say('delete the task Old draft')
    await waitFor(`${count('Tempo wants to:')} >= 1 && [...document.querySelectorAll('[aria-label="Tempo asks for your approval"] button')].some((b) => b.textContent.trim() === 'Allow' && !b.disabled)`, 'second approval card')
    await ev(`[...document.querySelectorAll('[aria-label="Tempo asks for your approval"] button')].filter((b) => b.textContent.trim() === 'Allow' && !b.disabled).pop().click()`)
    await waitFor(bodyHas('Deleted.'), 'Tempo confirms')
    const t = Date.now()
    while (Date.now() - t < 5000 && (await call('GET', '/tasks')).tasks.some((x) => x.title === 'Old draft')) await sleep(250)
    if ((await call('GET', '/tasks')).tasks.some((x) => x.title === 'Old draft')) throw new Error('the task is still there')
  })

  await step('Tempo asks a question with choices; clicking one answers it', async () => {
    await say('which task should I start')
    await waitFor(exists('[aria-label="Tempo asks you"]'), 'question card')
    await waitFor(bodyHas('Which task do you mean?'), 'the question')
    await clickText('Q3 report')
    await waitFor(bodyHas('You picked: Q3 report.'), 'Tempo got the answer')
  })

  await step('the chat with approvals and answers reopens after a reload', async () => {
    await sleep(1500)
    await send('Page.reload')
    await sleep(2500)
    await waitFor(bodyHas('You picked: Q3 report.'), 'history kept', 15000)
  })
} catch (e) {
  results.push('ERROR ' + e.message)
} finally {
  console.log(results.join('\n'))
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0)
}
