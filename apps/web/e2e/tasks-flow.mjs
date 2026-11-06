// Browser end-to-end for the task views, drag and drop, project editing, the model picker and the default theme.
// Needs: web on :5173 and a FRESH in-memory API on :3001 (pnpm --filter @timedesk/api dev:memory).
// Run: node e2e/tasks-flow.mjs [screenshot-folder]
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
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9337', `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0
const pending = new Map()
const results = []

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://localhost:9337/json')).json()
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
const call = (method, path, body) => ev(`fetch(${JSON.stringify(API + "/v1" + path)}, { method: ${JSON.stringify(method)}, credentials: 'include', headers: { 'content-type': 'application/json' }, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} }).then((r) => r.status === 204 ? {} : r.json())`)
const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true })()`)
/** Drag the element holding `fromText` onto the element returned by the expression `toExpr`. */
const drag = (fromText, toExpr) => ev(`(() => {
  const src = [...document.querySelectorAll('[draggable=true]')].find((x) => x.textContent.includes(${JSON.stringify(fromText)}))
  const dst = ${toExpr}
  if (!src || !dst) return 'missing:' + (!src ? 'source' : 'target')
  const dt = new DataTransfer()
  const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  fire(src, 'dragstart'); fire(dst, 'dragenter'); fire(dst, 'dragover'); fire(dst, 'drop'); fire(src, 'dragend')
  return 'ok'
})()`)
const tasksFromApi = async () => (await call('GET', '/tasks')).tasks
const taskNamed = async (title) => (await tasksFromApi()).find((t) => t.title === title)
const both = (a, b) => `(${a}) && (${b})`
const firstDayColumn = `(() => { const b = document.querySelector('[aria-label^="Open"]'); return b && b.parentElement })()`
const lastDayColumn = `(() => { const l = [...document.querySelectorAll('[aria-label^="Open"]')]; const b = l[l.length - 1]; return b && b.parentElement })()`

try {
  await connect()
  await send('Page.enable')

  await step('the default theme is light, even when the computer prefers dark', async () => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    await goto('/login')
    await ev('localStorage.clear()')
    await goto('/login')
    await waitFor(exists('#login'), 'login form')
    if (await ev(`document.documentElement.classList.contains('dark')`)) throw new Error('page is dark by default')
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  })

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

  let projectId
  await step('a project can be created, renamed, recoloured and described', async () => {
    await goto('/projects')
    await waitFor(bodyHas('No projects yet'), 'empty state')
    await clickText('New project')
    await waitFor(exists('#pname'), 'dialog')
    await setField('#pname', 'Alpha'); await sleep(300)
    await clickExact('Create project', 'submit')
    await waitFor(exists('[aria-label="Options for Alpha"]'), 'project card')
    await click('[aria-label="Options for Alpha"]')
    await waitFor(bodyHas('Edit project'), 'menu')
    await clickText('Edit project')
    await waitFor(exists('#ename'), 'edit dialog')
    await setField('#ename', 'Alpha v2'); await setField('#edesc', 'Launch work')
    await click('[aria-label="Colour 3"]')
    await sleep(300)
    await clickExact('Save changes', 'submit')
    await waitFor(both(bodyHas('Alpha v2'), bodyHas('Launch work')), 'renamed card')
    const pr = await call('GET', '/projects'); if (!pr.projects) throw new Error('GET /projects -> ' + JSON.stringify(pr)); const p = pr.projects[0]
    projectId = p.id
    if (p.name !== 'Alpha v2' || p.color !== 3 || p.description !== 'Launch work') throw new Error('not saved: ' + JSON.stringify(p))
    await shot('20-projects')
  })

  await step('seed tasks through the API', async () => {
    await call('POST', '/tasks', { title: 'Plan sprint', due: key(0), projectId, priority: 'high' })
    await call('POST', '/tasks', { title: 'Write docs', due: key(1), projectId })
    await call('POST', '/tasks', { title: 'Loose idea' })
  })

  await step('week view shows the week range, and the tasks', async () => {
    await goto('/tasks')
    await waitFor(bodyHas('Plan sprint'), 'tasks')
    await click('[aria-label="Week view"]')
    await waitFor(both(bodyHas('Loose idea'), both(bodyHas('Plan sprint'), bodyHas('Write docs'))), 'week content')
    await waitFor(`/[–-]/.test(document.querySelector('[aria-live=polite]')?.textContent ?? '')`, 'week title range')
    await shot('21-week')
  })

  await step('drag a task to another day in the week view reschedules it (saved in the database)', async () => {
    const r = await drag('Plan sprint', lastDayColumn)
    if (r !== 'ok') throw new Error(r)
    await sleep(700)
    const t = await taskNamed('Plan sprint')
    if (t.due === key(0)) throw new Error('due date did not change')
  })

  await step('drag an unscheduled task onto a day gives it a date', async () => {
    const r = await drag('Loose idea', firstDayColumn)
    if (r !== 'ok') throw new Error(r)
    await sleep(700)
    if (!(await taskNamed('Loose idea')).due) throw new Error('still no date')
  })

  await step('month view shows a full grid with the tasks', async () => {
    await click('[aria-label="Month view"]')
    await waitFor(bodyHas('Plan sprint'), 'month content')
    const cells = await ev(`document.querySelectorAll('[role=button][aria-label*=","]').length`)
    if (cells < 28) throw new Error('only ' + cells + ' day cells')
    await shot('22-month')
  })

  await step('dragging a task onto a day in the month grid reschedules it', async () => {
    const r = await drag('Write docs', `(() => { const c = document.querySelectorAll('[role=button][aria-label*=","]'); return c[10].parentElement })()`)
    if (r !== 'ok') throw new Error(r)
    await sleep(700)
    const t = await taskNamed('Write docs')
    if (t.due === key(1)) throw new Error('due date did not change')
  })

  await step('clicking a day opens the day view, which pre-fills the date for a new task', async () => {
    await ev(`document.querySelector('[role=button][aria-label*=","]').click()`)
    await waitFor(bodyHas('Add to this day'), 'day view')
    await clickText('Add to this day')
    await waitFor(exists('#due'), 'new task dialog')
    const due = await ev(`document.querySelector('#due').value`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('due not prefilled: ' + due)
    await shot('23-day-add')
  })

  await step('board: dragging a card to Done completes the task', async () => {
    await goto('/tasks')
    await waitFor(exists('[aria-label="Board view"]'), 'tasks')
    await click('[aria-label="Board view"]')
    await waitFor(bodyHas('Write docs'), 'board')
    const r = await drag('Write docs', `(() => { const h = [...document.querySelectorAll('h2')].find((x) => x.textContent.trim().startsWith('Done')); return h && h.parentElement })()`)
    if (r !== 'ok') throw new Error(r)
    await sleep(700)
    if ((await taskNamed('Write docs')).status !== 'done') throw new Error('status not changed')
    await shot('24-board')
  })

  await step('the model picker opens wide enough to read every model name', async () => {
    await call('PUT', '/ai/keys/groq', { key: 'gsk-test-0123456789abcdef' })
    await goto('/assistant')
    await waitFor(exists('[aria-label="Model"]'), 'model trigger')
    await waitFor(`!document.querySelector('[aria-label="Model"]').disabled`, 'model enabled')
    await click('[aria-label="Model"]')
    await waitFor(exists('[role=option]'), 'options')
    await sleep(300)
    const m = await ev(`(() => { const o = [...document.querySelectorAll('[role=option]')]; const p = document.querySelector('[data-slot=select-content]'); return { n: o.length, w: Math.round(p.getBoundingClientRect().width), clipped: o.some((x) => x.scrollWidth > x.clientWidth + 1) || p.scrollWidth > p.clientWidth + 1 } })()`)
    await shot('25-model-picker')
    if (m.n < 1) throw new Error('no options')
    if (m.w < 280) throw new Error('popup too narrow: ' + m.w)
    if (m.clipped) throw new Error('text is clipped')
  })

  await step('deleting a project keeps its tasks (they become "no project")', async () => {
    await goto('/projects')
    await waitFor(exists('[aria-label="Options for Alpha v2"]'), 'project')
    await click('[aria-label="Options for Alpha v2"]')
    await waitFor(bodyHas('Delete project'), 'menu')
    await clickText('Delete project')
    await waitFor(bodyHas('Delete Alpha v2?'), 'confirm')
    await clickExact('Delete project')
    await waitFor(bodyHas('No projects yet'), 'project gone')
    const t = await taskNamed('Write docs')
    if (!t || t.projectId !== null) throw new Error('task lost its data: ' + JSON.stringify(t))
  })
} catch (e) {
  results.push(`ERROR ${e.message}`)
} finally {
  console.log(results.join('\n'))
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0)
}
