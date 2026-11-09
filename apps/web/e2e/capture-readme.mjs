// Makes the screenshots and the animated demo in docs/media for the README, from the real app filled with made-up
// demo data. It only captures the app's own page in a headless browser (never the screen), against the throwaway
// in-memory API, so no real account or data can appear.
//   MOCK_AI=1 pnpm --filter @timedesk/api dev:memory      (fresh)
//   pnpm --filter @timedesk/web dev
//   node e2e/capture-readme.mjs                          (needs ffmpeg on PATH for the GIF)
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const API = process.env.API_URL ?? 'http://localhost:3001'
const OUT = new URL('../../../docs/media/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
if (!(await fetch(API + '/__memory').then((r) => r.ok).catch(() => false))) {
  console.error('Refusing to run: ' + API + ' is not the in-memory API.')
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })
const W = 1440
const H = 900
const PORT = 9338
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'td-media-'))}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0
const pending = new Map()
const listeners = []
for (let i = 0; i < 40 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://localhost:${PORT}/json`)).json()).find((t) => t.type === 'page')
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl)
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
      ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } else if (d.method) listeners.forEach((l) => l(d)) }
    }
  } catch { /* starting */ }
  if (!ws) await sleep(250)
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
const waitFor = async (expr, label, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return } catch { /* navigating */ } await sleep(150) } throw new Error('timeout: ' + label) }
const goto = async (path) => { await send('Page.navigate', { url: WEB + path }); await sleep(1500) }
const setField = (sel, val, tag = 'Input') => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTML${tag}Element.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const press = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' })); return true })()`)
const exists = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const shot = async (name) => {
  await sleep(700)
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'))
  console.log('saved ' + name + '.png')
}
let cookie = ''
const call = async (method, path, body) => {
  const r = await fetch(API + '/v1' + path, { method, headers: { 'content-type': 'application/json', Origin: WEB, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined })
  return r.status === 204 ? {} : r.json()
}

// ---- demo data: made up, typical of a small studio ----------------------------------------------------------
const H1 = 3_600_000
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d) }
async function seed() {
  const projects = {}
  for (const [name, description, color, customColor] of [
    ['Website redesign', 'New marketing site', 1, null],
    ['Northwind (client)', 'Brand refresh for Northwind', 1, '#f97316'],
    ['Mobile app', 'iOS and Android', 2, null],
    ['Operations', 'Invoices, planning, admin', 3, null],
    ['Learning', 'Courses and reading', 4, null],
  ]) projects[name] = (await call('POST', '/projects', { name, description, color, customColor })).project.id
  const tasks = {}
  for (const [title, project, priority, due, status] of [
    ['Homepage hero section', 'Website redesign', 'high', plusDays(0), 'in_progress'],
    ['Pricing page copy', 'Website redesign', 'medium', plusDays(1), 'todo'],
    ['Fix mobile menu', 'Website redesign', 'high', plusDays(-1), 'todo'],
    ['Logo variations', 'Northwind (client)', 'high', plusDays(0), 'todo'],
    ['Render promo video', 'Northwind (client)', 'medium', plusDays(2), 'in_progress'],
    ['Brand guidelines PDF', 'Northwind (client)', 'medium', plusDays(4), 'todo'],
    ['Push notifications', 'Mobile app', 'medium', plusDays(3), 'todo'],
    ['Offline sync test', 'Mobile app', 'low', plusDays(5), 'todo'],
    ['Send November invoices', 'Operations', 'high', plusDays(0), 'todo'],
    ['Plan next sprint', 'Operations', 'medium', plusDays(2), 'todo'],
    ['Weekly review', 'Operations', 'low', plusDays(4), 'todo'],
    ['TypeScript course: generics', 'Learning', 'low', null, 'todo'],
    ['Old draft', 'Website redesign', 'low', null, 'todo'],
    ['Sitemap', 'Website redesign', 'medium', plusDays(-3), 'done'],
    ['Kick-off call', 'Northwind (client)', 'medium', plusDays(-5), 'done'],
  ]) {
    const t = (await call('POST', '/tasks', { title, projectId: projects[project], priority, due })).task
    if (status !== 'todo') await call('PATCH', `/tasks/${t.id}`, { status })
    tasks[title] = t
  }
  // Two working weeks of tracked time, ending with today's morning.
  const plan = [
    ['Homepage hero section', 2.5], ['Logo variations', 1.5], ['Send November invoices', 0.5], ['Push notifications', 2], ['Fix mobile menu', 1],
    ['Brand guidelines PDF', 1.5], ['Pricing page copy', 1], ['TypeScript course: generics', 0.75], ['Plan next sprint', 0.5],
  ]
  let n = 0
  for (let back = 13; back >= 1; back--) {
    const day = new Date()
    day.setDate(day.getDate() - back)
    if (day.getDay() === 0 || day.getDay() === 6) continue
    let at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0).getTime()
    const blocks = 3 + (back % 3)
    for (let b = 0; b < blocks; b++) {
      const [title, hours] = plan[(n++ * 7 + back) % plan.length]
      const len = hours * (0.7 + ((n * 13) % 7) / 10) * H1
      const entry = (await call('POST', '/time-entries/start', { id: `demo-${back}-${b}-entry`, taskId: tasks[title].id, startedAt: new Date(at).toISOString() })).entry
      await call('POST', '/time-entries/stop', { id: entry.id, endedAt: new Date(at + len).toISOString() })
      at += len + 0.25 * H1
    }
  }
  // Today: a morning block, then the hero section running, with the video render tracked alongside (multitasking).
  const today = new Date()
  const nine = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0).getTime()
  const morningEnd = Math.min(nine + 1.5 * H1, Date.now() - 2 * H1)
  if (morningEnd > nine) {
    await call('POST', '/time-entries/start', { id: 'demo-today-0-entry', taskId: tasks['Send November invoices'].id, startedAt: new Date(nine).toISOString() })
    await call('POST', '/time-entries/stop', { id: 'demo-today-0-entry', endedAt: new Date(morningEnd).toISOString() })
  }
  await call('POST', '/time-entries/start', { id: 'demo-today-1-entry', taskId: tasks['Homepage hero section'].id, startedAt: new Date(Date.now() - 1.3 * H1).toISOString() })
  // Today's top 3, one already done.
  for (const [i, title] of ['Homepage hero section', 'Logo variations', 'Send November invoices'].entries()) {
    await call('PATCH', `/tasks/${tasks[title].id}`, { topDay: plusDays(0), topRank: i + 1 })
  }
  await call('PATCH', `/tasks/${tasks['Send November invoices'].id}`, { status: 'done' })
  await call('PUT', '/ai/keys/openai', { key: 'sk-demo-0000000000000000' })
  await call('POST', '/focus/sessions', {
    sessions: [
      { id: 'demo-focus-0001', startedAt: new Date(Date.now() - 5 * H1).toISOString(), endedAt: new Date(Date.now() - 3.5 * H1).toISOString(), label: 'Logo variations', focusedSeconds: 4800, distractedSeconds: 420, interruptions: 2, distractions: [{ name: 'YouTube', seconds: 300 }, { name: 'Discord', seconds: 120 }] },
    ],
  })
  return tasks
}

try {
  await send('Page.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })

  // Sign up and in (the in-memory API makes admin@local.test the admin at once).
  await goto('/register')
  await waitFor(exists('#name'), 'register form')
  for (const [sel, v] of [['#name', 'Alex Morgan'], ['#username', 'alex'], ['#email', 'admin@local.test'], ['#password', 'correct-horse-battery'], ['#confirm', 'correct-horse-battery']]) await setField(sel, v)
  await sleep(300)
  await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Request access')).click()`)
  await waitFor(bodyHas('Request sent'), 'request sent')
  await goto('/login')
  await waitFor(exists('#login'), 'login form')
  await shot('login')
  await setField('#login', 'alex')
  await setField('#password', 'correct-horse-battery')
  await sleep(300)
  await ev(`[...document.querySelectorAll('button[type=submit]')].find((b) => b.textContent.trim() === 'Sign in').click()`)
  await waitFor(bodyHas('Welcome to timedesk'), 'dashboard')
  const r = await fetch(API + '/api/auth/sign-in/username', { method: 'POST', headers: { 'content-type': 'application/json', Origin: WEB }, body: JSON.stringify({ username: 'alex', password: 'correct-horse-battery' }) })
  cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  await seed()

  // ---- screenshots, light mode ----
  await goto('/')
  await waitFor(bodyHas('Homepage hero section'), 'dashboard data', 20000)
  await shot('dashboard')

  await ev(`localStorage.setItem('timedesk:tasks-view', 'week')`)
  await goto('/tasks')
  await waitFor(bodyHas('Logo variations'), 'tasks week')
  await shot('tasks-week')
  await ev(`localStorage.setItem('timedesk:tasks-view', 'board')`)
  await goto('/tasks')
  await waitFor(bodyHas('In progress'), 'board')
  await shot('tasks-board')

  await goto('/reports')
  await waitFor(bodyHas('Website redesign'), 'reports')
  await shot('reports')

  await goto('/projects')
  await waitFor(bodyHas('Northwind'), 'projects')
  await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('New project')).click()`)
  await waitFor(exists('#pname'), 'new project dialog')
  await setField('#pname', 'Client brand')
  await setField('[aria-label="Custom colour code"]', '#0ea5e9')
  await shot('project-colours')
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

  // Tempo asks before deleting.
  await goto('/assistant')
  await waitFor(exists('textarea'), 'composer')
  await sleep(800)
  await setField('textarea', 'delete the task Old draft', 'TextArea')
  await sleep(300)
  await ev(`document.querySelector('[aria-label="Send message"]').click()`)
  await waitFor(exists('[aria-label="Tempo asks for your approval"]'), 'approval card')
  await shot('tempo-approval')

  // Multitasking: the timer menu with two timers.
  await goto('/')
  await waitFor(exists('[aria-label="Timer options"]'), 'timer running')
  await press('[aria-label="Timer options"]')
  await waitFor(exists('[aria-label="Also track Render promo video"]'), 'also track menu')
  await press('[aria-label="Also track Render promo video"]')
  await waitFor(exists('[aria-label="2 timers running"]'), 'two timers')
  await press('[aria-label="2 timers running"]')
  await waitFor(bodyHas('Running now'), 'menu open')
  await shot('multitask')
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

  // Wrap up the day (with the morning's untracked hour as a suggestion).
  await goto('/wrap-up')
  await waitFor(bodyHas('Fill in the gaps'), 'wrap-up')
  await sleep(1500)
  await shot('wrap-up')

  // Dark mode.
  await goto('/')
  await ev(`document.querySelector('[aria-label="Toggle light and dark mode"]').click()`)
  await shot('dashboard-dark')
  await ev(`document.querySelector('[aria-label="Toggle light and dark mode"]').click()`)

  // ---- the animated demo: working offline ----
  const frames = []
  listeners.push((d) => {
    if (d.method !== 'Page.screencastFrame') return
    frames.push({ data: d.params.data, t: d.params.metadata.timestamp })
    void send('Page.screencastFrameAck', { sessionId: d.params.sessionId })
  })
  await goto('/')
  await waitFor(exists('[aria-label="2 timers running"]'), 'dashboard ready')
  await sleep(800)
  await send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
  await sleep(1500)
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await waitFor(bodyHas('Offline'), 'offline badge')
  await sleep(1500)
  await ev(`document.querySelector('[aria-label="Stop all timers"]').click()`)
  await waitFor(bodyHas('waiting'), 'changes waiting')
  await sleep(2000)
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await waitFor(`!document.body.innerText.includes('waiting')`, 'synced', 20000)
  await sleep(2000)
  await send('Page.stopScreencast')

  // Frames to a GIF: hold each frame for as long as it was on screen, then one palette for a small, sharp file.
  const dir = mkdtempSync(join(tmpdir(), 'td-frames-'))
  const list = []
  frames.forEach((f, i) => {
    const file = join(dir, `f${String(i).padStart(4, '0')}.jpg`)
    writeFileSync(file, Buffer.from(f.data, 'base64'))
    const next = frames[i + 1]?.t ?? f.t + 1
    list.push(`file '${file.replace(/\\/g, '/')}'`, `duration ${Math.max(0.05, next - f.t).toFixed(3)}`)
  })
  list.push(`file '${join(dir, `f${String(frames.length - 1).padStart(4, '0')}.jpg`).replace(/\\/g, '/')}'`)
  writeFileSync(join(dir, 'list.txt'), list.join('\n'))
  const gif = join(OUT, 'offline-demo.gif')
  const ff = spawnSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', 'fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', gif], { stdio: 'inherit' })
  rmSync(dir, { recursive: true, force: true })
  if (ff.status !== 0) throw new Error('ffmpeg failed')
  console.log(`saved offline-demo.gif from ${frames.length} frames`)
} catch (e) {
  console.error('ERROR ' + e.message)
  process.exitCode = 1
} finally {
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
}
