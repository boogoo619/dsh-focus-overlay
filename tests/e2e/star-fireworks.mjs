#!/usr/bin/env node
/**
 * Firework visibility diagnostic (headless, against the live dsh web GUI).
 * Seeds the entry counter past the Star threshold, drives the REAL settings
 * card button, then answers three questions:
 *   1. does the [data-fm-fireworks] canvas appear at all?
 *   2. are particles actually DRAWN (non-transparent pixels on the canvas)?
 *   3. is it VISIBLE in the composited page (screenshots + hit-test overlap)?
 * Screenshots land in tests/e2e/out/. Run: node tests/e2e/star-fireworks.mjs
 */
import { readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const GUI_ORIGIN = process.env.DSH_GUI_ORIGIN || 'http://127.0.0.1:3080'
const AUTHORITY = new URL(GUI_ORIGIN).host
const CHROMIUM_EXE =
  process.env.CHROMIUM_EXE ||
  join(homedir(), 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
const OUT = join(import.meta.dirname, 'out')

// ---- browser-session cookie (same mint as input-caret.mjs) ----
const b64url = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
function browserSessionSecret() {
  const text = readFileSync(join(homedir(), '.dsh/.credentials.yaml'), 'utf8')
  let inRecords = false, inRecord = false
  for (const line of text.split('\n')) {
    if (/^records:\s*$/.test(line)) { inRecords = true; continue }
    if (!inRecords) continue
    const m = /^(\s*)(\S+):\s*(.*)$/.exec(line)
    if (!m) continue
    const [, indent, key, rest] = m
    if (indent === '  ') { inRecord = key === 'client-connection/browser-session'; continue }
    if (inRecord && indent === '      ' && key === 'secret' && rest) return rest.trim()
  }
  throw new Error('client-connection/browser-session secret not found')
}
function mintAuthCookie() {
  const secret = Buffer.from(browserSessionSecret().replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const issuedAt = Date.now()
  const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt, expiresAt: issuedAt + 24 * 3600_000 }), 'utf8'))
  const sig = b64url(createHmac('sha256', secret).update(body).digest())
  return { name: 'dsh-auth-' + b64url(createHash('sha256').update(AUTHORITY).digest()), value: `v1.${body}.${sig}` }
}

const log = (m) => console.log(m)
const fail = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1 }

const browser = await chromium.launch({ executablePath: CHROMIUM_EXE, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const cookie = mintAuthCookie()
await context.addCookies([{ name: cookie.name, value: cookie.value, url: GUI_ORIGIN }])
await context.addInitScript(() => {
  localStorage.setItem('dsh-focus-overlay:onboarded', '1')
  localStorage.setItem('dsh-focus-overlay:stats', JSON.stringify({ entries: 101 }))
  localStorage.setItem('dsh-focus-overlay:prefs', JSON.stringify({ borrow: true }))
})
const page = await context.newPage()
page.on('pageerror', (err) => console.error(`  [pageerror] ${err.message}`))
page.on('console', (msg) => { if (msg.type() === 'error') console.error(`  [console.error] ${msg.text()}`) })
await page.goto(GUI_ORIGIN, { waitUntil: 'networkidle' })

// ---- environment facts that can silence the animation ----
log('--- environment ---')
log(JSON.stringify(await page.evaluate(() => ({
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  innerW: innerWidth, innerH: innerHeight,
  dpr: devicePixelRatio,
  bodyTransform: getComputedStyle(document.body).transform,
  bodyFilter: getComputedStyle(document.body).filter,
}))))

// ---- walk to the settings page: try common entries, else dump candidates ----
log('--- navigate to settings ---')
const candidates = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('button, [role=button], a, [aria-label]')) {
    const text = (el.textContent || '').trim()
    const aria = el.getAttribute('aria-label') || ''
    const title = el.getAttribute('title') || ''
    if (/设置|settings|preference/i.test(text + ' ' + aria + ' ' + title)) {
      const r = el.getBoundingClientRect()
      out.push({ text: text.slice(0, 24), aria, title, visible: r.width > 0 && r.height > 0 })
    }
  }
  return out
})
log('candidates: ' + JSON.stringify(candidates))
const entry = page.locator('[aria-label*="设置"], [title*="设置"], button:has-text("设置"), a:has-text("设置")').first()
if (await entry.count() === 0) { fail('no settings entry found'); await browser.close(); process.exit(1) }
await entry.click()
await page.waitForTimeout(600)

// plugins tab if present
const pluginsTab = page.locator('[role="tab"]:has-text("插件"), button:has-text("插件"), [aria-label*="插件"], :text("Plugins")').first()
if (await pluginsTab.count() > 0) { await pluginsTab.click().catch(() => {}); await page.waitForTimeout(400) }

// ---- expand the plugin card and click the Star button ----
log('--- click the Star button ---')
const cardHeader = page.locator('.fm-plugin-card-header').first()
if (await cardHeader.count() === 0) { fail('plugin card not found'); await browser.close(); process.exit(1) }
await cardHeader.click()
await page.waitForTimeout(300)
const star = page.locator('button:has-text("GitHub Star")').first()
if (await star.count() === 0) { fail('star button not found (counter below threshold?)'); await browser.close(); process.exit(1) }

mkdirSync(OUT, { recursive: true })
// track the delayed GitHub popup (proves the NEW onClick ran end-to-end)
let popupOpened = null
context.on('page', (p) => { popupOpened = p.url() })
await star.click()
// did the Star button swap to the project-page button? (proves onClick + starred persistence ran)
await page.waitForTimeout(300)
log('repo button present: ' + JSON.stringify(await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('GitHub 项目页面') || (x.textContent || '').includes('GitHub project page'))
  return b ? { text: b.textContent } : null
})))
// sample the canvas state while the animation runs
for (const t of [200, 600, 1000, 1600]) {
  await page.waitForTimeout(t === 200 ? 200 : t - (t === 600 ? 200 : t === 1000 ? 600 : 1000))
  const state = await page.evaluate(() => {
    const c = document.querySelector('[data-fm-fireworks]')
    if (!c) return { present: false }
    const r = c.getBoundingClientRect()
    const ctx = c.getContext('2d')
    let lit = 0
    try {
      const img = ctx.getImageData(0, 0, c.width, c.height).data
      for (let i = 3; i < img.length; i += 40) if (img[i] > 0) lit++
    } catch (e) { return { present: true, readError: String(e) } }
    return { present: true, cssW: r.width, cssH: r.height, bufW: c.width, bufH: c.height, litSamples: lit, z: c.style.zIndex, parent: c.parentElement?.tagName }
  })
  log(`t=${t}ms canvas: ` + JSON.stringify(state))
}
await page.screenshot({ path: join(OUT, 'fireworks-1600ms.png') })
await page.waitForTimeout(3200) // celebrateThenOpen jumps at 4000ms — wait past it
log('popup opened: ' + (popupOpened ?? '(none — headless may block delayed popups)'))
// control experiment: inject the SAME algorithm directly and see if it draws
log('--- control: injected copy of launchFireworks ---')
await page.evaluate(() => {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('data-fm-fireworks', '')
  const dpr = Math.min(devicePixelRatio || 1, 2)
  const w = innerWidth, h = innerHeight
  canvas.width = Math.max(1, Math.floor(w * dpr))
  canvas.height = Math.max(1, Math.floor(h * dpr))
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  const COLORS = ['#f43f5e', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa']
  const rockets = [], particles = []
  const rand = (a, b) => a + Math.random() * (b - a)
  for (let i = 0; i < 3; i++) setTimeout(() => {
    rockets.push({ x: w * (0.32 + 0.18 * i) + rand(-30, 30), y: h + 8, vy: -h * rand(1.15, 1.3), targetY: h * rand(0.2, 0.34), color: COLORS[i % COLORS.length] })
  }, i * 320)
  let prev = performance.now()
  const step = (now) => {
    const dt = Math.min((now - prev) / 1000, 0.05)
    prev = now
    ctx.clearRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'lighter'
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i]
      r.y += r.vy * dt
      ctx.globalAlpha = 0.9
      ctx.fillStyle = r.color
      ctx.beginPath(); ctx.arc(r.x, r.y, 2, 0, Math.PI * 2); ctx.fill()
      if (r.y <= r.targetY) {
        rockets.splice(i, 1)
        for (let k = 0; k < 64; k++) {
          const angle = Math.PI * 2 * k / 64 + rand(-0.06, 0.06)
          const speed = rand(50, 300)
          const maxLife = rand(0.9, 1.6)
          particles.push({ x: r.x, y: r.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: maxLife, maxLife, color: Math.random() < 0.25 ? '#ffffff' : r.color })
        }
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]
      p.life -= dt
      if (p.life <= 0) { particles.splice(i, 1); continue }
      p.vy += 300 * dt
      p.vx *= 1 - 1.1 * dt
      p.vy *= 1 - 0.4 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife)
      ctx.fillStyle = p.color
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
    if (rockets.length > 0 || particles.length > 0) requestAnimationFrame(step)
    else canvas.remove()
  }
  requestAnimationFrame(step)
})
await page.waitForTimeout(700)
const ctrl = await page.evaluate(() => {
  const c = document.querySelector('[data-fm-fireworks]')
  if (!c) return { present: false }
  const ctx = c.getContext('2d')
  let lit = 0
  const img = ctx.getImageData(0, 0, c.width, c.height).data
  for (let i = 3; i < img.length; i += 40) if (img[i] > 0) lit++
  return { present: true, litSamples: lit }
})
log('control canvas: ' + JSON.stringify(ctrl))
await page.screenshot({ path: join(OUT, 'control-700ms.png') })
log('screenshots in tests/e2e/out/')

// ---- phase 2: instrumented synchronous click on a fresh page ----
log('--- phase 2: instrumented in-page click (fresh reload) ---')
await page.goto(GUI_ORIGIN, { waitUntil: 'networkidle' })
await page.locator('[aria-label*="设置"], [title*="设置"], button:has-text("设置"), a:has-text("设置")').first().click()
await page.waitForTimeout(600)
const pt = page.locator('[role="tab"]:has-text("插件"), button:has-text("插件"), [aria-label*="插件"], :text("Plugins")').first()
if (await pt.count() > 0) { await pt.click().catch(() => {}); await page.waitForTimeout(400) }
await page.locator('.fm-plugin-card-header').first().click()
await page.waitForTimeout(300)
const probe = await page.evaluate(() => {
  return new Promise((resolve) => {
    const events = []
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) if (n.nodeType === 1 && n.hasAttribute?.('data-fm-fireworks')) events.push({ t: Math.round(performance.now()), ev: 'canvas-added' })
        for (const n of m.removedNodes) if (n.nodeType === 1 && n.hasAttribute?.('data-fm-fireworks')) events.push({ t: Math.round(performance.now()), ev: 'canvas-removed' })
      }
    })
    mo.observe(document.documentElement, { childList: true, subtree: true })
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('GitHub Star'))
    if (!btn) { resolve({ error: 'no star button' }); return }
    btn.click() // synchronous dispatch: onClick runs within this JS task
    events.push({ t: Math.round(performance.now()), ev: 'clicked', canvasRightAfter: !!document.querySelector('[data-fm-fireworks]') })
    setTimeout(() => { mo.disconnect(); resolve({ events }) }, 3500)
  })
})
log('probe: ' + JSON.stringify(probe, null, 1))
await browser.close()
