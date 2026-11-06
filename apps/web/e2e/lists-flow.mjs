// Browser end-to-end: markdown in the assistant answer, custom-date reports, and the paged Apps and sites list.
// Needs: web on :5173 and a FRESH in-memory API with the fake model: MOCK_AI=1 pnpm --filter @timedesk/api dev:memory
// Run: node e2e/lists-flow.mjs [screenshot-folder]
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
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9338', `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0
const pending = new Map()
const results = []

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://localhost:9338/json')).json()
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
const call = (method, path, body) => ev(`fetch(${JSON.stringify(API + '/v1' + path)}, { method: ${JSON.stringify(method)}, credentials: 'include', headers: { 'content-type': 'application/json' }, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} }).then((r) => r.status === 204 ? {} : r.json())`)
const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true })()`)
const setArea = (sel, val) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const both = (a, b) => `(${a}) && (${b})`
const rowCount = () => ev(`document.querySelectorAll('tbody tr').length`)

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

  // ---------------- markdown ----------------
  await step('the assistant answer renders markdown (lists, bold, code, table, link) and never raw HTML', async () => {
    await call('PUT', '/ai/keys/openai', { key: 'sk-test-0123456789abcdef' })
    await goto('/assistant')
    await waitFor(exists('textarea'), 'composer')
    await sleep(900)
    const md = 'hi\n\n## Plan\n\n- first item\n- second item\n\n1. one\n2. two\n\n**strong words** and `inline code`\n\n| Name | Time |\n|---|---|\n| Alpha | 2h |\n\n```js\nconst x = 1\n```\n\n<script>window.__pwned = 1</script> <b>not bold</b>\n\n[docs](https://example.com) and [bad](javascript:alert(1))'
    await setArea('textarea', md); await sleep(300)
    await click('[aria-label="Send message"]')
    await waitFor(exists('table'), 'rendered table', 15000)
    const r = await ev(`(() => {
      const box = [...document.querySelectorAll('div')].find((d) => d.className.includes('min-w-0 break-words'))
      const root = box?.parentElement
      return {
        items: root.querySelectorAll('ul li').length, ordered: root.querySelectorAll('ol li').length,
        strong: root.querySelector('strong')?.textContent, inline: [...root.querySelectorAll('code')].some((c) => c.textContent === 'inline code'),
        cell: root.querySelector('td')?.textContent, block: root.querySelector('pre code')?.textContent,
        heading: !!root.querySelector('h3'),
        script: !!root.querySelector('script') || window.__pwned === 1,
        rawTag: root.textContent.includes('<script>'),
        link: root.querySelector('a[href="https://example.com"]')?.getAttribute('target'),
        bad: [...root.querySelectorAll('a')].some((a) => (a.getAttribute('href') || '').startsWith('javascript')),
        stars: root.textContent.includes('**'),
      }
    })()`)
    await shot('30-markdown')
    if (r.items !== 2 || r.ordered !== 2) throw new Error('lists not rendered: ' + JSON.stringify(r))
    if (r.strong !== 'strong words' || !r.inline) throw new Error('bold or inline code missing: ' + JSON.stringify(r))
    if (r.cell !== 'Alpha' || r.block !== 'const x = 1' || !r.heading) throw new Error('table, code block or heading missing: ' + JSON.stringify(r))
    if (r.script) throw new Error('raw HTML ran as a script')
    if (r.link !== '_blank') throw new Error('link should open in a new tab')
    if (r.bad) throw new Error('javascript: link kept')
    if (r.stars) throw new Error('literal ** still shown')
  })

  // ---------------- reports: custom range ----------------
  await step('reports: a custom range shows the days and chart; a backwards range explains itself', async () => {
    await goto('/reports')
    await waitFor(exists('[aria-label=""], button'), 'reports')
    await clickText('Custom')
    await waitFor(exists('#r-from'), 'date fields')
    await setField('#r-from', key(-9)); await setField('#r-to', key(0)); await sleep(400)
    await waitFor(bodyHas('10 days, by day'), 'range summary')
    await shot('31-reports-custom')
    await setField('#r-from', key(0)); await setField('#r-to', key(-3)); await sleep(400)
    await waitFor(bodyHas('must not be before'), 'error message')
    await clickText('Last 30 days'); await sleep(400)
    await waitFor(bodyHas('30 days, by day'), '30 day preset')
    await clickText('Last 90 days'); await sleep(400)
    await waitFor(bodyHas('90 days, by week'), '90 day preset uses weeks')
    await setField('#r-from', '2024-01-01'); await setField('#r-to', key(0)); await sleep(400)
    await waitFor(bodyHas('by month'), 'long range uses months')
  })

  await step('reports: tracked time lands in the right custom range', async () => {
    const p = (await call('POST', '/projects', { name: 'Docs' })).project
    await call('POST', '/time-entries/start', { projectId: p.id })
    await sleep(1500)
    await call('POST', '/time-entries/stop')
    await goto('/reports')
    await clickText('Custom'); await waitFor(exists('#r-from'), 'fields')
    await setField('#r-from', key(0)); await setField('#r-to', key(0)); await sleep(400)
    await waitFor(bodyHas('1 day, by day'), 'one day')
    await waitFor(bodyHas('Docs'), 'project row')
  })

  // ---------------- apps and sites ----------------
  await step('apps and sites: 27 sessions are paged 10 at a time, with working next/previous', async () => {
    const samples = Array.from({ length: 27 }, (_, i) => ({ id: `sample-e2e-${String(i).padStart(4, '0')}`, app: i % 9 === 0 ? 'Figma' : 'Code', title: i === 4 ? 'Budget plan' : 'work ' + i, seconds: 60 + i, startedAt: new Date(Date.now() - (i + 1) * 3_600_000 * 2).toISOString() }))
    const r = await call('POST', '/activity', { samples })
    if (r.stored !== 27) throw new Error('seed failed: ' + JSON.stringify(r))
    await goto('/apps')
    await waitFor(exists('[aria-label="Next page"]'), 'pagination', 12000)
    await clickText('30 days'); await sleep(600)
    await waitFor(bodyHas('1-10 of 27') + ' && ' + bodyHas('Page 1 of 3'), 'page 1')
    if ((await rowCount()) !== 10) throw new Error('expected 10 rows, got ' + (await rowCount()))
    await click('[aria-label="Next page"]')
    await waitFor(bodyHas('11-20 of 27'), 'page 2')
    await click('[aria-label="Next page"]')
    await waitFor(bodyHas('21-27 of 27'), 'page 3')
    if ((await rowCount()) !== 7) throw new Error('expected 7 rows on the last page')
    if (await ev(`!document.querySelector('[aria-label="Next page"]').disabled`)) throw new Error('Next should be disabled on the last page')
    await shot('32-apps-page3')
    await click('[aria-label="Previous page"]')
    await waitFor(bodyHas('11-20 of 27'), 'back to page 2')
  })

  await step('apps and sites: search narrows the list and resets to page 1; clear filters restores it', async () => {
    await setField('input[aria-label="Search sessions"]', 'budget'); await sleep(900)
    await waitFor(bodyHas('1-1 of 1'), 'one match')
    await setField('input[aria-label="Search sessions"]', 'zzz-nothing'); await sleep(900)
    await waitFor(bodyHas('No sessions match these filters'), 'empty state')
    await clickText('Clear filters')
    await waitFor(bodyHas('1-10 of 27'), 'restored')
  })

  await step('apps and sites: deleting one session removes it, and a custom range works', async () => {
    await click('[aria-label^="Delete this"]')
    await waitFor(bodyHas('1-10 of 26'), 'one fewer')
    await clickText('Custom'); await waitFor(exists('#a-from'), 'date fields')
    await setField('#a-from', key(-1)); await setField('#a-to', key(0)); await sleep(800)
    const text = await ev('document.body.innerText')
    if (!/of \d+/.test(text)) throw new Error('no count shown for the custom range')
    await setField('#a-from', key(0)); await setField('#a-to', key(-5)); await sleep(500)
    await waitFor(bodyHas('must not be before'), 'backwards range message')
  })
} catch (e) {
  results.push(`ERROR ${e.message}`)
} finally {
  console.log(results.join('\n'))
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0)
}
