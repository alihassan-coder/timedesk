// Browser end-to-end: Tempo's briefings (plan my day, daily summary, weekly review) from the dashboard, the Ctrl+K
// palette and the review page; saving a weekly reflection; downloading your data (JSON and CSV); deleting the account.
// Needs: web on :5173 and a FRESH in-memory API with the scripted AI on :3001 (MOCK_AI=1 pnpm --filter @timedesk/api dev:memory).
// Run: node e2e/tempo-account-flow.mjs [screenshot-folder]
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const profile = mkdtempSync(join(tmpdir(), 'td-e2e-'))
const downloads = mkdtempSync(join(tmpdir(), 'td-dl-'))
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
const setField = (sel, val) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const clickText = (text) => ev(`(() => { const b = [...document.querySelectorAll('button,a,[role=menuitem],[role=option]')].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
const clickExact = (text) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`)
const isDisabled = (text) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); return b ? b.disabled : null })()`)
const exists = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`
const bodyHas = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`
const shot = async (name) => { if (!SHOTS) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64')) }
const step = async (name, fn) => { try { await fn(); results.push(`PASS  ${name}`) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`); await shot('fail-' + name.replace(/\W+/g, '-')) } }

const key = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const call = (method, path, body) => ev(`fetch(${JSON.stringify(API + '/v1' + path)}, { method: ${JSON.stringify(method)}, credentials: 'include', headers: { 'content-type': 'application/json' }, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} }).then(async (r) => ({ status: r.status, body: r.status === 204 ? {} : await r.json().catch(() => ({})) }))`)
const ctrlK = () => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))`)
const PALETTE = 'input[aria-label="Command palette"]'
const PASSWORD = 'correct-horse-battery'
const userMessages = () => ev(`fetch(${JSON.stringify(API + '/v1/chats')}, { credentials: 'include' }).then((r) => r.json()).then(async ({ chats }) => Promise.all(chats.map((c) => fetch(${JSON.stringify(API + '/v1/chats/')} + c.id, { credentials: 'include' }).then((r) => r.json()).then((x) => x.chat.messages.filter((m) => m.role === 'user').map((m) => m.parts.map((p) => p.text).join(''))))))`)
const waitForFile = async (pattern, label) => { const t = Date.now(); while (Date.now() - t < 8000) { const f = readdirSync(downloads).find((n) => pattern.test(n) && !n.endsWith('.crdownload')); if (f) return join(downloads, f); await sleep(200) } throw new Error('no download: ' + label) }

try {
  await connect()
  await send('Page.enable')
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })

  await step('admin registers and signs in', async () => {
    await goto('/register')
    await waitFor(exists('#name'), 'register form')
    for (const [sel, v] of [['#name', 'Admin Boss'], ['#username', 'boss'], ['#email', 'admin@local.test'], ['#password', PASSWORD], ['#confirm', PASSWORD]]) await setField(sel, v)
    await sleep(300)
    await clickText('Request access')
    await waitFor(bodyHas('Request sent'), 'request sent')
    await goto('/login')
    await waitFor(exists('#login'), 'login form')
    await setField('#login', 'boss'); await setField('#password', PASSWORD); await sleep(200)
    await clickExact('Sign in')
    await waitFor(bodyHas('Tracked today'), 'dashboard')
  })

  await step('set up: an AI key, a project, tasks (overdue, due today, finished) and some tracked time', async () => {
    if ((await call('PUT', '/ai/keys/openai', { key: 'sk-test-0123456789abcdef' })).status !== 200) throw new Error('key not saved')
    const p = (await call('POST', '/projects', { name: 'Website' })).body.project
    await call('POST', '/tasks', { title: 'Overdue tax form', due: key(-2), projectId: p.id })
    await call('POST', '/tasks', { title: 'Standup notes', due: key(0) })
    const done = (await call('POST', '/tasks', { title: 'Finished landing page', projectId: p.id })).body.task
    await call('PATCH', `/tasks/${done.id}`, { status: 'done' })
    await call('POST', '/time-entries/start', { projectId: p.id })
    await sleep(1200)
    await call('POST', '/time-entries/stop', {})
  })

  await step('the dashboard offers the three Tempo briefings', async () => {
    await goto('/')
    await waitFor(bodyHas('Ask Tempo'), 'tempo card')
    for (const t of ['Plan my day', 'Summarize my day', 'Weekly review']) if (!(await ev(bodyHas(t)))) throw new Error('missing ' + t)
    await shot('40-dashboard-tempo')
  })

  await step('"Plan my day" opens Tempo, sends the question once, and the plan starts with the overdue task', async () => {
    await clickText('Plan my day')
    await waitFor(bodyHas('Your plan. First: Overdue tax form.'), 'plan reply', 15000)
    if ((await ev('location.search')).includes('ask=')) throw new Error('the question stayed in the address, a reload would send it again')
    await sleep(1500)
    const sent = (await userMessages()).flat()
    if (sent.filter((m) => m === 'Plan my day').length !== 1) throw new Error('sent ' + JSON.stringify(sent))
    await shot('41-plan-my-day')
  })

  await step('reloading the assistant does not send the question again', async () => {
    await goto('/assistant')
    await sleep(1500)
    const sent = (await userMessages()).flat()
    if (sent.length !== 1) throw new Error('sent ' + JSON.stringify(sent))
  })

  await step('Ctrl+K "Summarize my day" gives a summary in a new chat', async () => {
    await goto('/')
    await waitFor(bodyHas('Tracked today'), 'dashboard')
    await ctrlK()
    await waitFor(exists(PALETTE), 'palette')
    await setField(PALETTE, 'summarize')
    await sleep(300)
    await clickText('Summarize my day')
    await waitFor(bodyHas('Your day: 0m tracked.'), 'summary reply', 15000)
    await sleep(1500)
    if ((await userMessages()).length !== 2) throw new Error('expected a second chat')
  })

  await step('the weekly review lists only what was finished this week, and saves the reflection', async () => {
    await goto('/review')
    await waitFor(bodyHas('This week'), 'review page')
    const wins = await ev(`document.querySelector('[data-testid=wins]').innerText`)
    if (!wins.includes('Finished landing page') || wins.includes('Overdue tax form')) throw new Error('wins: ' + wins)
    if (!(await ev(bodyHas('Overdue tax form')))) throw new Error('carry over missing the overdue task')
    await waitFor(`!document.querySelector('#well').disabled`, 'reflection loaded')
    await setField('#well', 'Shipped the landing page')
    await setField('#improve', 'Start the tax form on Monday')
    await sleep(200)
    await clickExact('Save review')
    await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Saved')`, 'saved state')
    await shot('42-review-saved')
  })

  await step('the reflection is still there after a reload, and other weeks have their own', async () => {
    await goto('/review')
    await waitFor(`document.querySelector('#well') && document.querySelector('#well').value === 'Shipped the landing page'`, 'saved text')
    await ev(`document.querySelector('[aria-label="Previous week"]').click()`)
    await waitFor(bodyHas('Last week'), 'last week label')
    await waitFor(`document.querySelector('#well') && !document.querySelector('#well').disabled && document.querySelector('#well').value === ''`, 'empty last week')
    if (!(await ev(bodyHas('Nothing finished in this week.')))) throw new Error('last week shows wins from this week')
    await clickText('Back to this week')
    await waitFor(`document.querySelector('#well').value === 'Shipped the landing page'`, 'back to this week')
  })

  await step('"Ask Tempo" on the review page writes the weekly review', async () => {
    await clickText('Ask Tempo')
    await waitFor(bodyHas('Your week: 0m tracked.'), 'weekly reply', 15000)
  })

  await step('Settings: download everything as JSON (with the reflection, without the key)', async () => {
    await goto('/settings?tab=account')
    await waitFor(bodyHas('Your data'), 'data card')
    await ev(`document.querySelector('[aria-label="Download all my data as JSON"]').click()`)
    const file = await waitForFile(/^timedesk-export-.*\.json$/, 'json export')
    const raw = readFileSync(file, 'utf8')
    const data = JSON.parse(raw)
    if (data.user.username !== 'boss') throw new Error('wrong user')
    if (!data.tasks.some((t) => t.title === 'Finished landing page' && t.completedAt)) throw new Error('task or completedAt missing')
    if (data.weeklyReviews[0]?.wentWell !== 'Shipped the landing page') throw new Error('reflection missing')
    if (data.chats.length !== 3) throw new Error('chats: ' + data.chats.length)
    if (raw.includes('sk-test-0123456789abcdef')) throw new Error('the AI key is in the export')
    await waitFor(bodyHas('Your data was downloaded.'), 'confirmation')
  })

  await step('Settings: download tracked time as CSV', async () => {
    await ev(`document.querySelector('[aria-label="Download tracked time as CSV"]').click()`)
    const file = await waitForFile(/^timedesk-time-.*\.csv$/, 'csv export')
    const lines = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r\n/)
    if (lines[0] !== 'Date,Start,End,Duration,Hours,Project,Task') throw new Error('header: ' + lines[0])
    if (lines.length !== 2 || !lines[1].includes(',Website,')) throw new Error('rows: ' + JSON.stringify(lines))
  })

  await step('delete account: the button waits for the name and password, and a wrong password is refused', async () => {
    await clickText('Delete my account')
    await waitFor(exists('#delete-password'), 'dialog')
    if ((await isDisabled('Delete everything')) !== true) throw new Error('enabled before confirming')
    await setField('#delete-confirm', 'boss')
    await setField('#delete-password', 'not-my-password')
    await sleep(200)
    if ((await isDisabled('Delete everything')) !== false) throw new Error('still disabled')
    await clickExact('Delete everything')
    await waitFor(bodyHas('That password is not right.'), 'wrong password message')
    if ((await call('GET', '/me')).status !== 200) throw new Error('signed out after a wrong password')
    await shot('43-delete-dialog')
  })

  await step('delete account with the right password: back to sign in with a notice, and the account is gone', async () => {
    await setField('#delete-password', PASSWORD)
    await sleep(200)
    await clickExact('Delete everything')
    await waitFor(bodyHas('Your account and all its data were deleted.'), 'notice on sign in', 10000)
    if (!(await ev('location.pathname')).startsWith('/login')) throw new Error('not on the sign in page')
    if ((await call('GET', '/me')).status !== 401) throw new Error('still signed in')
    await shot('44-deleted')
    await setField('#login', 'boss'); await setField('#password', PASSWORD); await sleep(200)
    await clickExact('Sign in')
    await sleep(1500)
    if (!(await ev('location.pathname')).startsWith('/login')) throw new Error('could sign in to a deleted account')
    const left = await ev(`JSON.stringify(localStorage)`)
    if (left.includes('Finished landing page')) throw new Error('data left in this browser')
  })
} finally {
  console.log(results.join('\n'))
  const failed = results.filter((r) => r.startsWith('FAIL')).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  ws?.close()
  chrome.kill()
  process.exitCode = failed ? 1 : 0
  if (!existsSync(downloads)) console.log('no downloads folder')
}
