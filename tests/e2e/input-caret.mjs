#!/usr/bin/env node
/**
 * Focus-mode input bar regression loop (headless, against the live dsh web
 * GUI). Two mutually exclusive surfaces, one per run mode:
 *
 *   default run  — the BORROWED official composer: the main view's composer
 *                  seat must be CSS-lifted above the focus overlay (position
 *                  fixed, z above .fm-overlay) whenever the dock wants the
 *                  bar form, typing must work, and the official '/' command
 *                  menu must open and stay visible above the overlay.
 *   --fallback   — the built-in textarea bar (prefs.borrow=false): the
 *                  caret/IME invariants the echo machinery must hold:
 *                    1. the bar never folds into the pill on a keystroke;
 *                    2. a mid-text Backspace deletes the char BEFORE the
 *                       caret and LEAVES THE CARET THERE (never jumps to the
 *                       end and eats the tail);
 *                    3. IME composition is shielded, flushed intact on
 *                       compositionend, caret stays at the commit point.
 *
 * Prerequisites:
 *   - the dsh GUI running at http://127.0.0.1:3080 with THIS repo's build
 *     live (`npm run build`; the web profile symlinks dsh-focus-overlay to
 *     this checkout, a page reload picks up the rebuilt lib/);
 *   - `~/.dsh/.credentials.yaml` carrying the `client-connection/browser-session`
 *     record (the cookie is minted locally, the secret never leaves the box);
 *   - a playwright chromium cache; override with CHROMIUM_EXE if needed.
 *
 * Usage: node tests/e2e/input-caret.mjs [--fallback] [--probe]
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
const FALLBACK = process.argv.includes('--fallback')
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
  await context.addInitScript((fallback) => {
    // Skip the plugin's first-run intro so it cannot block interaction, and
    // pin the borrow pref so the run exercises exactly one input surface.
    localStorage.setItem('dsh-focus-overlay:onboarded', '1')
    localStorage.setItem('dsh-focus-overlay:prefs', JSON.stringify(fallback ? { borrow: false } : { borrow: true }))
  }, FALLBACK)
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

async function freshSession(page) {
  // A fresh throwaway session, so the test never touches a real draft.
  // (Selector verified against the host UI; re-run with --probe after a
  // dsh UI update if this stops matching.)
  await page.getByRole('button', { name: '新建会话' }).first().click()
  await page.waitForTimeout(800)
}

/** The composer-seat selector, shared by every locator/evaluate probe so the
 *  script can never disagree with itself about WHAT it lifts (mirrors the
 *  plugin-side composerSeat() helper). */
const SEAT = '[data-composer-seat]'
/** Clear whatever an editable holds (draft text or inserted command chips). */
async function clearEditable(page, locator) {
  await locator.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(200)
}

async function enterFocus(page) {
  await page.keyboard.press('f')
  await page.waitForTimeout(400)
}

// --probe: dump and exit — the selector-maintenance path.
if (process.argv.includes('--probe')) {
  const { browser, page } = await openGui()
  await dumpUi(page)
  await browser.close()
  process.exit(process.exitCode ?? 0)
}

console.log(FALLBACK ? 'mode: fallback (built-in textarea bar)' : 'mode: borrow (official composer lifted)')

const { browser, page } = await openGui()
try {
  await freshSession(page)
  await enterFocus(page)

  if (!FALLBACK) {
    // ---- borrowed official composer ----
    // 1. The seat must lift while the dock wants the bar form (empty draft +
    //    bottom zone): position fixed, z above the overlay, on screen.
    try {
      await page.waitForSelector(`${SEAT}.fm-lift`, { timeout: 5000 })
    } catch {
      const state = await page.evaluate((sel) => ({
        overlay: !!document.querySelector('.fm-overlay'),
        barTextarea: !!document.querySelector('.fm-bar-text'),
        seat: !!document.querySelector(sel),
        seatEditable: !!document.querySelector(`${sel} [contenteditable=true]`),
        seatLift: !!document.querySelector(`${sel}.fm-lift`),
        prefs: localStorage.getItem('dsh-focus-overlay:prefs'),
      }), SEAT)
      fail(`seat did not lift; state=${JSON.stringify(state)}`)
      throw new Error('borrow-mode prerequisites failed; aborting scenario')
    }
    const lift = await page.evaluate((sel) => {
      const seat = document.querySelector(`${sel}.fm-lift`)
      const overlay = document.querySelector('.fm-overlay')
      const cs = seat && getComputedStyle(seat)
      const r = seat && seat.getBoundingClientRect()
      return {
        position: cs && cs.position,
        z: cs && cs.zIndex,
        overlayZ: overlay && getComputedStyle(overlay).zIndex,
        onScreen: !!r && r.bottom <= innerHeight && r.top >= 0 && r.width > 100,
      }
    }, SEAT)
    if (lift.position !== 'fixed') fail(`lifted seat position: expected fixed, got ${lift.position}`)
    else pass('composer seat lifted (position fixed)')
    if (Number(lift.z) <= Number(lift.overlayZ)) fail(`lift z ${lift.z} not above overlay z ${lift.overlayZ}`)
    else pass(`lift z ${lift.z} above overlay z ${lift.overlayZ}`)
    if (!lift.onScreen) fail(`lifted seat off-screen: ${JSON.stringify(lift)}`)
    else pass('lifted seat on screen')

    // 1b. The seat is a layout box larger than the card (hero variant stacks
    //     rows above it) — it must paint NOTHING itself (no translucent
    //     square with shadow behind the card) and let clicks pass through
    //     its empty area to the reading surface.
    const seatPaint = await page.evaluate((sel) => {
      const seat = document.querySelector(sel)
      const card = seat && seat.querySelector('[data-composer-card]')
      if (!seat || !card) return null
      const cs = getComputedStyle(seat)
      const cardRect = card.getBoundingClientRect()
      // a point inside the seat but above the card (seat is taller)
      const probeY = Math.max(0, Math.round(cardRect.top - 8))
      const hit = document.elementFromPoint(Math.round(cardRect.left + 40), probeY)
      return {
        shadow: cs.boxShadow,
        bg: cs.backgroundColor,
        cardPointer: getComputedStyle(card).pointerEvents,
        emptyAreaHit: hit ? (hit.className && String(hit.className).slice(0, 30)) || hit.tagName : null,
        emptyAreaInSeat: !!hit && seat.contains(hit),
      }
    }, `${SEAT}.fm-lift`)
    if (!seatPaint) fail('seat/card not found for paint check')
    else {
      if (seatPaint.shadow !== 'none') fail(`seat paints its own shadow (${seatPaint.shadow}) — the translucent square is back`)
      else pass('seat paints nothing (no square backdrop behind the card)')
      if (seatPaint.bg !== 'rgba(0, 0, 0, 0)') fail(`seat paints a background: ${seatPaint.bg}`)
      if (seatPaint.cardPointer !== 'auto') fail(`card pointer-events: ${seatPaint.cardPointer}`)
      else pass('card subtree stays interactive')
      if (seatPaint.emptyAreaInSeat) fail(`clicks stop on the seat's empty area (${seatPaint.emptyAreaHit}) instead of reaching the reading surface`)
      else pass(`seat empty area is click-transparent (hits ${seatPaint.emptyAreaHit})`)
    }

    // 2. Typing in the official editor works; a blur (click into the reading
    //    area) folds the draft into our pill via the focus bridge, and the
    //    pill re-lifts and re-focuses the editor.
    const editable = page.locator(`${SEAT} [contenteditable=true]`).first()
    await editable.click()
    await page.keyboard.type('hello world', { delay: 20 })
    const text = await editable.textContent()
    if (text !== 'hello world') fail(`typed into official editor: expected "hello world", got ${JSON.stringify(text)}`)
    else pass('typed into the official editor')

    await page.locator('.fm-body').click({ position: { x: 40, y: 40 } })
    await page.waitForTimeout(400)
    const pillVisible = await page.locator('.fm-pill').count()
    const liftAfterBlur = await page.evaluate((sel) => (document.querySelector(sel) ? 'up' : 'down'), `${SEAT}.fm-lift`)
    if (liftAfterBlur !== 'down') fail('lifted composer stayed up after blur (focus bridge broken?)')
    else if (!pillVisible) fail('draft pill did not appear after blur')
    else pass('blur folded the draft into the pill (lift released)')

    await page.locator('.fm-pill').click()
    await page.waitForSelector(`${SEAT}.fm-lift`, { timeout: 5000 })
    const refocused = await page.evaluate((sel) => {
      const seat = document.querySelector(sel)
      return !!seat && seat.contains(document.activeElement)
    }, SEAT)
    if (!refocused) fail('caret did not land in the official editor after pill expand')
    else pass('pill expand re-lifted and focused the official editor')

    // 3. The official '/' command menu opens and stays visible above the
    //    overlay (it is a descendant of the composer card, so it lifts along).
    //    Slash commands trigger on a word-start '/': clear the draft first.
    await clearEditable(page, editable)
    await page.keyboard.type('/')
    await page.waitForTimeout(600)
    const menu = await page.evaluate((sel) => {
      const seat = document.querySelector(sel)
      const list = seat && seat.querySelector('[role=listbox]')
      if (!list) return null
      const r = list.getBoundingClientRect()
      return { text: (list.textContent || '').slice(0, 40), visible: r.width > 0 && r.height > 0 }
    }, SEAT)
    if (!menu || !menu.visible) fail(`'/' command menu did not open in the lifted composer: ${JSON.stringify(menu)}`)
    else pass(`'/' command menu open above the overlay ("${menu.text}…")`)

    // 3b. Esc with the menu open must close the MENU first (the plugin's
    //     capture-phase peel lets the host handle it) — the bar stays up.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const afterMenuEsc = await page.evaluate((sel) => ({
      menuGone: !document.querySelector(`${sel} [role=listbox]`),
      barStillUp: !!document.querySelector(`${sel}.fm-lift`),
    }), SEAT)
    if (!afterMenuEsc.menuGone) fail('Esc did not close the slash menu (host never received it?)')
    else if (!afterMenuEsc.barStillUp) fail('Esc with menu open collapsed the bar instead of just closing the menu')
    else pass('Esc closed the menu first; the bar stayed up')

    // 3c. SELECTING a command from the menu keeps the bar up (the focus
    //     bridge must not read the menu interaction as a blur).
    await clearEditable(page, editable)
    await page.keyboard.type('/')
    await page.waitForTimeout(600)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    const afterSelect = await page.evaluate((sel) => ({
      menuGone: !document.querySelector(`${sel} [role=listbox]`),
      barStillUp: !!document.querySelector(`${sel}.fm-lift`),
    }), SEAT)
    if (!afterSelect.menuGone) fail('selecting from the slash menu did not close it')
    else if (!afterSelect.barStillUp) fail('selecting a command collapsed the bar (menu interaction misread as blur)')
    else pass('selecting a command kept the bar up')

    // Cleanup + the unmount-with-lift-up path: leave focus mode via the
    // topbar EXIT BUTTON while the composer is still lifted and focused
    // (draft still "/"). The lift MUST come down with the overlay — a
    // leaked .fm-lift would float the main composer over the normal view
    // after exiting focus mode.
    const stillLifted = await page.evaluate((sel) => !!document.querySelector(sel), `${SEAT}.fm-lift`)
    await page.locator('.fm-topbar button').click()
    await page.waitForTimeout(400)
    const afterExit = await page.evaluate((sel) => ({
      overlay: !!document.querySelector('.fm-overlay'),
      leakedLift: !!document.querySelector(`${sel}.fm-lift`),
    }), SEAT)
    if (!stillLifted) fail('pre-exit sanity: composer was not lifted at unmount time')
    if (afterExit.overlay) fail('overlay still mounted after exit-button click')
    else pass('focus mode exited via topbar while lifted')
    if (afterExit.leakedLift) fail('lift leaked: .fm-lift still on the composer seat after exiting focus mode')
    else pass('lift released on exit (no leak into the main view)')

    // Clear the leftover draft (selected command text) in the MAIN composer.
    await clearEditable(page, page.locator(`${SEAT} [contenteditable=true]`).first())
    await page.waitForTimeout(100)
  } else {
    // ---- fallback: built-in textarea bar ----
    await page.waitForSelector('.fm-bar-text', { timeout: 5000 })
    pass('focus mode opened, built-in input bar present')

    const readCaret = () => page.evaluate(() => {
      const el = document.querySelector('.fm-bar-text')
      if (!el) return null
      return { value: el.value, start: el.selectionStart, end: el.selectionEnd, bar: !!document.querySelector('.fm-bar') }
    })

    // 1. Plain typing: the bar must survive every keystroke.
    const ta = page.locator('.fm-bar-text')
    await ta.click()
    await page.keyboard.type('hello world', { delay: 20 })
    let snap = await readCaret()
    if (!snap || snap.value !== 'hello world') fail(`typed text: expected "hello world", got ${JSON.stringify(snap)}`)
    else pass(`typed "hello world" (bar still up: ${snap.bar})`)
    if (!snap?.bar) fail('bar folded during plain typing')

    // 2. THE regression: Backspace with the caret mid-text must delete the
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

    // 3. IME composition, mid-text: the shield must keep the store echo away
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

    // Cleanup: clear the draft and leave focus mode.
    await clearEditable(page, ta)
    await page.keyboard.press('Escape')
  }
} finally {
  await browser.close()
}

console.log(process.exitCode ? '\nRESULT: RED — regression present' : '\nRESULT: GREEN — all input-surface invariants held')
