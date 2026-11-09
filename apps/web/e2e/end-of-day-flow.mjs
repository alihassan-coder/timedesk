// Browser end-to-end: today's top 3, filling in the gaps of the day, and wrapping up the day.
// Needs: web on WEB_URL (default :5173) and a FRESH in-memory API: MOCK_AI=1 pnpm --filter @timedesk/api dev:memory
// Run: node e2e/end-of-day-flow.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const API = process.env.API_URL ?? 'http://localhost:3001'
if (!(await fetch(API + '/__memory').then((r) => r.ok).catch(() => false))) {
  console.error('Refusing to run: ' + API + ' is not the in-memory API.')
  process.exit(2)
}
const PORT = 9339
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'td-eod-'))}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' })
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
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
const waitFor = async (expr, label, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return } catch { /* navigating */ } await sleep(150) } throw new Error('timeout waiting for: ' + label) }
const goto = async (path) => { await send('Page.navigate', { url: WEB + path }); await sleep(1200) }
const setField = (sel, val) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const press = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' })); return true })()`)
const pressText = (text, tag = 'button') => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!el) return false; for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' })); return true })()`)
const exists = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const step = async (name, fn) => { try { await fn(); results.push(`PASS  ${name}`) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`) } }
let cookie = ''
const call = (method, path, body) => fetch(API + '/v1' + path, { method, headers: { 'content-type': 'application/json', Origin: WEB, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())
const key = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString()
const tasksFromApi = async () => (await call('GET', '/tasks')).tasks

try {
  await send('Page.enable')
  await step('sign up and set up a day: a project, tasks due today, time with a gap where an app was in use', async () => {
    await goto('/register')
    await waitFor(exists('#name'), 'register form')
    for (const [sel, v] of [['#name', 'Admin Boss'], ['#username', 'boss'], ['#email', 'admin@local.test'], ['#password', 'correct-horse-battery'], ['#confirm', 'correct-horse-battery']]) await setField(sel, v)
    await sleep(300)
    await pressText('Request access')
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
    const { project } = await call('POST', '/projects', { name: 'Site' })
    const { task: hero } = await call('POST', '/tasks', { title: 'Hero section', projectId: project.id, due: key(0), priority: 'high' })
    await call('POST', '/tasks', { title: 'Pricing copy', projectId: project.id, due: key(0) })
    await call('POST', '/tasks', { title: 'Read docs' })
    // Two days ago: Code was in front while a Site timer ran, so Code is learned as Site.
    const twoDays = Date.now() - 2 * 86_400_000
    await call('POST', '/time-entries', { id: 'eod-history-0001', projectId: project.id, startedAt: new Date(twoDays).toISOString(), endedAt: new Date(twoDays + 3_600_000).toISOString() })
    // Today: tracked 50-40 min ago, a 15 min gap with Code in front, tracked again 25-15 min ago.
    await call('POST', '/time-entries', { id: 'eod-today-00001', taskId: hero.id, startedAt: ago(50), endedAt: ago(40) })
    await call('POST', '/time-entries', { id: 'eod-today-00002', taskId: hero.id, startedAt: ago(25), endedAt: ago(15) })
    await call('POST', '/activity', {
      samples: [
        { id: 'eod-sample-0001', app: 'Code', title: '', startedAt: new Date(twoDays).toISOString(), seconds: 3600 },
        { id: 'eod-sample-0002', app: 'Code', title: '', startedAt: ago(40), seconds: 900 },
      ],
    })
    await call('POST', '/time-entries/start', { id: 'eod-running-001', taskId: hero.id })
    await goto('/')
  })

  await step("today's top 3: pick a task on the dashboard, star one on the Tasks page", async () => {
    await waitFor(exists('[data-testid="top-tasks"]'), 'top 3 card')
    await pressText('Pick your first task')
    await waitFor(`[...document.querySelectorAll('[role=menuitem]')].some((x) => x.textContent.includes('Hero section'))`, 'pick menu')
    await pressText('Hero section', '[role=menuitem]')
    await waitFor(`document.querySelector('[data-testid="top-tasks"]').innerText.includes('Hero section')`, 'picked')
    await goto('/tasks')
    await waitFor(exists('[aria-label="Add Pricing copy to today\'s top 3"]'), 'star on the task row')
    await ev(`document.querySelector('[aria-label="Add Pricing copy to today\\'s top 3"]').click()`)
    const t = Date.now()
    let top = []
    while (Date.now() - t < 8000) {
      top = (await tasksFromApi()).filter((x) => x.topDay === key(0)).sort((a, b) => a.topRank - b.topRank).map((x) => x.title)
      if (top.length === 2) break
      await sleep(300)
    }
    if (top.join('|') !== 'Hero section|Pricing copy') throw new Error('top 3 on the server: ' + JSON.stringify(top))
  })

  await step('wrap-up 1: the running timer is stopped', async () => {
    await goto('/wrap-up')
    await waitFor(bodyHas('Wrap up your day'), 'wrap-up page')
    await waitFor(bodyHas('Still running'), 'running timer listed')
    await pressText('Stop it now')
    await waitFor(bodyHas('No timer is running'), 'stopped')
  })

  await step('wrap-up 2: the gap where Code was in front is suggested for Site, and Add tracks it', async () => {
    await waitFor(exists('[data-testid="fill-gaps"]'), 'suggestions')
    await waitFor(bodyHas('usually Site'), 'learned project')
    const before = (await call('GET', '/time-entries')).entries.length
    await ev(`[...document.querySelectorAll('[data-testid="fill-gaps"] button')].find((b) => b.textContent.trim() === 'Add').click()`)
    const t = Date.now()
    let entries = []
    while (Date.now() - t < 8000) {
      entries = (await call('GET', '/time-entries')).entries
      if (entries.length > before) break
      await sleep(300)
    }
    const added = entries.find((e) => !e.id.startsWith('eod-'))
    if (!added) throw new Error('nothing was added')
    const minutes = (Date.parse(added.endedAt) - Date.parse(added.startedAt)) / 60_000
    if (minutes < 10 || minutes > 20) throw new Error('added ' + minutes + ' minutes')
    const { projects } = await call('GET', '/projects')
    if (added.projectId !== projects.find((p) => p.name === 'Site').id) throw new Error('not on Site')
  })

  await step('wrap-up 3 and 4: today in numbers, and the open tasks move to tomorrow', async () => {
    await waitFor(bodyHas('What you did today'), 'summary')
    await waitFor(bodyHas('Move what is left to tomorrow'), 'left over step')
    await pressText('to tomorrow')
    const t = Date.now()
    let due = []
    while (Date.now() - t < 8000) {
      due = (await tasksFromApi()).filter((x) => ['Hero section', 'Pricing copy'].includes(x.title)).map((x) => x.due)
      if (due.every((d) => d === key(1))) break
      await sleep(300)
    }
    if (!due.every((d) => d === key(1))) throw new Error('due dates: ' + JSON.stringify(due))
  })

  await step("wrap-up 5: pick tomorrow's top 3, then finish the day", async () => {
    await pressText('Pick a task for tomorrow')
    await waitFor(`[...document.querySelectorAll('[role=menuitem]')].some((x) => x.textContent.includes('Hero section'))`, 'tomorrow menu')
    await pressText('Hero section', '[role=menuitem]')
    const t = Date.now()
    while (Date.now() - t < 8000 && !(await tasksFromApi()).some((x) => x.title === 'Hero section' && x.topDay === key(1))) await sleep(300)
    if (!(await tasksFromApi()).some((x) => x.title === 'Hero section' && x.topDay === key(1))) throw new Error("not in tomorrow's top 3")
    await pressText('Finish the day')
    await waitFor(bodyHas('Day wrapped up'), 'finished')
    await goto('/')
    await sleep(800)
    if (await ev(bodyHas('Time to wrap up?'))) throw new Error('the dashboard still asks to wrap up after it was done')
  })
} catch (e) {
  results.push('ERROR ' + e.message)
} finally {
  console.log(results.join('\n'))
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
  process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0)
}
