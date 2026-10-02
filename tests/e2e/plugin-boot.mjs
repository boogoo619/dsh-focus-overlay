#!/usr/bin/env node
/**
 * Plugin-surface regression loop (headless, against the live dsh web GUI).
 *
 * Guards the dsh 0.2 startup break: the client service registry dropped
 * `settingsScope`, so a browser half that still named it in its `inject` list
 * never activated and dsh's web boot aborted the whole client with
 * "web boot: 1 entry did not activate — dsh-focus-overlay: pending (waiting for
 * service: settingsScope)" (the GUI showed "Failed to load plugins").
 *
 * It asserts three things:
 *   1. the client booted with the plugin — no boot banner, no activation error;
 *   2. the plugin's browser half applied (its stylesheet is injected);
 *   3. the plugin's configuration renders on whichever surface the RUNNING dsh
 *      declares: the sidebar Plugins page's bundle detail
 *      (`plugins.bundle.config`, dsh 0.2) or the Settings → Plugins card
 *      (`settings.plugin.item`, dsh <= 0.1.x).
 *
 * Prerequisites:
 *   - the dsh GUI running at http://127.0.0.1:3080 with THIS repo's build live
 *     (`npm run build`; the web profile symlinks dsh-focus-overlay to this
 *     checkout, a page reload picks up the rebuilt lib/);
 *   - `~/.dsh/.credentials.yaml` carrying the `client-connection/browser-session`
 *     record (the cookie is minted locally, the secret never leaves the box);
 *   - a playwright chromium cache; override with CHROMIUM_EXE if needed.
 *
 * Usage: node tests/e2e/plugin-boot.mjs
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
  let inRecords = false
  let inRecord = false
  for (const line of text.split('\n')) {
    if (/^records:\s*$/.test(line)) { inRecords = true; continue }
    if (!inRecords) continue
    const m = /^(\s*)(\S+):\s*(.*)$/.exec(line)
    if (!m) continue
    const [, indent, key, rest] = m
    if (indent === '  ') { inRecord = key === 'client-connection/browser-session'; continue }
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
  return { name: 'dsh-auth-' + b64url(createHash('sha256').update(AUTHORITY).digest()), value: `v1.${body}.${sig}` }
}

// ---- harness ----

const pass = (msg) => console.log(`  ✓ ${msg}`)
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1 }

const browser = await chromium.launch({ executablePath: CHROMIUM_EXE, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const cookie = mintAuthCookie()
await context.addCookies([{ name: cookie.name, value: cookie.value, url: GUI_ORIGIN }])
await context.addInitScript(() => {
  // Skip the plugin's first-run intro so it cannot cover the surfaces under test.
  localStorage.setItem('dsh-focus-overlay:onboarded', '1')
  localStorage.setItem('dsh-focus-overlay:prefs', JSON.stringify({ borrow: true }))
})
const page = await context.newPage()
const consoleErrors = []
page.on('pageerror', (err) => consoleErrors.push(`[pageerror] ${err.message}`))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[console.error] ${m.text()}`) })
await page.goto(GUI_ORIGIN, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

try {
  // 1. Boot: dsh renders a "Failed to load plugins" banner when any client
  //    entry stays pending, naming the entry and the missing service.
  const boot = await page.evaluate(() => {
    const text = document.body.innerText
    return {
      banner: /Failed to load plugins/i.test(text),
      pending: /did not activate/i.test(text),
      focused: /dsh-focus-overlay: pending/i.test(text),
    }
  })
  if (boot.banner || boot.pending || boot.focused) {
    fail(`client boot failed: ${JSON.stringify(boot)}`)
  } else {
    pass('client booted with the plugin activated')
  }
  const activationErrors = consoleErrors.filter((e) => /did not activate|waiting for service|pending \(/i.test(e))
  if (activationErrors.length) fail(`activation error: ${activationErrors[0]}`)

  // 2. Browser half applied: its package stylesheet is injected.
  const applied = await page.evaluate(() => !!document.querySelector('style[data-plugin="dsh-focus-overlay"]'))
  if (applied) pass('plugin browser half applied (stylesheet present)')
  else fail('plugin browser half did not apply (no package stylesheet)')

  // 3. Configuration surface, on whichever one the running dsh declares.
  //    dsh 0.2: sidebar Plugins page → this bundle's detail → plugins.bundle.config.
  //    dsh <= 0.1.x: Settings → Plugins tab → settings.plugin.item card.
  let surface = null
  const sidebarPlugins = page.locator('button:has-text("插件"), [role="button"]:has-text("插件"), button:has-text("Plugins"), [role="button"]:has-text("Plugins")').first()
  if (await sidebarPlugins.count() > 0) {
    await sidebarPlugins.click()
    await page.waitForTimeout(2500)
    const card = page.locator('section[class*="page"] button[class*="cardTitle"]', { hasText: 'dsh-focus-overlay' }).first()
    if (await card.count() > 0) {
      await card.click()
      await page.waitForTimeout(2000)
      const detail = await page.evaluate(() => ({
        target: document.querySelector('[data-plugin-detail]')?.getAttribute('data-plugin-detail') ?? null,
        section: !!document.querySelector('[data-plugin-config]'),
        body: !!document.querySelector('.fm-plugin-page .fm-plugin-field'),
      }))
      if (detail.section && detail.body) surface = 'plugins.bundle.config (dsh 0.2 Plugins page)'
      else fail(`bundle detail did not render the config card: ${JSON.stringify(detail)}`)
    }
  }
  if (!surface) {
    const settings = page.locator('[aria-label*="设置"], [title*="设置"], button:has-text("设置"), button:has-text("Settings")').first()
    if (await settings.count() > 0) {
      await settings.click()
      await page.waitForTimeout(1200)
      const pluginsTab = page.locator('[role="tab"]:has-text("插件"), [role="tab"]:has-text("Plugins"), button:has-text("插件"), button:has-text("Plugins")').first()
      if (await pluginsTab.count() > 0) { await pluginsTab.click().catch(() => {}); await page.waitForTimeout(800) }
      if (await page.locator('.fm-plugin-card-header').count() > 0) surface = 'settings.plugin.item (Settings → Plugins card)'
    }
  }
  if (surface) pass(`configuration surface rendered: ${surface}`)
  else fail('no plugin configuration surface rendered on any layout')

  const unexpected = consoleErrors.filter((e) => !/did not activate|waiting for service|pending \(/i.test(e))
  if (unexpected.length) console.log(`  note: ${unexpected.length} console error(s): ${unexpected.slice(0, 3).join(' | ')}`)
} finally {
  await browser.close()
}

console.log(process.exitCode ? 'RESULT: RED' : 'RESULT: GREEN — the plugin boots and renders its configuration surface')
