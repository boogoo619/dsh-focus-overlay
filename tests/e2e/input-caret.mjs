#!/usr/bin/env node
/**
 * Focus-mode input bar caret/IME regression loop (headless, against the live
 * dsh web GUI).
 *
 * What it guards — the three user-visible symptoms this plugin's shared-draft
 * echo path has produced historically:
 *   1. the bar folding into the pill on the first keystroke (focus theft);
 *   2. the caret jumping to the END of the text after a mid-text edit, so
 *      Backspace starts eating the tail (caret restoration must be EXACT);
 *   3. IME composition being killed / its committed text landing wrong.
 *
 * Prerequisites:
 *   - the dsh GUI running at http://127.0.0.1:3080 with THIS repo's build
 *     live (`npm run build`; the web profile symlinks dsh-focus-overlay to
 *     this checkout, a page reload picks up the rebuilt lib/);
 *   - `~/.dsh/.credentials.yaml` carrying the `client-connection/browser-session`
 *     record (the cookie is minted locally, the secret never leaves the box);
 *   - a playwright chromium cache; override with CHROMIUM_EXE if needed.
 *
 * Usage: node tests/e2e/input-caret.mjs [--probe]
 *   --probe  dumps the host UI's interactive elements instead of asserting
 *            (used while re-pointing selectors after a dsh UI change).
 */
import { readFileSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const GUI_ORIGIN = process.env.DSH_GUI_ORIGIN || 'http://127.0.0.1:3080'
const AUTHORITY = new URL(GUI_ORIGIN).host // cookie audience = request host
const CHROMIUM_EXE =
  process.env.CHROMIUM_EXE ||
  join(homedir(), 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')

// ---- browser-session cookie (mirrors dsh-client-connection BrowserAuth) ----

const b64url = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

function browserSessionSecret() {
  const text = readFileSync(join(homedir(), '.dsh/.credentials.yaml'), 'utf8')
  const lines = text.split('\n')
  let inRecords = false
  let inRecord = false
  for (const line of lines) {
    if (/^records:\s*$/.test(line)) { inRecords = true; continue }
    if (!inRecords) continue
    const m = /^(\s*)(\S+):\s*(.*)$/.exec(line)
    if (!m) continue
    const [, indent, key, rest] = m
    if (indent === '  ') {
      inRecord = key === 'client-connection/browser-session'
      continue
    }
    if (inRecord && indent === '    ' && key === 'payload') continue
    if (inRecord && indent === '      ' && key === 'secret' && rest) return rest.trim()
  }
  throw new Error('client-connection/browser-session secret not found in ~/.dsh/.credentials.yaml')
}

function mintAuthCookie() {
  const secretB64 = browserSessionSecret()
  const secret = Buffer.from(secretB64.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  if (secret.byteLength !== 32) throw new Error('browser-session secret is not 32 bytes')
  const issuedAt = Date.now()
  const payload = { version: 1, authority: AUTHORITY, issuedAt, expiresAt: issuedAt + 24 * 3600_000 }
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = b64url(createHmac('sha256', secret).update(body).digest())
  const name = 'dsh-auth-' + b64url(createHash('sha256').update(AUTHORITY).digest())
  return { name, value: `v1.${body}.${sig}` }
}

// ---- harness ----

const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`  ✓ ${msg}`)

async function openGui() {
  const browser = await chromium.launch({ executablePath: CHROMIUM_EXE, headless: true })
  const context = await browser.newContext()
  const cookie = mintAuthCookie()
  await context.addCookies([{ name: cookie.name, value: cookie.value, url: GUI_ORIGIN }])
  await context.addInitScript(() => {
    // Skip the plugin's first-run intro so it cannot block interaction.
    localStorage.setItem('dsh-focus-overlay:onboarded', '1')
  })
  const page = await context.newPage()
  page.on('pageerror', (err) => console.error(`  [pageerror] ${err.message}`))
  await page.goto(GUI_ORIGIN, { waitUntil: 'networkidle' })
  return { browser, context, page }
}

async function dumpUi(page) {
  console.log('--- probe: interactive elements ---')
  const items = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('button, [role=button], textarea, input, [contenteditable=true], a')) {
      const r = el.getBoundingClientRect()
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 80),
        text: (el.textContent || '').trim().slice(0, 40),
        title: el.getAttribute('title') || '',
        aria: el.getAttribute('aria-label') || '',
        visible: r.width > 0 && r.height > 0,
      })
    }
    return out
  })
  for (const it of items) console.log(JSON.stringify(it))
}

// --probe: dump and exit — the selector-maintenance path.
if (process.argv.includes('--probe')) {
  const { browser, page } = await openGui()
  await dumpUi(page)
  await browser.close()
  process.exit(process.exitCode ?? 0)
}

// ---- the actual regression scenario ----

const { browser, page } = await openGui()
try {
  // 1. A fresh throwaway session, so the test never touches a real draft.
  //    (Selector verified against the host UI; re-run with --probe after a
  //    dsh UI update if this stops matching.)
  await page.getByRole('button', { name: /new|新建|新会话|新对话/i }).first().click()
  await page.waitForTimeout(800)

  // 2. Enter focus mode with the F hotkey (default-enabled).
  await page.keyboard.press('f')
  await page.waitForSelector('.fm-bar-text', { timeout: 5000 })
  pass('focus mode opened, input bar present')

  const readCaret = () => page.evaluate(() => {
    const el = document.querySelector('.fm-bar-text')
    if (!el) return null
    return { value: el.value, start: el.selectionStart, end: el.selectionEnd, bar: !!document.querySelector('.fm-bar') }
  })

  // 3. Plain typing: the bar must survive every keystroke (original bug).
  const ta = page.locator('.fm-bar-text')
  await ta.click()
  await page.keyboard.type('hello world', { delay: 20 })
  let snap = await readCaret()
  if (!snap || snap.value !== 'hello world') fail(`typed text: expected "hello world", got ${JSON.stringify(snap)}`)
  else pass(`typed "hello world" (bar still up: ${snap.bar})`)
  if (!snap?.bar) fail('bar folded during plain typing')

  // 4. THE regression: Backspace with the caret mid-text must delete the
  //    character BEFORE the caret and LEAVE THE CARET THERE.
  //    "hello world": caret 5 sits after 'o' → 1st Backspace deletes 'o'.
  await ta.evaluate((el) => el.setSelectionRange(5, 5))
  await page.keyboard.press('Backspace')
  snap = await readCaret()
  if (snap.value !== 'hell world') fail(`after 1st Backspace: expected "hell world", got ${JSON.stringify(snap.value)}`)
  else pass('1st Backspace deleted the char before the caret')
  if (snap.start !== 4 || snap.end !== 4) fail(`caret after 1st Backspace: expected 4/4, got ${snap.start}/${snap.end} (value=${JSON.stringify(snap.value)}) — caret jumped`)
  else pass('caret stayed mid-text after 1st Backspace')

  await page.keyboard.press('Backspace')
  snap = await readCaret()
  if (snap.value !== 'hel world') fail(`after 2nd Backspace: expected "hel world", got ${JSON.stringify(snap.value)} — deleting from the END`)
  else pass('2nd Backspace kept deleting at the caret, not the tail')
  if (snap.start !== 3 || snap.end !== 3) fail(`caret after 2nd Backspace: expected 3/3, got ${snap.start}/${snap.end}`)
  if (!snap.bar) fail('bar folded during Backspace edits')

  // 5. IME composition, mid-text: the shield must keep the store echo away
  //    during composition, flush once on compositionend, and restore the
  //    caret where the composition committed — not at the end. The native
  //    prototype value setter is required: a plain `el.value =` assignment
  //    updates React's change-tracker silently, so the input event would be
  //    deduped and never reach onChange.
  await ta.evaluate((el) => el.setSelectionRange(1, 1)) // between 'h' and 'e'
  await ta.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  })
  await page.waitForTimeout(50)
  await ta.evaluate((el) => {
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    nativeSet.call(el, 'h你el world')
    el.setSelectionRange(2, 2)
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '你' }))
  })
  await page.waitForTimeout(100)
  snap = await readCaret()
  if (snap.value !== 'h你el world') fail(`mid-composition text: expected "h你el world", got ${JSON.stringify(snap.value)}`)
  else pass('composition shield held the text locally')
  await ta.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  })
  await page.waitForTimeout(300)
  snap = await readCaret()
  if (snap.value !== 'h你el world') fail(`after compositionend: expected "h你el world", got ${JSON.stringify(snap.value)} (flush lost text?)`)
  else pass('compositionend flushed the committed text intact')
  if (snap.start !== 2 || snap.end !== 2) fail(`caret after compositionend: expected 2/2, got ${snap.start}/${snap.end} — caret jumped`)
  else pass('caret stayed at the composition point after commit')
  if (!snap.bar) fail('bar folded across the composition flush')

  // 6. Cleanup: clear the draft and leave focus mode — no trace in the
  //    throwaway session, nothing persisted.
  await ta.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  snap = await readCaret()
  if (snap && snap.value !== '') console.log('  (note: draft textarea still shows text after clear — check manually)')
} finally {
  await browser.close()
}

console.log(process.exitCode ? '\nRESULT: RED — regression present' : '\nRESULT: GREEN — all caret/IME invariants held')
