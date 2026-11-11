// Browser end-to-end: finished tasks leave the board after a week and go to the Archive; Reopen brings one back.
// Tasks are finished now and the page's clock is moved 8 days ahead, so nothing waits a week.
// Needs: web on :5173 and a FRESH in-memory API on :3001 (MOCK_AI=1 pnpm --filter @timedesk/api dev:memory).
// Run: node e2e/archive-flow.mjs [screenshot-prefix]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const WEB = process.env.WEB_URL ?? 'http://localhost:5173', API = process.env.API_URL ?? 'http://localhost:3001', OUT = process.argv[2]
if (!(await fetch(API + '/__memory').then((r) => r.ok).catch(() => false))) {
  console.error('Refusing to run: ' + API + ' is not the in-memory API.')
  process.exit(2)
}
const chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--remote-debugging-port=9353', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'td-arch-'))}`, '--window-size=1320,900', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0; const pending = new Map(); const results = []
for (let i = 0; i < 40 && !ws; i++) { try { const p = (await (await fetch('http://localhost:9353/json')).json()).find((t) => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } } } } catch {} if (!ws) await sleep(250) }
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
const H = { 'content-type': 'application/json', Origin: WEB }
await fetch(API + '/api/auth/sign-up/email', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Demo', username: 'demo', email: 'admin@local.test', password: 'correct-horse-battery' }) })
const r = await fetch(API + '/api/auth/sign-in/username', { method: 'POST', headers: H, body: JSON.stringify({ username: 'demo', password: 'correct-horse-battery' }) })
const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
const call = (m, p, b) => fetch(API + '/v1' + p, { method: m, headers: { ...H, Cookie: cookie }, body: b ? JSON.stringify(b) : undefined }).then((x) => x.json())
const { project } = await call('POST', '/projects', { name: 'Website', color: 3 })
const ids = {}
for (const [title, extra] of [['Write landing copy', {}], ['Fix pricing table', {}], ['Weekly LinkedIn post', { recurrence: { freq: 'weekly' }, due: new Date().toISOString().slice(0, 10) }], ['Still open task', {}]]) ids[title] = (await call('POST', '/tasks', { title, projectId: project.id, ...extra })).task.id
for (const t of ['Write landing copy', 'Fix pricing table', 'Weekly LinkedIn post']) await call('PATCH', '/tasks/' + ids[t], { status: 'done' })
// The page believes it is 8 days later.
await send('Page.enable')
await send('Page.navigate', { url: WEB + '/login' }); await sleep(1500)
await ev(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; for (const [s, v] of [['#login','demo'],['#password','correct-horse-battery']]) { const el = document.querySelector(s); set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) } return true })()`)
await sleep(300); await ev(`[...document.querySelectorAll('button[type=submit]')].find((b) => b.textContent.trim() === 'Sign in').click()`); await sleep(2500)
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const shift = 8 * 86400000; const RealDate = Date; class D extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.now() + shift])) } static now() { return RealDate.now() + shift } } window.Date = D })()` })
await send('Page.navigate', { url: WEB + '/tasks' }); await sleep(2500)
await ev(`document.querySelector('[aria-label="Board view"]')?.click()`); await sleep(800)
const board = await ev(`document.body.innerText`)
results.push((!board.includes('Write landing copy') && board.includes('Still open task') ? 'PASS' : 'FAIL') + '  board hides tasks finished 8 days ago, keeps open ones')
results.push((board.includes('are in the') ? 'PASS' : 'FAIL') + '  board points to the Archive')
if (OUT) { const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(OUT + '-board.png', Buffer.from(shot.result.data, 'base64')) }
await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Archive' && !b.getAttribute('aria-label'))?.click() || document.querySelector('[aria-label^="Archive:"]').click()`); await sleep(800)
const arch = await ev(`document.querySelector('[data-testid=archive]')?.innerText ?? ''`)
results.push((['Write landing copy', 'Fix pricing table', 'Weekly LinkedIn post'].every((t) => arch.includes(t)) && arch.includes('Week of') ? 'PASS' : 'FAIL') + '  Archive lists the 3 finished tasks by week')
if (OUT) { const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(OUT + '-archive.png', Buffer.from(shot.result.data, 'base64')) }
await ev(`document.querySelector('[aria-label="Reopen Fix pricing table"]').click()`); await sleep(1500)
const t = (await call('GET', '/tasks')).tasks.find((x) => x.title === 'Fix pricing table')
results.push((t.status === 'todo' ? 'PASS' : 'FAIL') + '  Reopen brings it back to To do (saved): ' + t.status)
const next = (await call('GET', '/tasks')).tasks.filter((x) => x.title === 'Weekly LinkedIn post' && x.status !== 'done').length
results.push((next === 1 ? 'PASS' : 'FAIL') + '  the repeating task still has its next copy open')
console.log(results.join('\n')); ws.close(); chrome.kill(); process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0)
