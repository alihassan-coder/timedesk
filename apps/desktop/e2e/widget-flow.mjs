// End-to-end test of the floating timer in the real desktop app (Electron).
// Needs: web on WEB_URL and a FRESH in-memory API on API_URL (pnpm --filter @timedesk/api dev:memory).
//   node e2e/widget-flow.mjs [screenshot-folder]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electron from 'electron'

const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const API = process.env.API_URL ?? 'http://localhost:3001'
const PORT = 9347
const memory = await fetch(API + '/__memory').then((r) => r.ok).catch(() => false)
if (!memory) {
  console.error('Refusing to run: ' + API + ' is not the in-memory API. Start it with: pnpm --filter @timedesk/api dev:memory')
  process.exit(2)
}
const SHOTS = process.argv[2]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []

const userData = mkdtempSync(join(tmpdir(), 'td-widget-'))
const app = spawn(electron, ['.', `--web-url=${WEB}`, `--remote-debugging-port=${PORT}`], {
  cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, TIMEDESK_USER_DATA: userData, TIMEDESK_IDLE_LIMIT_SECONDS: '999999' },
  stdio: 'ignore',
})

async function connect(match, ms = 20000) {
  const t = Date.now()
  while (Date.now() - t < ms) {
    try {
      const page = (await (await fetch(`http://localhost:${PORT}/json`)).json()).find((x) => x.type === 'page' && match(x.url))
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
    await sleep(300)
  }
  throw new Error('could not attach to a window')
}
const waitFor = async (cdp, expr, label, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await cdp.ev(expr)) return true } catch { /* navigating */ } await sleep(200) } throw new Error('timeout waiting for: ' + label) }
const setField = (cdp, sel, val) => cdp.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const clickText = (cdp, text) => cdp.ev(`(() => { const b = [...document.querySelectorAll('button,a,[role=menuitem]')].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
const clickExact = (cdp, text, type) => cdp.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && (!${JSON.stringify(type ?? '')} || x.type === ${JSON.stringify(type ?? '')})); if (!b) return false; b.click(); return true })()`)
const exists = (s) => `!!document.querySelector(${JSON.stringify(s)})`
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const shot = async (cdp, name) => { if (!SHOTS) return; const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')) }
const step = async (name, fn) => { try { await fn(); results.push('PASS  ' + name) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`) } }
const call = (cdp, method, path, body) => cdp.ev(`fetch(${JSON.stringify(API + '/v1' + path)}, { method: ${JSON.stringify(method)}, credentials: 'include', headers: { 'content-type': 'application/json', ...(window.__tok ? { authorization: 'Bearer ' + window.__tok } : {}) }, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} }).then((r) => r.status === 204 ? {} : r.json())`)

try {
  const main = await connect((u) => !u.includes('/widget'))
  await main.send('Page.enable')
  await waitFor(main, exists('#root'), 'web app mounts')

  await step('sign in to the desktop app', async () => {
    await main.ev(`location.href = ${JSON.stringify(WEB + '/register')}`)
    await waitFor(main, exists('#name'), 'register form')
    for (const [sel, v] of [['#name', 'Admin Boss'], ['#username', 'boss'], ['#email', 'admin@local.test'], ['#password', 'correct-horse-battery'], ['#confirm', 'correct-horse-battery']]) await setField(main, sel, v)
    await sleep(300)
    await clickText(main, 'Request access')
    await waitFor(main, bodyHas('Request sent'), 'request sent')
    await main.ev(`location.href = ${JSON.stringify(WEB + '/login')}`)
    await waitFor(main, exists('#login'), 'login form')
    await setField(main, '#login', 'boss'); await setField(main, '#password', 'correct-horse-battery')
    await sleep(300)
    await clickExact(main, 'Sign in', 'submit')
    await waitFor(main, bodyHas('Welcome to timedesk'), 'dashboard')
  })

  await step('the new settings are reachable and the style choices render', async () => {
    await main.ev(`location.href = ${JSON.stringify(WEB + '/settings?tab=desktop')}`)
    await waitFor(main, bodyHas('Floating timer'), 'floating timer card')
    for (const t of ['Compact', 'Expanded', 'Bottom bar', 'Pomodoro']) if (!(await main.ev(bodyHas(t)))) throw new Error('missing style: ' + t)
    const s = await main.ev(`window.timedesk.getSettings()`)
    if (s.widget !== 'auto' || s.widgetMode !== 'compact' || s.shortcuts !== true || s.idleMinutes !== 5) throw new Error('defaults wrong: ' + JSON.stringify(s))
    await shot(main, 'w1-settings')
  })

  await step('Automatic: no floating window while timedesk is in front, even with a timer running', async () => {
    await main.ev(`document.querySelector('[aria-label="Floating timer style"] [role=radio]').click()`)
    await clickText(main, 'Start timer')
    await waitFor(main, bodyHas('Stopwatch (no task)'), 'timer menu')
    await clickText(main, 'Stopwatch (no task)')
    await waitFor(main, exists('[aria-label="Stop timer"]'), 'timer running')
    await sleep(1500)
    const list = await (await fetch(`http://localhost:${PORT}/json`)).json()
    const widget = list.find((x) => x.url.includes('/widget'))
    // The widget window may exist but must not be visible. Visibility is reported by the page itself.
    if (widget) {
      const w = await connect((u) => u.includes('/widget'))
      const visible = await w.ev('document.visibilityState')
      w.ws.close()
      if (visible === 'visible') throw new Error('the floating timer is visible while timedesk has focus')
    }
  })

  await step('Always: the floating timer appears and shows the running clock', async () => {
    await main.ev(`window.timedesk.setSettings({ widget: 'always' })`)
    await sleep(1500)
    const w = await connect((u) => u.includes('/widget'))
    await waitFor(w, `/\\d\\d:\\d\\d:\\d\\d/.test(document.body.innerText)`, 'a running clock', 15000)
    if (!(await w.ev(bodyHas('Stopwatch')))) throw new Error('task label missing')
    await shot(w, 'w2-compact')
    w.ws.close()
  })

  for (const [mode, label] of [['compact', 'Compact'], ['expanded', 'Expanded'], ['dock', 'Bottom bar'], ['pomodoro', 'Pomodoro']]) {
    await step(`style "${label}" resizes the window and renders`, async () => {
      await main.ev(`window.timedesk.setSettings({ widgetMode: ${JSON.stringify(mode)} })`)
      const want = { compact: [330, 56], expanded: [300, 252], pomodoro: [280, 292] }[mode]
      const fits = (d) => (want ? Math.abs(d.w - want[0]) <= 4 && Math.abs(d.h - want[1]) <= 4 : d.h <= 60 && d.w >= 800)
      // The window is resized by the desktop app: wait (up to 8 seconds) for the new size instead of guessing a delay.
      let dim
      const started = Date.now()
      while (Date.now() - started < 8000) {
        await sleep(400)
        try {
          const w = await connect((u) => u.includes('/widget'), 3000)
          dim = await w.ev(`({ w: window.innerWidth, h: window.innerHeight, scrollX: document.documentElement.scrollWidth > window.innerWidth + 1, scrollY: document.documentElement.scrollHeight > window.innerHeight + 1, text: document.body.innerText })`)
          if (fits(dim)) {
            await shot(w, 'w3-' + mode)
            w.ws.close()
            break
          }
          w.ws.close()
        } catch { /* window still changing */ }
      }
      if (!dim) throw new Error('no floating window found')
      if (want && (Math.abs(dim.w - want[0]) > 4 || Math.abs(dim.h - want[1]) > 4)) throw new Error(`window is ${dim.w}x${dim.h}, expected about ${want[0]}x${want[1]}`)
      if (mode === 'dock' && (dim.h > 60 || dim.w < 800)) throw new Error(`bottom bar should be wide and thin, got ${dim.w}x${dim.h}`)
      if (dim.scrollX || dim.scrollY) throw new Error('content overflows the window')
      if (mode === 'pomodoro' && !/focus 1/i.test(dim.text)) throw new Error('pomodoro ring missing: ' + dim.text.slice(0, 80))
      if (mode === 'expanded' && !/Today/.test(dim.text)) throw new Error('daily goal missing')
    })
  }

  await step('stopping from the floating timer stops the timer everywhere', async () => {
    await main.ev(`window.timedesk.setSettings({ widgetMode: 'compact' })`)
    await sleep(1500)
    const w = await connect((u) => u.includes('/widget'))
    await waitFor(w, exists('[aria-label="Stop timer"]'), 'stop button')
    await w.ev(`document.querySelector('[aria-label="Stop timer"]').click()`)
    w.ws.close()
    // The main window learns about it at once (not after a minute): its own Stop button goes away.
    await waitFor(main, `!document.querySelector('[aria-label="Stop timer"]')`, 'main window reflects the stop', 8000)
  })

  await step('the floating timer starts the last timer again (resume) and the main window follows', async () => {
    const w = await connect((u) => u.includes('/widget'))
    await waitFor(w, exists('[aria-label^="Start timer on"]'), 'resume button')
    await w.ev(`document.querySelector('[aria-label^="Start timer on"]').click()`)
    w.ws.close()
    await waitFor(main, exists('[aria-label="Stop timer"]'), 'main window shows the running timer', 8000)
  })

  await step('Never: the floating timer is hidden; the setting survives in the settings file', async () => {
    await main.ev(`window.timedesk.setSettings({ widget: 'never' })`)
    await sleep(1200)
    const list = await (await fetch(`http://localhost:${PORT}/json`)).json()
    const widget = list.find((x) => x.url.includes('/widget'))
    if (widget) {
      const w = await connect((u) => u.includes('/widget'))
      const visible = await w.ev('document.visibilityState')
      w.ws.close()
      if (visible === 'visible') throw new Error('still visible')
    }
    const s = await main.ev(`window.timedesk.getSettings()`)
    if (s.widget !== 'never') throw new Error('setting not kept')
  })

  await step('bad settings from a page are ignored', async () => {
    const s = await main.ev(`window.timedesk.setSettings({ widgetMode: 'giant', idleMinutes: 'soon', widget: 'sometimes' })`)
    if (s.widgetMode !== 'compact' || s.idleMinutes !== 5 || s.widget !== 'never') throw new Error('accepted bad values: ' + JSON.stringify(s))
  })
} catch (e) {
  results.push('ERROR ' + e.message)
} finally {
  console.log(results.join('\n'))
  app.kill()
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0)
}
