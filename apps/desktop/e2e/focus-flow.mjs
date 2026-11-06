// End-to-end test of Focus guard in the real desktop app: launches Electron and drives it over the DevTools protocol.
// The window "in front" comes from a file this test writes (TIMEDESK_TEST_FOREGROUND), so the test never depends on,
// reads or touches the real desktop. Needs: web on WEB_URL and a FRESH in-memory API on API_URL.
//   MOCK_AI=1 pnpm --filter @timedesk/api dev:memory
//   WEB_URL=http://localhost:5173 API_URL=http://localhost:3001 node e2e/focus-flow.mjs
// Takes about two minutes: a session must last a minute before it is kept.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electron from 'electron'

const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const API = process.env.API_URL ?? 'http://localhost:3001'
const memory = await fetch(API + '/__memory').then((r) => r.ok).catch(() => false)
if (!memory) {
  console.error('Refusing to run: ' + API + ' is not the in-memory API. Start it with: MOCK_AI=1 pnpm --filter @timedesk/api dev:memory')
  process.exit(2)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const PORT = 9342

const fakeDir = mkdtempSync(join(tmpdir(), 'td-focus-'))
const FOREGROUND = join(fakeDir, 'foreground.json')
const inFront = (app, title) => writeFileSync(FOREGROUND, JSON.stringify({ app, title }))
inFront('Code', 'main.ts - timedesk')

function launch() {
  return spawn(electron, ['.', `--web-url=${WEB}`, `--remote-debugging-port=${PORT}`], {
    cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      TIMEDESK_USER_DATA: mkdtempSync(join(tmpdir(), 'td-desktop-')),
      TIMEDESK_IDLE_LIMIT_SECONDS: '999999',
      TIMEDESK_TEST_FOREGROUND: FOREGROUND,
    },
    stdio: 'ignore',
  })
}

/** Connects to the first page whose address passes `match`. */
async function attach(match) {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://localhost:${PORT}/json`)).json()).find((t) => t.type === 'page' && match(t.url))
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
        let id = 0
        const pending = new Map()
        ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
        const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
        const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed'); return r.result?.result?.value }
        return { ws, send, ev }
      }
    } catch { /* still starting */ }
    await sleep(500)
  }
  throw new Error('could not attach to a window')
}

const helpers = (cdp) => ({
  waitFor: async (expr, label, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await cdp.ev(expr)) return true } catch { /* navigating */ } await sleep(250) } throw new Error('timeout waiting for: ' + label) },
  setField: (sel, val) => cdp.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`),
  click: (sel) => cdp.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true })()`),
  clickText: (text) => cdp.ev(`(() => { const b = [...document.querySelectorAll('button,a')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`),
  nav: async (path) => { await cdp.ev(`location.href = ${JSON.stringify(WEB + path)}`); await sleep(1200) },
})
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const exists = (s) => `!!document.querySelector(${JSON.stringify(s)})`
const focusState = 'window.timedesk.getFocusState()'
const step = async (name, fn) => { try { await fn(); results.push('PASS  ' + name) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`) } }
const apiCall = (method, path, body) =>
  `fetch(${JSON.stringify(API + '/v1' + path)}, { method: ${JSON.stringify(method)}, credentials: 'include', headers: { 'content-type': 'application/json' }, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} }).then((r) => r.json())`

let app
try {
  app = launch()
  const cdp = await attach((u) => u.startsWith(WEB) && !u.includes('/widget') && !u.includes('/quick-add'))
  await cdp.send('Page.enable')
  const h = helpers(cdp)
  await h.waitFor(exists('#root'), 'web app mounts')

  await step('sign up and sign in from the desktop window', async () => {
    await h.nav('/register')
    await h.waitFor(exists('#name'), 'register form')
    for (const [sel, v] of [['#name', 'Admin Boss'], ['#username', 'boss'], ['#email', 'admin@local.test'], ['#password', 'correct-horse-battery'], ['#confirm', 'correct-horse-battery']]) await h.setField(sel, v)
    await sleep(300)
    await h.clickText('Request access')
    await h.waitFor(bodyHas('Request sent'), 'request sent')
    await h.nav('/login')
    await h.waitFor(exists('#login'), 'login form')
    await h.setField('#login', 'boss')
    await h.setField('#password', 'correct-horse-battery')
    await sleep(300)
    await cdp.ev(`[...document.querySelectorAll('button[type=submit]')].find((b) => b.textContent.trim() === 'Sign in').click()`)
    await h.waitFor(bodyHas('Welcome to timedesk'), 'dashboard')
  })

  await step('Focus guard is off by default and nothing is measured', async () => {
    const s = await cdp.ev('window.timedesk.getSettings()')
    if (s.focusGuard !== false) throw new Error('Focus guard was on by default')
    if ((await cdp.ev(focusState)).active) throw new Error('a session ran with Focus guard off')
  })

  await step('Settings, Desktop: turn Focus guard on and edit the lists', async () => {
    await h.nav('/settings?tab=desktop')
    await h.waitFor(exists('[aria-label="Focus guard"]'), 'Focus guard switch')
    await h.click('[aria-label="Focus guard"]')
    await h.waitFor('window.timedesk.getSettings().then((s) => s.focusGuard === true)', 'focusGuard saved')
    // Add an app through the form, then remove it again.
    await h.setField('[aria-label="Add a distracting app"]', 'Spotify')
    await sleep(200)
    await cdp.ev(`document.querySelector('[aria-label="Add a distracting app"]').form.requestSubmit()`)
    await h.waitFor('window.timedesk.getSettings().then((s) => s.focusApps.includes("Spotify"))', 'app added')
    await h.waitFor(exists('[aria-label="Remove Spotify"]'), 'chip shown')
    await h.click('[aria-label="Remove Spotify"]')
    await h.waitFor('window.timedesk.getSettings().then((s) => !s.focusApps.includes("Spotify"))', 'app removed')
    if (!(await cdp.ev('window.timedesk.getSettings().then((s) => s.focusSites.includes("YouTube"))'))) throw new Error('YouTube is not in the starter list')
    // A short delay keeps the test quick; the floating timer always on so it can be checked.
    await cdp.ev('window.timedesk.setSettings({ focusNudgeSeconds: 10, widget: "always" })')
  })

  await step('a running timer starts a focus session that counts work', async () => {
    const { task } = await cdp.ev(apiCall('POST', '/tasks', { title: 'Write docs' }))
    await cdp.ev(apiCall('POST', '/time-entries/start', { taskId: task.id }))
    await h.nav('/') // the page picks up the running timer and tells the desktop app
    await h.waitFor(`${focusState}.then((s) => s.active && s.focusedSeconds >= 10)`, 'focused time counted', 25000)
  })

  await step('a listed site in front is noticed and nudged after the delay', async () => {
    inFront('Google Chrome', 'Cats compilation - YouTube - Google Chrome')
    await h.waitFor(`${focusState}.then((s) => s.distracted && s.match === 'YouTube')`, 'distraction noticed', 15000)
    await h.waitFor(`${focusState}.then((s) => s.interruptions === 1)`, 'nudge after 10 s', 20000)
  })

  await step('the floating timer shows the distraction', async () => {
    const widget = await attach((u) => u.includes('/widget'))
    const w = helpers(widget)
    await w.waitFor(bodyHas('YouTube'), 'widget names the distraction', 15000)
    await w.waitFor(bodyHas('back to Write docs?'), 'widget asks to go back')
    widget.ws.close()
  })

  await step('the dashboard shows it live while it happens', async () => {
    await h.waitFor(exists('[data-testid="focus-card"]'), 'focus card', 15000)
    await h.waitFor(bodyHas('has been in front for'), 'live line')
  })

  await step('back to work: the distraction clears', async () => {
    inFront('Code', 'docs.md - timedesk')
    await h.waitFor(`${focusState}.then((s) => !s.distracted && s.match === null)`, 'distraction cleared', 15000)
  })

  await step('stopping the timer keeps the session and uploads it, without window titles', async () => {
    // A session must have a minute of measured time before it is kept.
    await h.waitFor(`${focusState}.then((s) => s.focusedSeconds + s.distractedSeconds >= 65)`, 'a minute measured', 70000)
    await h.click('[aria-label="Stop timer"]')
    await h.waitFor(`${focusState}.then((s) => !s.active)`, 'session over')
    await h.waitFor(`${apiCall('GET', '/focus/sessions')}.then((j) => j.sessions.length === 1)`, 'session uploaded', 20000)
    const { sessions } = await cdp.ev(apiCall('GET', '/focus/sessions'))
    const s = sessions[0]
    if (s.label !== 'Write docs' || s.interruptions !== 1 || s.distractions[0]?.name !== 'YouTube' || s.focusedSeconds < 30) throw new Error('unexpected session: ' + JSON.stringify(s))
    if (JSON.stringify(sessions).includes('Cats')) throw new Error('a window title was uploaded')
    results.push(`      session: ${s.focusedSeconds}s focused, ${s.distractedSeconds}s distracted, ${s.interruptions} nudge`)
  })

  await step('the dashboard shows the focus score', async () => {
    await h.nav('/')
    await h.waitFor(bodyHas('Focus today'), 'focus card', 15000)
    const pct = await cdp.ev(`(document.querySelector('[data-testid="focus-card"]').innerText.match(/(\\d+)%/) || [])[1]`)
    if (!pct) throw new Error('no score shown')
    await h.waitFor(bodyHas('Biggest distraction'), 'top distraction')
  })

  await step('turning Focus guard off stops measuring', async () => {
    await cdp.ev('window.timedesk.setSettings({ focusGuard: false })')
    const { task } = await cdp.ev(apiCall('POST', '/tasks', { title: 'Another task' }))
    await cdp.ev(apiCall('POST', '/time-entries/start', { taskId: task.id }))
    await h.nav('/')
    await sleep(7000)
    if ((await cdp.ev(focusState)).active) throw new Error('a session ran with Focus guard off')
  })
} catch (e) {
  results.push('ERROR ' + e.message)
} finally {
  console.log(results.join('\n'))
  try { app?.kill() } catch { /* ignore */ }
  await sleep(500)
  process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0)
}
