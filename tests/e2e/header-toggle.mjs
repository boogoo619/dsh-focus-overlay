#!/usr/bin/env node
/**
 * Header-toggle regression loop (headless, against the live dsh web GUI).
 *
 * Guards the "click 专注 in the session header and nothing happens" bug. The
 * button must mount the focus overlay on a session that CONTAINS A USER
 * MESSAGE. dsh 0.1.3-alpha.2 dropped the `MessageText` primitive from
 * `@deepseek-ai/dsh-client-ui-primitives` (replaced by the `projectUserText`
 * projection). The stale import was `undefined`, so the overlay threw React
 * #130 the moment it rendered a user row — the click set the focus state but
 * the overlay never mounted, exactly the reported symptom. A blank session has
 * no user rows, so `input-caret.mjs` (which enters via the `F` hotkey on a
 * fresh session) stayed green and could not catch it; this loop deliberately
 * opens a stored session WITH history and drives the header button instead.
 *
 * Prerequisites:
 *   - the dsh GUI running at http://127.0.0.1:3080 with THIS repo's build live
 *     (`npm run build`; the web profile symlinks dsh-focus-overlay to this
 *     checkout, a page reload picks up the rebuilt lib/);
 *   - at least one stored session that contains a user message;
 *   - `~/.dsh/.credentials.yaml` carrying the `client-connection/browser-session`
 *     record (the cookie is minted locally, the secret never leaves the box);
 *   - a playwright chromium cache; override with CHROMIUM_EXE if needed.
 *
 * Usage: node tests/e2e/header-toggle.mjs
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
    localStorage.setItem('dsh-focus-overlay:prefs', JSON.stringify({ borrow: true }))
  })
  const page = await context.newPage()
  page.on('pageerror', (err) => console.error(`  [pageerror] ${err.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && /dsh-focus-overlay/.test(m.text())) console.error(`  [console.error] ${m.text()}`) })
  await page.goto(GUI_ORIGIN, { waitUntil: 'networkidle' })
  return { browser, context, page }
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

const OVERLAY = '.fm-overlay'
const TOGGLE = 'header[class*="header"] button:has-text("专注")'

const { browser, page } = await openGui()
try {
  const tried = new Set()
  let opened = false
  for (let attempt = 0; attempt < 3; attempt++) {
    const picked = await nextSession(page, tried)
    if (!picked) break
    const { row, text } = picked
    tried.add(text)
    await row.click()
    await page.waitForTimeout(1800)
    const button = page.locator(TOGGLE).first()
    if ((await button.count()) === 0) continue // session view without the plugin header
    await button.click()
    await page.waitForTimeout(700)
    const state = await page.evaluate(() => {
      const ov = document.querySelector('.fm-overlay')
      const users = [...document.querySelectorAll('.fm-user')]
      return {
        overlay: !!ov,
        userRows: users.length,
        firstUser: users.length ? (users[0].textContent || '').trim().slice(0, 40) : '',
      }
    })
    if (!state.overlay) {
      fail(`clicking 专注 on “${text.slice(0, 24)}” did not mount the overlay`)
      continue
    }
    pass(`header 专注 opened the overlay on “${text.slice(0, 24)}”`)
    if (state.userRows === 0) {
      fail('overlay mounted but rendered no user bubble — cannot confirm the user-row path')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      continue
    }
    pass(`user bubble rendered (${state.userRows} row(s), first: “${state.firstUser}…”)`)
    opened = true

    // Exit through the topbar button and confirm the overlay tears down.
    const exit = page.locator('.fm-exit, .fm-overlay button:has-text("退出专注")').first()
    if ((await exit.count()) > 0) {
      await exit.click()
      await page.waitForTimeout(500)
      const gone = await page.evaluate((sel) => !document.querySelector(sel), OVERLAY)
      if (gone) pass('overlay closed again from the topbar')
      else fail('overlay did not close from the topbar')
    }
    break
  }

  if (!opened) fail('could not exercise the header toggle on any stored session')
} finally {
  await browser.close()
}

console.log(process.exitCode ? 'RESULT: RED' : 'RESULT: GREEN — the session-header toggle mounts the overlay and renders user rows')
