#!/usr/bin/env node
/**
 * Keep-chrome regression loop (headless, against the live dsh web GUI).
 *
 * Guards the four "what does focus mode hide" switches:
 *   hideSidebar    — cover the sidebar column
 *   hideTopBar     — cover the session header (title + 对话/轨迹 tabs)
 *   hideStatusBar  — cover the composer's stats row
 *   hideProcess    — fold each turn's work into the counts summary
 *
 * What it drives, in two passes over the SAME stored session:
 *
 *   PASS A (all four OFF): the overlay must be INSET by the chrome it keeps —
 *     its box starts at the sidebar's right edge and below the session header,
 *     the header still receives pointer events (elementFromPoint hits it), the
 *     overlay draws no topbar of its own, the stats row is visible (lifted with
 *     the composer or pinned to the bottom of the window), and nothing is
 *     folded (no .fm-process-root disclosure buttons). Exiting through the
 *     header's 专注 button must work — it is the only way out once the overlay
 *     has no topbar.
 *
 *   PASS B (defaults: all four ON): the shipped behaviour — full-bleed overlay,
 *     the plugin's own topbar, and the folded counts rows when the session has
 *     any work to fold.
 *
 * Prerequisites:
 *   - the dsh GUI running at http://127.0.0.1:3080 with THIS repo's build live
 *     (the web profile's dsh-focus-overlay/lib/client.js must be this build;
 *     a page load picks it up, no dsh restart needed);
 *   - at least one stored session that contains a user message;
 *   - `~/.dsh/.credentials.yaml` carrying the `client-connection/browser-session`
 *     record (the cookie is minted locally, the secret never leaves the box);
 *   - a playwright chromium; override with CHROMIUM_EXE if the default path is
 *     not where this machine keeps it.
 *
 * Usage: node tests/e2e/keep-chrome.mjs
 */
import { readFileSync, mkdirSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const GUI_ORIGIN = process.env.DSH_GUI_ORIGIN || 'http://127.0.0.1:3080'
const AUTHORITY = new URL(GUI_ORIGIN).host // cookie audience = request host
const CHROMIUM_EXE =
  process.env.CHROMIUM_EXE ||
  join(process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'ms-playwright/chromium-1208/chrome-win64/chrome.exe')
const SHOTS = process.env.SHOT_DIR || join(process.cwd(), 'tests/e2e/out')

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
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol
const round = (v) => Math.round(v * 10) / 10

/** Prefs seeded before the app boots: `over` rides on top of the DEFAULTS. */
const seed = (over) => ({
  borrow: true,
  hideSidebar: true,
  hideTopBar: true,
  hideStatusBar: true,
  hideProcess: true,
  ...over,
})

async function openGui(prefs) {
  const browser = await chromium.launch({ executablePath: CHROMIUM_EXE, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const cookie = mintAuthCookie()
  await context.addCookies([{ name: cookie.name, value: cookie.value, url: GUI_ORIGIN }])
  await context.addInitScript((p) => {
    // Skip the plugin's first-run intro so it cannot block interaction, and
    // pin the four switches under test.
    localStorage.setItem('dsh-focus-overlay:onboarded', '1')
    localStorage.setItem('dsh-focus-overlay:prefs', JSON.stringify(p))
  }, prefs)
  const page = await context.newPage()
  page.on('pageerror', (err) => console.error(`  [pageerror] ${err.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && /dsh-focus-overlay/.test(m.text())) console.error(`  [console.error] ${m.text()}`) })
  await page.goto(GUI_ORIGIN, { waitUntil: 'networkidle' })
  return { browser, page }
}

/** The next untried non-blank session row, re-queried (the sidebar re-renders
 *  on navigation, so held locators/indices go stale). */
const SESSION_ROW = '[role="treeitem"][class*="sessionRow"]'
async function nextSession(page, tried) {
  const rows = page.locator(SESSION_ROW)
  const count = await rows.count()
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i)
    const text = ((await row.textContent()) || '').trim()
    if (text.startsWith('新会话')) continue // the blank draft has no user rows
    if (tried.has(text)) continue
    return { row, text }
  }
  return null
}

/**
 * Open session candidates until one carries a COMPLETED turn (a reply) — the
 * assertions about the stats row and the folded work process are only
 * meaningful on a session that has one. Returns the probe of the open focus
 * view, or null when no candidate qualifies.
 */
async function enterFocusOnUsedSession(page, tried, { requireWork = false } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const picked = await nextSession(page, tried)
    if (!picked) return null
    tried.add(picked.text)
    await picked.row.click()
    await page.waitForTimeout(1800)
    const button = page.locator(TOGGLE_IN).first()
    if ((await button.count()) === 0) continue // a view without the plugin header
    await button.click()
    await page.waitForTimeout(900)
    const state = await probe(page)
    if (!state.overlay) {
      fail(`clicking 专注 on “${picked.text.slice(0, 24)}” did not mount the overlay`)
      continue
    }
    const hasReply = state.userRows >= 2
    const hasStats = (state.dockText || '').trim() !== '' || (state.dockRect ? state.dockRect.h > 0 : false)
    if (!hasReply && !hasStats) {
      console.log(`  · “${picked.text.slice(0, 24)}” has no completed turn yet — trying the next session`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      continue
    }
    void requireWork
    return { picked, state }
  }
  return null
}

const OVERLAY = '.fm-overlay'
/** The plugin's header toggle, targeted by its own tooltip: matching on the
 *  visible text alone is ambiguous — a session whose TITLE contains 专注 (e.g.
 *  this very repo's own session) puts a same-text crumb button in the header
 *  first, and that one is disabled. */
const TOGGLE_IN = 'header[class*="header"] button[title="进入专注模式"]'
const TOGGLE_OUT = 'header[class*="header"] button[title="退出专注"]'
const HEADER = 'header[class*="header"]'

/** Everything the assertions need, read in ONE page evaluation. */
async function probe(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement ?? null
    const sidebarCol = frame ? frame.firstElementChild : null
    const scroll = document.querySelector('[data-conversation-scroll]')
    const conversationRoot = scroll ? scroll.parentElement?.parentElement : null
    const header = conversationRoot ? conversationRoot.querySelector('header') : null
    const overlay = document.querySelector('.fm-overlay')
    const seat = document.querySelector('[data-composer-seat]')
    const dock = document.querySelector('[data-slot="conversation.composer.dock"]')
    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }
    }
    let headerHit = null
    if (header) {
      const r = header.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + Math.min(120, r.width / 2), r.top + r.height / 2)
      headerHit = !!hit && header.contains(hit)
    }
    let sidebarHit = null
    if (sidebarCol) {
      const r = sidebarCol.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      sidebarHit = !!hit && sidebarCol.contains(hit)
    }
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      sidebar: rect(sidebarCol),
      header: rect(header),
      headerHit,
      sidebarHit,
      overlay: rect(overlay),
      bodyRect: rect(document.querySelector('.fm-body')),
      wrapRect: rect(document.querySelector('.fm-body-wrap')),
      reserve: getComputedStyle(document.body).getPropertyValue('--fm-bottom-reserve').trim(),
      seatRect: rect(document.querySelector('[data-composer-seat].fm-lift')),
      pluginDockRect: rect(document.querySelector('.fm-dock')),
      topbar: !!document.querySelector('.fm-topbar'),
      seatClasses: seat ? seat.className : null,
      dockClasses: dock ? dock.className : null,
      dockRect: rect(dock),
      dockText: dock ? (dock.textContent || '') : '',
      folded: document.querySelectorAll('.fm-process-root').length,
      workRows: document.querySelectorAll('.fm-hidden').length,
      userRows: document.querySelectorAll('.fm-user').length,
    }
  })
}

mkdirSync(SHOTS, { recursive: true })
const shoot = async (page, name) => {
  try { await page.screenshot({ path: join(SHOTS, name) }) } catch { /* screenshots are evidence, never a failure */ }
}

/**
 * The bottom status bar, in whichever composer state the dock is in:
 *   * seat lifted  → the official stats row must ride INSIDE the lifted seat
 *     (`.fm-lift-stats` opts out of the stylesheet's dock-row hide);
 *   * seat at rest  → the row itself must be lifted into a bottom strip
 *     (`.fm-status-lift`), flush with the window bottom.
 * A session whose StatsPills renders null (no steps, no tokens yet) is not a
 * failure — the row is legitimately empty — but it must still be in the right
 * container, which is what the class assertions check.
 */
function assertStatsRow(state, label) {
  const seatLifted = /fm-lift/.test(state.seatClasses || '')
  const soloStrip = /fm-status-lift/.test(state.dockClasses || '')
  const text = (state.dockText || '').trim()
  const box = state.dockRect
  const hasBox = !!box && box.h > 0
  if (seatLifted) {
    if (!/fm-lift-stats/.test(state.seatClasses || '')) fail(`${label}: the lifted composer hides the stats row although hideStatusBar is off (seat: ${state.seatClasses})`)
    else pass(`${label}: the stats row rides with the lifted composer (seat: ${state.seatClasses})`)
  } else if (soloStrip) {
    pass(`${label}: the stats row is lifted on its own into a bottom strip`)
    if (hasBox && !near(box.bottom, state.viewport.h, 3)) fail(`${label}: the stats strip is not flush with the window bottom (bottom=${round(box.bottom)} vs ${state.viewport.h})`)
    else if (hasBox) pass(`${label}: the stats strip sits flush with the window bottom`)
  } else {
    fail(`${label}: the stats row is neither with the composer nor lifted on its own (seat: ${state.seatClasses}, dock: ${state.dockClasses})`)
  }
  if (hasBox && text) pass(`${label}: stats content rendered — “${text.slice(0, 44)}”`)
  else if (hasBox) console.log(`  · ${label}: the row has a ${round(box.h)}px box but no stats text (a session with steps/tokens renders the pills)`)
}

/**
 * The conversation must never be painted over: the scrollport ends where the
 * bottom surface (lifted composer / the plugin's own dock) begins. This is the
 * "对话框遮住正文" regression — the reserve is what keeps the reading area clear.
 */
function assertNoCover(state, label) {
  const tops = []
  if (state.seatRect && state.seatRect.h > 0) tops.push(state.seatRect.y)
  if (state.pluginDockRect && state.pluginDockRect.h > 0) tops.push(state.pluginDockRect.y)
  if (state.dockRect && state.dockRect.h > 0) tops.push(state.dockRect.y)
  const top = tops.length ? Math.min(...tops) : state.viewport.h
  if (!state.bodyRect) { fail(`${label}: no reading surface found`); return }
  if (state.bodyRect.bottom <= top + 1) pass(`${label}: reading surface ends above the composer (${round(state.bodyRect.bottom)} ≤ ${round(top)})`)
  else fail(`${label}: the composer covers the conversation (reading surface bottom ${round(state.bodyRect.bottom)} > composer top ${round(top)})`)
  const reserve = Number.parseFloat(state.reserve || '0')
  if (tops.length === 0) {
    if (reserve === 0) pass(`${label}: nothing at the bottom → no reserve`)
    else fail(`${label}: reserved ${round(reserve)}px although no bottom surface is on screen`)
  } else if (reserve > 0 && state.wrapRect) {
    const shrunk = state.wrapRect.h - state.bodyRect.h
    if (near(shrunk, reserve, 2)) pass(`${label}: the scrollport is shrunk by exactly the reserve (${round(shrunk)}px)`)
    else fail(`${label}: scrollport shrink ${round(shrunk)}px does not match --fm-bottom-reserve ${round(reserve)}px`)
  } else {
    fail(`${label}: a bottom surface is on screen but --fm-bottom-reserve is ${state.reserve || 'empty'}`)
  }
}

/** One reading of the bottom state: which dock form is up, and how far the
 *  reader is from the end of the conversation. */
async function sampleDock(page) {
  return page.evaluate(() => {
    const body = document.querySelector('.fm-body')
    const raw = body ? Math.round(body.scrollHeight - body.scrollTop - body.clientHeight) : null
    const lifted = !!document.querySelector('[data-composer-seat].fm-lift')
    const bar = !!document.querySelector('.fm-bar')
    const pill = document.querySelector('.fm-pill')
    const jump = !!pill && /回到最新/.test(pill.getAttribute('title') || '')
    return {
      raw,
      reserve: getComputedStyle(document.body).getPropertyValue('--fm-bottom-reserve').trim(),
      form: lifted || bar ? 'bar' : (jump ? 'jump' : (pill ? 'pill' : 'none')),
    }
  })
}

/**
 * Scroll to the bottom the way a person does (small steps, not one jump) and
 * then watch the dock for a while. Two things must hold:
 *
 *   1. the dock SETTLES — the reserve changes the scrollport's height, and a
 *      bottom zone derived from the old geometry would flip the dock back and
 *      forth (bar ⟷ jump button), leaving the reader stuck with the ↓ button
 *      and unable to scroll any further;
 *   2. the newest line stays visible (distance ≈ 0) — the reserve change must
 *      carry the reader's distance to the end over, not push it out of view.
 */
async function assertBottomSettles(page, label) {
  for (let i = 0; i < 26; i++) {
    await page.evaluate(() => { const b = document.querySelector('.fm-body'); if (b) b.scrollBy(0, 90) })
    await page.waitForTimeout(45)
  }
  await page.waitForTimeout(500)
  const samples = []
  for (let i = 0; i < 6; i++) { samples.push(await sampleDock(page)); await page.waitForTimeout(180) }
  const forms = [...new Set(samples.map((s) => s.form))]
  if (forms.length === 1) pass(`${label}: the dock settles at the bottom (${forms[0]}, reserve ${samples[0].reserve})`)
  else fail(`${label}: the dock flickers at the bottom — ${samples.map((s) => `${s.form}@${s.raw}`).join(' → ')}`)
  const last = samples[samples.length - 1]
  if (last.form !== 'jump') pass(`${label}: the ↓ button is gone once the bottom is reached (${last.form})`)
  else fail(`${label}: the ↓ button stays up at the very bottom (distance ${last.raw}, reserve ${last.reserve})`)
  if (last.raw !== null && Math.abs(last.raw) <= 2) pass(`${label}: the newest line is still on screen (distance ${last.raw})`)
  else fail(`${label}: reaching the bottom pushed the end out of view (distance ${last.raw})`)
}

let browser = null

try {
  // ---------------- PASS A: all four switches OFF ----------------
  console.log('\nPASS A — sidebar / top bar / status bar / process all KEPT')
  // (the sidebar may start collapsed from a previous run; the F hotkey enters
  //  focus either way, so the pass does not depend on the sidebar being wide)
  {
    const gui = await openGui(seed({
      hideSidebar: false,
      hideTopBar: false,
      hideStatusBar: false,
      hideProcess: false,
    }))
    browser = gui.browser
    const page = gui.page
    const tried = new Set()
    const opened = await enterFocusOnUsedSession(page, tried)
    if (opened) {
      const { picked, state: before } = opened
      pass(`overlay mounted on “${picked.text.slice(0, 24)}” (${before.userRows} user row(s))`)
      await shoot(page, 'keep-chrome-all-visible.png')

      // --- the sheet is inset by the chrome it keeps ---
      if (near(before.overlay.x, 0) && before.sidebar && before.sidebar.w > 0) {
        fail(`overlay is full-bleed (x=${round(before.overlay.x)}) although the sidebar is kept (w=${round(before.sidebar.w)})`)
      } else if (before.sidebar && before.sidebar.w > 0) {
        pass(`overlay starts at the sidebar edge (x=${round(before.overlay.x)} vs sidebar w=${round(before.sidebar.w)})`)
      } else {
        console.log('  · sidebar column is collapsed to 0 — edge inset not measurable this run')
      }
      if (before.header && before.header.h > 0) {
        if (near(before.overlay.y, before.header.h)) pass(`overlay starts below the header (y=${round(before.overlay.y)} vs header h=${round(before.header.h)})`)
        else fail(`overlay y=${round(before.overlay.y)} does not match the header height ${round(before.header.h)}`)
      }
      if (before.headerHit === true) pass('the session header is still hit-testable (not covered)')
      else fail('the session header is covered or missing while hideTopBar is off')
      if (before.sidebarHit === false && before.sidebar && before.sidebar.w > 0) fail('the kept sidebar is covered by the sheet')
      else if (before.sidebar && before.sidebar.w > 0) pass('the kept sidebar is still hit-testable')
      if (before.topbar) fail('the overlay still renders its own topbar although the header is kept')
      else pass('the overlay renders no duplicate topbar')

      // --- the stats row is visible in whichever composer state we landed in ---
      assertStatsRow(before, 'PASS A')
      // --- the composer never covers the conversation ---
      assertNoCover(before, 'PASS A')

      // --- work process unfolded ---
      if (before.folded === 0) pass('no folded work-process disclosure while the process is shown')
      else fail(`${before.folded} folded process row(s) rendered although the process is shown`)

      // --- the dock must settle when the reader reaches the bottom ---
      await assertBottomSettles(page, 'PASS A')
      await shoot(page, 'keep-chrome-bottom-settled.png')

      // --- input bar up: the row must ride WITH the lifted composer ---
      await page.evaluate(() => {
        const body = document.querySelector('.fm-body')
        if (body) body.scrollTop = body.scrollHeight
      })
      await page.waitForTimeout(700)
      // A session that still carries a draft shows the collapsed pill instead of
      // the ambient bar; clicking it is the user's own "give me the input bar"
      // gesture and lands the dock in the BAR form — the state whose lifted
      // official composer used to cover the conversation.
      const pill = page.locator('.fm-pill').first()
      if ((await pill.count()) > 0) {
        await pill.click()
        await page.waitForTimeout(900)
      }
      const bar = await probe(page)
      if (/fm-lift/.test(bar.seatClasses || '')) {
        pass(`the seat is lifted with the bar (seat: ${bar.seatClasses})`)
        assertStatsRow(bar, 'PASS A · bar form')
      } else {
        console.log(`  · the dock is not in the bar form this run (seat: ${bar.seatClasses}) — lifted-composer row not exercised`)
      }
      assertNoCover(bar, 'PASS A · bar form')
      await shoot(page, 'keep-chrome-bar-form.png')

      // --- the header button is the way back out ---
      const exit = page.locator(TOGGLE_OUT).first()
      if ((await exit.count()) === 0) fail('the header 专注 button does not offer an exit while focus is on')
      else {
        await exit.click()
        await page.waitForTimeout(500)
        const gone = await page.evaluate((sel) => !document.querySelector(sel), OVERLAY)
        if (gone) pass('the header button exits focus mode')
        else fail('the header button did not exit focus mode')
      }
    } else {
      fail('could not exercise any stored session with a completed turn in PASS A')
    }
    await gui.browser.close()
    browser = null
  }

  // ---------------- PASS B: shipped defaults (all four ON) ----------------
  console.log('\nPASS B — defaults: everything hidden (shipped behaviour)')
  {
    const gui = await openGui(seed({}))
    browser = gui.browser
    const page = gui.page
    const tried = new Set()
    const opened = await enterFocusOnUsedSession(page, tried)
    if (opened) {
      const { picked, state: after } = opened
      pass(`overlay mounted on “${picked.text.slice(0, 24)}”`)
      await shoot(page, 'keep-chrome-defaults.png')

      if (near(after.overlay.x, 0) && near(after.overlay.y, 0)) pass('overlay is full-bleed again (x=0, y=0)')
      else fail(`overlay is not full-bleed (x=${round(after.overlay.x)}, y=${round(after.overlay.y)})`)
      if (after.topbar) pass('the overlay draws its own topbar again')
      else fail('the overlay lost its own topbar although hideTopBar is on')
      if (/fm-status-lift/.test(after.dockClasses || '')) fail('the stats strip is still lifted although hideStatusBar is on')
      else pass('the stats row is not lifted on its own')
      if (/fm-lift-stats/.test(after.seatClasses || '')) fail('the lifted seat still keeps the stats row although hideStatusBar is on')
      else pass('the lifted seat drops the stats row again')
      if (after.folded > 0) pass(`work process folded again (${after.folded} disclosure row(s), ${after.workRows} hidden row(s))`)
      else console.log('  · this session has no foldable work — folded-row count not asserted')
      assertNoCover(after, 'PASS B')
      await assertBottomSettles(page, 'PASS B')

      // --- stress: a multi-line draft makes the composer much taller, which is
      // exactly the state that used to flicker. The band grows line by line, so
      // the reader must stay pinned to the newest line the whole time. ---
      const editable = page.locator('[data-composer-seat] [contenteditable="true"]').first()
      if ((await editable.count()) > 0) {
        await editable.click()
        await page.waitForTimeout(300)
        for (let i = 1; i <= 6; i++) {
          await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift')
          await page.keyboard.type(`draft line ${i}`)
        }
        await page.waitForTimeout(600)
        const tall = []
        for (let i = 0; i < 5; i++) { tall.push(await sampleDock(page)); await page.waitForTimeout(180) }
        const tallForms = [...new Set(tall.map((s) => s.form))]
        const last = tall[tall.length - 1]
        if (tallForms.length === 1) pass(`PASS B · tall draft: the dock stays stable (${tallForms[0]}, reserve ${last.reserve})`)
        else fail(`PASS B · tall draft: the dock flickers — ${tall.map((s) => `${s.form}@${s.raw}`).join(' → ')}`)
        if (Math.abs(last.raw ?? 999) <= 2) pass(`PASS B · tall draft: the newest line is still on screen (distance ${last.raw})`)
        else fail(`PASS B · tall draft: the composer pushed the end out of view (distance ${last.raw}, reserve ${last.reserve})`)
        await shoot(page, 'keep-chrome-tall-draft.png')
        // Leave the session as we found it: clear the test draft.
        await page.keyboard.press('Control+a')
        await page.keyboard.press('Delete')
        await page.waitForTimeout(400)
      } else {
        console.log('  · no borrowed composer to type into — tall-draft stress skipped')
      }
    } else {
      fail('could not exercise any stored session with a completed turn in PASS B')
    }
    await gui.browser.close()
    browser = null
  }
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
}

console.log(`\nscreenshots: ${SHOTS}`)
console.log(process.exitCode ? 'RESULT: RED' : 'RESULT: GREEN — the four keep-chrome switches drive the live GUI as specified')
