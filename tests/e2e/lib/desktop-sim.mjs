/**
 * Reusable Playwright harness for exercising the focus overlay against a real
 * DSH desktop-runtime web instance (dsh 0.2.2-rc.1 `fdmtest`-style profile),
 * including simulation of the desktop window-frame markers.
 *
 * Why this exists: the dsh desktop app (macOS + Windows, 0.2.2-rc.1) renders
 * the hidden native-titlebar area as ordinary web content. Its renderer
 * preload marks `<html>` with `data-platform`, `data-windows-titlebar`,
 * `--dsh-windows-titlebar-height` and `data-fullscreen`; the official layout
 * CSS turns those into `--dsh-frame-top-clearance` / `--dsh-frame-overlay-top`,
 * which the focus overlay consumes. A normal browser has none of the markers,
 * so this module applies them AFTER boot (see
 * docs/desktop-dsh-0.2.2-notes.md — applying them before boot breaks the
 * official shortcuts entry because the Electron bridge is missing).
 *
 * Two ways to get the GUI:
 *   1. Attach:   DSH_GUI_ORIGIN='http://127.0.0.1:3098/?token=…'  (unit
 *      tests / repeated runs against an already-running instance)
 *   2. Spawn:    DSH_HOME=/tmp/dsh-home-verify DSH_PORT=3098 (default port),
 *      optionally DSH_GUI_PROFILE=fmtest — the harness runs the exact
 *      Electron-node desktop-host command from the notes, reads
 *      `dsh web: http://…` from its stdout and stops it on close. The real
 *      ~/.dsh home is refused on purpose (never touch the live desktop app
 *      profile). DSH_PROFILE is deliberately not used: this Agent runtime
 *      already exports DSH_PROFILE=desktop, which the desktop-host CLI rejects.
 *
 * The plugin build itself is NOT driven by this module: run `npm run build`
 * first (the isolated profile links the repo checkout, so lib/ must be fresh)
 * and restart the spawned instance after a rebuild (the web server reports a
 * startup-time plugin revision, so a live server may keep serving the old
 * client bundle).
 *
 * No writes outside tests/e2e/ (screenshots go to tests/e2e/out/, which is
 * gitignored).
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const HERE = dirname(fileURLToPath(import.meta.url))
export const OUT_DIR = join(HERE, '..', 'out')

/** Chromium used by the repo's existing e2e scripts; override with CHROMIUM_EXE. */
export function chromiumPath() {
  return (
    process.env.CHROMIUM_EXE ||
    join(
      homedir(),
      'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    )
  )
}

const DESKTOP_APP = '/Applications/DeepSeek Harness.app'
const DESKTOP_BIN = process.env.DSH_DESKTOP_BIN || join(DESKTOP_APP, 'Contents/MacOS/DeepSeek Harness')
const DESKTOP_RUNTIME_CLI =
  process.env.DSH_DESKTOP_CLI ||
  join(DESKTOP_APP, 'Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate, { timeout = 10_000, interval = 150, label = 'condition' } = {}) {
  const started = Date.now()
  let lastError
  for (;;) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    if (Date.now() - started > timeout) {
      throw new Error(`timed out after ${timeout}ms waiting for ${label}${lastError ? ` (last error: ${lastError.message})` : ''}`)
    }
    await sleep(interval)
  }
}

/**
 * Resolve the GUI origin to drive.
 * - `DSH_GUI_ORIGIN` (may carry `?token=…`) wins and is used as-is (attach mode).
 * - otherwise spawn the desktop runtime on `DSH_PORT` (default 3098) with
 *   `DSH_HOME` (required) and `DSH_PROFILE` (default `fmtest`).
 * @returns {Promise<{origin: string, mode: 'attach'|'spawned', stop: () => Promise<void>, log: () => string}>}
 */
export async function ensureGui() {
  const attach = process.env.DSH_GUI_ORIGIN
  if (attach) {
    return { origin: attach, mode: 'attach', stop: async () => {}, log: () => '' }
  }

  const home = process.env.DSH_HOME
  if (!home) {
    throw new Error(
      'no GUI target: set DSH_GUI_ORIGIN (attach to a running instance) or DSH_HOME (+ optional DSH_PORT=3098) to spawn one',
    )
  }
  // Safety: never spawn the harness against the real desktop home/profile —
  // that would mutate the user's live app state. The isolated home is a copy
  // created from /tmp/dsh-home-test (see docs notes).
  const realHome = join(homedir(), '.dsh')
  if (home === realHome || home === `${realHome}/`) {
    throw new Error(
      `refusing to spawn against the real desktop home (${realHome}); set DSH_HOME to an isolated copy, e.g. /tmp/dsh-home-verify (clone /tmp/dsh-home-test into it)`,
    )
  }
  if (!existsSync(home)) throw new Error(`DSH_HOME does not exist: ${home} (clone /tmp/dsh-home-test into it first)`)

  const port = String(process.env.DSH_PORT || '3098')
  // NOT DSH_PROFILE: the Agent-runtime shell already defines DSH_PROFILE
  // (e.g. "desktop"), which the desktop-host CLI rejects. Use DSH_GUI_PROFILE.
  const profile = process.env.DSH_GUI_PROFILE || 'fmtest'

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: home,
    PATH: `${join(homedir(), '.npm-global/bin')}:/opt/homebrew/bin:${process.env.PATH || ''}`,
  }
  // Drop runtime-context variables inherited from this Agent session so the
  // spawned server cannot resolve the real GUI's profile/session binding.
  for (const name of ['DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSH_SESSION_ID', 'DSH_WEB_URL', 'DSH_SHELL']) delete env[name]
  const child = spawn(DESKTOP_BIN, ['--expose-internals', DESKTOP_RUNTIME_CLI, '--profile', profile, '--port', port, '--no-open'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let buffer = ''
  let origin = null
  const listeners = []
  const consume = (chunk) => {
    buffer += chunk.toString('utf8')
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', consume)
  const onExit = (code, signal) => {
    if (!origin) {
      origin = { failed: `exited before printing the URL (code=${code}, signal=${signal})` }
    }
  }
  child.once('exit', onExit)
  listeners.push(() => child.off('exit', onExit))

  const stop = async () => {
    for (const off of listeners) off()
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    try {
      await waitFor(() => child.exitCode !== null || child.signalCode !== null, { timeout: 6_000, interval: 100, label: 'dsh web server exit' })
    } catch {
      child.kill('SIGKILL')
      await sleep(300)
    }
  }

  try {
    const url = await waitFor(
      () => {
        if (origin && typeof origin === 'object') throw new Error(origin.failed)
        const match = /dsh web:\s*(http:\/\/\S+)/.exec(buffer)
        return match ? match[1] : null
      },
      { timeout: 90_000, interval: 200, label: `dsh web server start (${DESKTOP_BIN})` },
    )
    origin = url
  } catch (error) {
    await stop()
    throw new Error(
      `${error.message}\n--- instance output (tail) ---\n${buffer.split('\n').slice(-25).join('\n') || '(empty)'}`,
    )
  }

  // The HTTP listener may lag the printed URL by a moment. Any HTTP status
  // (200, 302, even 401 before the token is exchanged) means it is listening.
  try {
    await waitFor(
      async () => {
        try {
          await fetch(origin, { redirect: 'manual' })
          return true
        } catch {
          return false
        }
      },
      { timeout: 30_000, interval: 250, label: 'dsh web server accept connections' },
    )
  } catch (error) {
    await stop()
    throw new Error(`${error.message}\n--- instance output (tail) ---\n${buffer.split('\n').slice(-25).join('\n') || '(empty)'}`)
  }

  return { origin, mode: 'spawned', stop, log: () => buffer }
}

/** Create tests/e2e/out/ (gitignored) — screenshots only live there. */
export function ensureOutDir() {
  mkdirSync(OUT_DIR, { recursive: true })
  return OUT_DIR
}

/**
 * Boot a Chromium page against the GUI and seed the plugin's local storage.
 * @param {{origin: string, viewport?: {width:number,height:number}, headless?: boolean, log?: (line: string) => void}} options
 */
export async function launchSim({ origin, viewport = { width: 1440, height: 900 }, headless, log = () => {} } = {}) {
  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    headless: headless ?? process.env.HEADLESS !== '0',
  })
  const context = await browser.newContext({ viewport })
  // Must run before any page script: skips the plugin's first-run onboarding
  // and enables the borrowed official composer (the shipped default).
  await context.addInitScript(() => {
    localStorage.setItem('dsh-focus-overlay:onboarded', '1')
    localStorage.setItem('dsh-focus-overlay:prefs', JSON.stringify({ borrow: true }))
  })
  const page = await context.newPage()
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  log(`→ opening ${origin}`)
  await page.goto(origin, { waitUntil: 'domcontentloaded' })

  await waitFor(
    async () => {
      const booted = await page.evaluate(() => document.querySelectorAll('[role="treeitem"]').length > 0)
      if (booted) return true
      const body = await page.evaluate(() => (document.body?.innerText || '').slice(0, 400))
      if (/Failed to load plugins|did not activate|pending \(waiting for service/.test(body)) {
        throw new Error(`the client boot reported a plugin failure:\n${body}`)
      }
      return false
    },
    { timeout: 45_000, interval: 250, label: 'dsh web client boot (sidebar treeitems)' },
  )

  const sim = {
    browser,
    context,
    page,
    origin,
    viewport,
    pageErrors,
    consoleErrors,
    /** Render diagnostics the test prints when something fails. */
    diagnostics() {
      return {
        pageErrors: [...pageErrors],
        consoleErrors: [...consoleErrors],
        focusOverlayErrors: consoleErrors.filter((line) => line.includes('dsh-focus-overlay')),
      }
    },
    /** Dismiss the official first-run "预览版说明" dialog if this profile shows it. */
    async dismissPreviewNotice() {
      const dialog = page.locator('[role="dialog"], [class*="modal" i]').filter({ hasText: '预览版说明' }).first()
      if ((await dialog.count()) > 0 && (await dialog.isVisible().catch(() => false))) {
        const cont = dialog.locator('button:has-text("继续")').first()
        if ((await cont.count()) > 0) {
          await cont.click().catch(() => {})
          await sleep(400)
          return true
        }
      }
      // The dialog may be a bare button row without a known container.
      const cont = page.locator('button:has-text("继续")').first()
      if ((await cont.count()) > 0 && (await cont.isVisible().catch(() => false))) {
        await cont.click().catch(() => {})
        await sleep(400)
        return true
      }
      return false
    },
    /**
     * List the stored sidebar session rows (workspace/project rows are
     * treeitems too, so only rows that carry the session-row class or the
     * relative-time suffix are returned). Expands “展开其余 N 个会话” once when
     * older sessions are hidden, and waits for the async sidebar fill-in.
     * @returns {Promise<Array<{index: number, text: string, cls: string}>>}
     */
    async storedSessions() {
      const sessionRows = page.locator('[role="treeitem"]')
      const readRows = async () => {
        const rows = []
        const count = await sessionRows.count()
        for (let i = 0; i < count; i++) {
          const row = sessionRows.nth(i)
          const text = ((await row.textContent()) || '').replace(/\s+/g, ' ').trim()
          const cls = (await row.getAttribute('class')) || ''
          rows.push({ index: i, text, cls })
        }
        return rows
      }
      const isSessionRow = (row) => /sessionRow/.test(row.cls) || /(分钟|小时|天|个月|年)\s*$/.test(row.text)

      // The sidebar lists workspaces first and fills the session rows in
      // asynchronously; older sessions may sit behind "展开其余 N 个会话".
      let rows = []
      let expanded = false
      const started = Date.now()
      for (;;) {
        rows = await readRows()
        if (rows.some(isSessionRow)) break
        if (!expanded) {
          const expand = page.locator('button:has-text("展开其余")').first()
          if ((await expand.count()) > 0 && (await expand.isVisible().catch(() => false))) {
            await expand.click().catch(() => {})
            expanded = true
            await sleep(600)
            continue
          }
        }
        if (Date.now() - started > 20_000) {
          throw new Error(`sidebar has no stored session rows to open; treeitems: ${rows.map((row) => `“${row.text}”`).join(' | ') || '(none)'}`)
        }
        await sleep(400)
      }
      return rows.filter(isSessionRow)
    },
    /**
     * Open one stored session by its sidebar row index and wait until the
     * session header (and the plugin's 专注 action) is live.
     * @returns {Promise<{title: string, rowText: string, rowIndex: number}>}
     */
    async openStoredSession(rowIndex) {
      const row = page.locator('[role="treeitem"]').nth(rowIndex)
      const rowText = ((await row.textContent()) || '').replace(/\s+/g, ' ').trim()
      log(`→ opening session “${rowText.slice(0, 40)}”`)
      await row.click()
      await sleep(1_200)
      await waitFor(
        async () => (await page.locator('header button:has-text("专注")').count()) > 0,
        { timeout: 20_000, interval: 250, label: 'session header 专注 action' },
      )
      await sleep(600)
      const title = rowText.replace(/\s*\d+\s*(分钟|小时|天|个月|年)\s*$/, '').trim()
      return { title, rowText, rowIndex }
    },
    /**
     * Open a stored sidebar session that has conversation history.
     * Picks (in order): DSH_SESSION_TITLE prefix, the seeded desktop-adaptation
     * session, then the first stored session.
     * @returns {Promise<{title: string, rowText: string, rowIndex: number}>}
     */
    async openSessionWithHistory() {
      const hint = process.env.DSH_SESSION_TITLE || '适配最新 Windows 和 Mac 桌面版 dsh'
      const rows = await this.storedSessions()
      const candidates = rows.filter((row) => !row.text.startsWith('新会话'))
      if (candidates.length === 0) {
        throw new Error(`sidebar has no non-draft session row; treeitems: ${rows.map((row) => `“${row.text}”`).join(' | ')}`)
      }
      const picked = candidates.find((row) => row.text.startsWith(hint)) || candidates[0]
      return this.openStoredSession(picked.index)
    },
    /** Click the plugin's 专注 header action (idempotent: no-op if already open). */
    async clickFocus() {
      const toggle = page.locator('header button:has-text("专注")').first()
      if ((await toggle.count()) === 0) throw new Error('the session header has no 专注 action (plugin client half not active?)')
      await toggle.click()
      log('→ clicked header 专注')
    },
    /** Wait for the overlay to mount (the red baseline times out here). */
    async waitOverlay({ timeout = 5_000 } = {}) {
      try {
        await page.waitForSelector('.fm-overlay', { state: 'attached', timeout })
        return true
      } catch {
        return false
      }
    },
    /** Wait until at least `min` user bubbles rendered inside the overlay. */
    async waitUserBubbles({ min = 1, timeout = 10_000 } = {}) {
      try {
        await waitFor(
          async () => (await page.locator('.fm-overlay .fm-user').count()) >= min,
          { timeout, interval: 200, label: `${min} overlay user bubble(s)` },
        )
        return true
      } catch {
        return false
      }
    },
    /**
     * Apply desktop window-frame markers on <html> AFTER boot (never before —
     * see docs notes) and read back the official layout variables.
     * @param {{platform?: 'darwin'|'win32'|null, fullscreen?: boolean}} frame
     */
    async applyFrame({ platform = null, fullscreen = false } = {}) {
      await page.evaluate(
        ({ platform, fullscreen }) => {
          const html = document.documentElement
          delete html.dataset.platform
          delete html.dataset.fullscreen
          html.removeAttribute('data-windows-titlebar')
          html.style.removeProperty('--dsh-windows-titlebar-height')
          if (platform === 'darwin') html.dataset.platform = 'darwin'
          if (platform === 'win32') {
            html.dataset.windowsTitlebar = ''
            html.style.setProperty('--dsh-windows-titlebar-height', '40px')
          }
          if (fullscreen) html.dataset.fullscreen = 'true'
        },
        { platform, fullscreen },
      )
      // Two frames + a turn: let the official layout CSS re-resolve the vars.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await sleep(250)
      return page.evaluate(readFrameState)
    },
    /** Remove every desktop marker (plain-browser baseline). */
    async clearFrame() {
      return this.applyFrame({ platform: null, fullscreen: false })
    },
    /** Snapshot of overlay geometry, the merged titlebar band and drag surface. */
    async measureOverlay() {
      return page.evaluate(readOverlayState)
    },
    /**
     * State of the official sidebar-collapse toggle: on the Windows desktop
     * renderer dsh-client-ui-sidebar promotes it to `position:fixed; z-index:30`
     * at x12,y6 — ABOVE the official shell.overlay layer (z-20) that hosts the
     * focus overlay. The plugin hides it while focus is on; this reads both the
     * computed style and the hit-testable rect.
     */
    async sidebarToggleState() {
      return page.evaluate(readSidebarToggleState)
    },
    /**
     * Resize the page viewport (e.g. the 520×600 Windows minimum window, where
     * the official layout auto-collapses the sidebar) and let layout settle.
     */
    async setViewport({ width, height }) {
      await page.setViewportSize({ width, height })
      await sleep(400)
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      return this.frameState()
    },
    /**
     * Windows titlebar-band state with the official sidebar COLLAPSED: the
     * sidebar-collapse toggle and the new-session button are both promoted to
     * `position:fixed; z-index:30` at x12/y6 and x48/y6 respectively — above
     * the official shell.overlay layer hosting the focus overlay — which is
     * exactly the second leak class the plugin's CSS hides while focus is on.
     * `hitTop` records what is hit-tested at each control's center so the test
     * can prove it is the interactive surface before focus.
     */
    async titlebarControlsState() {
      return page.evaluate(readTitlebarControls)
    },
    /**
     * Collapse the official sidebar via `[data-sidebar-toggle]` and wait until
     * the frame reports `data-sidebar-collapsed`. Idempotent.
     */
    async collapseSidebar() {
      let state = await this.titlebarControlsState()
      if (state.sidebarCollapsed) return state
      const toggle = page.locator('[data-sidebar-toggle]').first()
      if ((await toggle.count()) === 0) throw new Error('no [data-sidebar-toggle] to collapse the sidebar with')
      await toggle.click({ force: true })
      await waitFor(
        async () => (await this.titlebarControlsState()).sidebarCollapsed,
        { timeout: 5_000, interval: 200, label: 'sidebar collapsed (data-sidebar-collapsed)' },
      )
      state = await this.titlebarControlsState()
      return state
    },
    /**
     * Generic z-leak guard: every visible `position:fixed|sticky` element
     * outside `.fm-overlay` with a computed z-index >= 20 must NOT be
     * hit-tested above the overlay at its own center/corners. Skips
     * `[data-windows-menu]` (real-Electron-preload caption chrome that cannot
     * exist in the browser simulation) and Playwright-injected nodes.
     */
    async zLeakScan() {
      return page.evaluate(readZLeaks)
    },
    /**
     * Ordered window-drag hit test: the browser-side `probeDragRegions`
     * emulation of Electron's frameless-window region stack (see that
     * function's comment for the semantics and why the inherited
     * `window-drag` value has to be reconstructed here).
     * @param {{points?: Array<[number, number]>, bandTop?: number|null}} options
     */
    async dragRegionProbe({ points = [], bandTop = null } = {}) {
      return page.evaluate(probeDragRegions, { points, bandTop })
    },
    /**
     * Park the pointer in the middle of the viewport and let transient
     * official hover previews fade before a z-order scan. Automation leaves
     * the mouse over a sidebar row from earlier clicks, and those hover cards
     * are portaled above the overlay; they cannot be opened while focus is on
     * (the overlay captures the pointer), so a settled scan is the honest
     * steady state.
     */
    async movePointerToIdle() {
      await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2))
      await sleep(350)
    },
    /** Read only the <html> frame markers + official layout variables. */
    async frameState() {
      return page.evaluate(readFrameState)
    },
    /**
     * Exit focus through the keyboard, like a user. The overlay peels layers
     * one at a time (answer card → focused dock → exit), so up to 3 presses.
     * @returns {Promise<{exited: boolean, presses: number}>}
     */
    async exitOverlay() {
      for (let presses = 1; presses <= 3; presses++) {
        await page.keyboard.press('Escape')
        await sleep(450)
        const gone = await page.evaluate(() => !document.querySelector('.fm-overlay'))
        if (gone) return { exited: true, presses }
      }
      return { exited: false, presses: 3 }
    },
    async screenshot(name) {
      ensureOutDir()
      const path = join(OUT_DIR, name)
      await page.screenshot({ path, fullPage: false }).catch(() => {})
      return path
    },
    async close() {
      await context.close().catch(() => {})
      await browser.close().catch(() => {})
    },
  }

  await sim.dismissPreviewNotice()
  return sim
}

// ---- in-page readers (serialized as plain functions) ----

function readFrameState() {
  const html = document.documentElement
  const cs = getComputedStyle(html)
  const read = (name) => cs.getPropertyValue(name).trim()
  return {
    dataset: {
      platform: html.dataset.platform ?? null,
      windowsTitlebar: html.hasAttribute('data-windows-titlebar'),
      fullscreen: html.dataset.fullscreen ?? null,
    },
    styleAttr: html.getAttribute('style') || '',
    vars: {
      '--dsh-frame-top-clearance': read('--dsh-frame-top-clearance'),
      '--dsh-frame-overlay-top': read('--dsh-frame-overlay-top'),
      '--dsh-frame-chrome-top': read('--dsh-frame-chrome-top'),
      '--dsh-windows-titlebar-height': read('--dsh-windows-titlebar-height'),
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }
}

function readOverlayState() {
  const rectOf = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }
  const regionOf = (el) => {
    if (!el) return ''
    const cs = getComputedStyle(el)
    return (cs.getPropertyValue('-webkit-app-region') || cs.getPropertyValue('app-region') || '').trim()
  }
  const html = document.documentElement
  const htmlCs = getComputedStyle(html)
  const cssVar = (name) => htmlCs.getPropertyValue(name).trim()
  const overlays = [...document.querySelectorAll('.fm-overlay')]
  const overlay = overlays[0] || null
  const overlayCs = overlay ? getComputedStyle(overlay) : null
  const topbar = overlay ? overlay.querySelector('.fm-topbar') : null
  const topbarCs = topbar ? getComputedStyle(topbar) : null
  const title = topbar ? topbar.querySelector('.fm-title') : null
  const body = overlay ? overlay.querySelector('.fm-body') : null
  const inner = overlay ? overlay.querySelector('.fm-inner') : null
  const firstContent = inner ? inner.firstElementChild : null
  // The overlay's drag surface is the child that explicitly claims the
  // native-titlebar band: the merged titlebar row on macOS
  // (`.fm-topbar[data-window-drag]` with a drag app-region) or the separate
  // `.fm-frame-strip` on Windows, whichever is rendered with `drag`.
  const surface = overlay
    ? [...overlay.children]
        .filter((el) => el.hasAttribute('data-window-drag'))
        .filter((el) => {
          const cs = getComputedStyle(el)
          if (cs.display === 'none') return false
          return (cs.getPropertyValue('-webkit-app-region') || cs.getPropertyValue('app-region') || '').trim() === 'drag'
        })
        .pop() || null
    : null
  const stripCandidate = overlay ? overlay.querySelector('.fm-frame-strip') : null
  const exitButton =
    (overlay &&
      [...overlay.querySelectorAll('button')].find((button) => /退出专注|Exit focus/i.test(button.textContent || ''))) ||
    null
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    html: {
      platform: html.dataset.platform ?? null,
      windowsTitlebar: html.hasAttribute('data-windows-titlebar'),
      fullscreen: html.dataset.fullscreen ?? null,
    },
    frameVars: {
      '--dsh-frame-top-clearance': cssVar('--dsh-frame-top-clearance'),
      '--dsh-frame-overlay-top': cssVar('--dsh-frame-overlay-top'),
      '--dsh-frame-chrome-top': cssVar('--dsh-frame-chrome-top'),
      '--dsh-windows-titlebar-height': cssVar('--dsh-windows-titlebar-height'),
    },
    overlayCount: overlays.length,
    overlay: overlay
      ? {
          rect: rectOf(overlay),
          paddingTop: overlayCs.paddingTop,
          frameBandVar: overlayCs.getPropertyValue('--fm-frame-band').trim(),
          position: overlayCs.position,
          zIndex: overlayCs.zIndex,
        }
      : null,
    topbar: topbar
      ? {
          rect: rectOf(topbar),
          position: topbarCs.position,
          heightPx: Number.parseFloat(topbarCs.height) || 0,
          appRegion: regionOf(topbar),
          dataWindowDrag: topbar.hasAttribute('data-window-drag'),
          childIndex: overlay ? [...overlay.children].indexOf(topbar) : -1,
          isLastChild: Boolean(overlay && overlay.lastElementChild === topbar),
          title: title
            ? {
                rect: rectOf(title),
                text: (title.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
              }
            : null,
          // Interactive controls that live INSIDE the drag band must be
          // excluded from it explicitly (otherwise a click would drag).
          controlCount: [...topbar.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]')].length,
          controlRegions: [...topbar.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]')].map((el) => ({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
            appRegion: regionOf(el),
          })),
        }
      : null,
    body: body
      ? {
          rect: rectOf(body),
          paddingTop: getComputedStyle(body).paddingTop,
          scrollTop: body.scrollTop,
          scrollHeight: body.scrollHeight,
          // Where the first rendered content row actually starts: the band is
          // only "reclaimed" if the transcript follows the band immediately.
          firstContentTop: firstContent ? rectOf(firstContent).top : null,
        }
      : null,
    exit: exitButton
      ? {
          rect: rectOf(exitButton),
          text: (exitButton.textContent || '').replace(/\s+/g, ' ').trim(),
        }
      : null,
    dragSurface: surface
      ? {
          tag: surface.tagName.toLowerCase(),
          cls: String(surface.className || ''),
          isTopbar: surface === topbar,
          appRegion: regionOf(surface),
          childIndex: overlay ? [...overlay.children].indexOf(surface) : -1,
          isLastChild: Boolean(overlay && overlay.lastElementChild === surface),
          heightPx: Number.parseFloat(getComputedStyle(surface).height) || 0,
        }
      : null,
    // Windows-only band drag strip (display:none on macOS / plain web, where
    // the merged title row is the drag surface).
    frameStrip: stripCandidate
      ? {
          displayed: getComputedStyle(stripCandidate).display !== 'none',
          display: getComputedStyle(stripCandidate).display,
          rect: rectOf(stripCandidate),
          appRegion: regionOf(stripCandidate),
          isLastChild: Boolean(overlay && overlay.lastElementChild === stripCandidate),
          childIndex: overlay ? [...overlay.children].indexOf(stripCandidate) : -1,
        }
      : null,
    userBubbleCount: document.querySelectorAll('.fm-overlay .fm-user').length,
  }
}

function readSidebarToggleState() {
  const rectOf = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, top: r.top, left: r.left, width: r.width, height: r.height }
  }
  const overlays = [...document.querySelectorAll('.fm-overlay')]
  const items = [...document.querySelectorAll('[data-sidebar-toggle]')].map((el) => {
    const cs = getComputedStyle(el)
    const rect = rectOf(el)
    return {
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      position: cs.position,
      zIndex: cs.zIndex,
      rect,
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && Number.parseFloat(cs.opacity) !== 0 && rect.width > 0 && rect.height > 0,
      insideOverlay: overlays.some((overlay) => overlay.contains(el)),
    }
  })
  return {
    count: items.length,
    items,
    allHidden: items.length > 0 && items.every((item) => !item.visible),
    bodyFocus: document.body.hasAttribute('data-fm-focus'),
    overlayOpen: overlays.length > 0,
  }
}

function readTitlebarControls() {
  const stateOf = (el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const cx = Math.min(Math.max(r.x + r.width / 2, 0), window.innerWidth - 1)
    const cy = Math.min(Math.max(r.y + r.height / 2, 0), window.innerHeight - 1)
    const hitTop = r.width > 0 && r.height > 0
      ? document.elementsFromPoint(cx, cy).slice(0, 3).map((node) => `${node.tagName.toLowerCase()}.${String(node.className || '').split(' ')[0] || '(no-class)'}`)
      : []
    return {
      cls: String(el.className || '').slice(0, 70),
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      position: cs.position,
      zIndex: cs.zIndex,
      top: cs.top,
      left: cs.left,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && Number.parseFloat(cs.opacity) !== 0 && r.width > 0 && r.height > 0,
      hitTop,
    }
  }
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    // The official layout frame carries the collapsed marker; class names are
    // per-build hashes, the data attribute is stable.
    sidebarCollapsed: Boolean(document.querySelector('[data-sidebar-collapsed]')),
    toggle: [...document.querySelectorAll('[data-sidebar-toggle]')].map(stateOf),
    // Restrict to <button> so the label-mask/content children don't count.
    newSession: [...document.querySelectorAll('button[class*="newSession"]')].map(stateOf),
    bodyFocus: document.body.hasAttribute('data-fm-focus'),
    overlayOpen: Boolean(document.querySelector('.fm-overlay')),
  }
}

function readZLeaks() {
  const overlay = document.querySelector('.fm-overlay')
  const isPlaywrightNode = (el) => {
    const id = el.id || ''
    const cls = typeof el.className === 'string' ? el.className : ''
    return /playwright|__pw/i.test(id) || /playwright|__pw/i.test(cls) || el.hasAttribute?.('data-playwright')
  }
  const skip = (el) => {
    if (el.closest('[data-windows-menu]')) return true
    // Plugin-owned lift host: the overlay deliberately lifts the official
    // composer above itself (`fm-lift`, z just above .fm-overlay) — that is the
    // plugin's own chrome, not an official z-leak. Also covers its children
    // (slash/@ menu portals live inside the lifted seat).
    if (el.closest('.fm-lift')) return true
    const tag = el.tagName.toLowerCase()
    return isPlaywrightNode(el) || tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta' || tag === 'template' || tag === 'noscript'
  }
  const isVisible = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number.parseFloat(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  if (!overlay) return { overlayOpen: false, candidates: [], leaks: [], bodyFocus: document.body.hasAttribute('data-fm-focus') }

  const candidates = []
  const leaks = []
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (el === overlay || overlay.contains(el) || el.contains(overlay)) continue
    if (skip(el)) continue
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue
    const z = Number.parseInt(cs.zIndex, 10)
    if (!Number.isFinite(z) || z < 20) continue
    if (!isVisible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) continue
    const candidate = {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 70),
      id: el.id || '',
      zIndex: z,
      position: cs.position,
      pointerEvents: cs.pointerEvents,
      rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
    }
    candidates.push(candidate)
    // Hit-test the candidate's own area: if it (or its subtree/ancestor chain)
    // appears above the overlay in the paint stack, it floats over focus mode.
    const points = [[r.x + r.width / 2, r.y + r.height / 2]]
    if (r.width > 24 || r.height > 24) {
      points.push([r.x + 3, r.y + 3], [r.x + r.width - 3, r.y + 3], [r.x + 3, r.y + r.height - 3], [r.x + r.width - 3, r.y + r.height - 3])
    }
    for (const [rawX, rawY] of points) {
      const x = Math.min(Math.max(rawX, 0), window.innerWidth - 1)
      const y = Math.min(Math.max(rawY, 0), window.innerHeight - 1)
      const stack = document.elementsFromPoint(x, y)
      const overlayIndex = stack.indexOf(overlay)
      if (overlayIndex <= 0) continue
      const above = stack.slice(0, overlayIndex).filter((node) => !overlay.contains(node) && !skip(node))
      if (above.length === 0) continue
      if (above.some((node) => node === el || el.contains(node) || node.contains(el))) {
        leaks.push({
          ...candidate,
          point: { x: Math.round(x), y: Math.round(y) },
          above: above.slice(0, 4).map((node) => `${node.tagName.toLowerCase()}.${String(node.className || '').split(' ')[0] || '(no-class)'}`),
        })
        break
      }
    }
  }
  return { overlayOpen: true, candidates, leaks, bodyFocus: document.body.hasAttribute('data-fm-focus') }
}

/**
 * Ordered window-drag hit test — Electron's frameless-window region stack,
 * emulated inside the page from the renderer DOM.
 *
 * Why: the desktop shell does not use the browser's hit test for the window
 * drag surface. It takes the renderer's ordered list of CSS app-region rects
 * and applies them in order — `drag` adds area, `no-drag` subtracts it, and the
 * LATER rect wins where two overlap (electron `shell/browser/ui/drag_util.cc`
 * `DraggableRegionsToSkRegion`; renderer order is Blink
 * `LocalFrameView::CollectDraggableRegions` pre-order ≈ DOM order, parents
 * before children). Rects are laid-out boxes and are NOT clipped by ancestor
 * overflow, so a scrolled child keeps its full box, including negative-y
 * coordinates above its clip container. That is exactly how the focus
 * overlay's reserved titlebar band got cancelled on sessions with content:
 * no-drag rects (`.fm-rail-slot`, the scrolled `.fm-inner` subtree) covered the
 * band after the drag surface. The surface is the last overlay child carrying
 * `data-window-drag` — since the merged-titlebar redesign that is the
 * `.fm-topbar` row itself (0.13.x used a separate `.fm-frame-strip`).
 *
 * Inherited property: on the 0.2.2 desktop runtime (Electron 44.7 / Chrome
 * 152) this is the standardised, inherited `window-drag` property (`move` /
 * `none`), so every descendant of the overlay root — which the official
 * darwin CSS marks no-drag because it has `tabindex=-1` — is itself a no-drag
 * rect unless it opts into drag. The Playwright Chromium used by the e2e
 * harness is older (151): it only
 * knows the legacy, NON-inherited `-webkit-app-region`/`app-region`, and a
 * child of a drag/no-drag element computes `none` (verified; `CSS.supports
 * ('window-drag','move')` is false). This helper therefore reconstructs the
 * inherited value by walking the DOM in pre-order, passing the parent's
 * effective region down until an element declares its own — the same rect list
 * the desktop renderer builds. Limitation: an element whose only declaration
 * is `app-region: none/initial` also computes `none` in Chromium 151 and is
 * treated as inheriting; the probed overlay subtree contains no such
 * declaration.
 *
 * Hit test: for each probe point the LAST collected rect that contains it wins
 * (half-open boxes, like gfx::Rect::Contains). Points are [x, y] pairs in CSS
 * px, viewport coordinates.
 *
 * @param {{points?: Array<[number, number]>, bandTop?: number|null}} options
 * @returns {{
 *   viewport: {width: number, height: number},
 *   nativeInheritance: boolean,
 *   regionCount: number,
 *   probes: Array<{point: {x: number, y: number}, draggable: boolean, winner: object|null}>,
 *   surface: object|null,
 *   overlay: object|null,
 *   band: object|null,
 * }}
 */
export function probeDragRegions({ points = [], bandTop = null } = {}) {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  // Chromium 152+ implements the standardized inherited `window-drag`
  // property; older Chromium (the one Playwright ships here) does not.
  const nativeInheritance =
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('window-drag', 'move')
  const round = (value) => Math.round(value * 100) / 100
  const readRegion = (style) => {
    const legacy = (style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region') || '').trim()
    if (legacy === 'drag' || legacy === 'no-drag') return legacy
    const standardized = (style.getPropertyValue('window-drag') || '').trim()
    if (standardized === 'move') return 'drag'
    if (standardized === 'none') return 'no-drag'
    return ''
  }
  const describe = (element, region, inherited, rect) => {
    let cls = ''
    try {
      cls = typeof element.className === 'string' ? element.className : element.getAttribute('class') || ''
    } catch {
      cls = ''
    }
    return {
      tag: element.tagName.toLowerCase(),
      cls: cls.slice(0, 120),
      role: element.getAttribute('role'),
      tabindex: element.getAttribute('tabindex'),
      dataWindowDrag: element.hasAttribute('data-window-drag'),
      region,
      inherited,
      rect,
    }
  }

  // Document pre-order = the renderer's layout-tree order for these boxes.
  const regions = []
  // Parallel array: the element each region was collected from. Needed to tell
  // "no-drag rect AFTER the drag surface" (ordering bug) apart from "no-drag
  // rect of a control INSIDE the surface" (the exit button, by design).
  const regionElements = []
  const walk = (element, inheritedRegion) => {
    const style = getComputedStyle(element)
    const own = readRegion(style)
    const region = own || inheritedRegion
    const display = style.display
    const visible =
      style.visibility === 'visible' && display !== 'none' && display !== 'inline' && display !== 'contents'
    if (visible && (region === 'drag' || region === 'no-drag')) {
      const box = element.getBoundingClientRect()
      if (box.width > 0 && box.height > 0) {
        regions.push({
          index: regions.length,
          ...describe(element, region, own === '', {
            x: round(box.x),
            y: round(box.y),
            width: round(box.width),
            height: round(box.height),
            left: round(box.left),
            top: round(box.top),
            right: round(box.right),
            bottom: round(box.bottom),
          }),
        })
        regionElements.push(element)
      }
    }
    for (const child of element.children) walk(child, region)
  }
  walk(document.documentElement, '')

  const winnerAt = (x, y) => {
    let winner = null
    for (const region of regions) {
      const box = region.rect
      if (x >= box.left && x < box.right && y >= box.top && y < box.bottom) winner = region
    }
    return winner
  }
  const probes = points.map(([x, y]) => {
    const winner = winnerAt(x, y)
    return {
      point: { x: Math.round(x), y: Math.round(y) },
      draggable: Boolean(winner && winner.region === 'drag'),
      winner,
    }
  })

  const overlay = document.querySelector('.fm-overlay')
  // The drag surface = the overlay's last rendered child that explicitly claims
  // the band with a drag region: the merged title row on macOS, the separate
  // `.fm-frame-strip` on Windows.
  const surface = overlay
    ? [...overlay.children].filter((element) => {
        if (!element.hasAttribute('data-window-drag')) return false
        const style = getComputedStyle(element)
        if (style.display === 'none') return false
        return readRegion(style) === 'drag'
      }).pop() || null
    : null
  const surfaceRegionIndex = surface ? regionElements.indexOf(surface) : -1
  const surfaceRegion = surfaceRegionIndex >= 0 ? regions[surfaceRegionIndex] : null

  // Band diagnostics make the assertion non-vacuous: they count the no-drag
  // rects that overlap the reserved titlebar band and come BEFORE the surface in
  // the ordered list. The contract is precisely that none come after it except
  // the surface's own interactive controls (which must stay clickable).
  let band = null
  if (Number.isFinite(bandTop) && bandTop > 0) {
    const overlapsBand = (box) =>
      box.right > 0 && box.left < viewport.width && box.top < bandTop && box.bottom > 0
    const noDrag = regions.filter((region) => region.region === 'no-drag' && overlapsBand(region.rect))
    const isInsideSurface = (region) => Boolean(surface && surface.contains(regionElements[region.index]))
    const before = noDrag.filter((region) => region.index < surfaceRegionIndex)
    const after = noDrag.filter((region) => region.index > surfaceRegionIndex && !isInsideSurface(region))
    const surfaceControls = noDrag.filter((region) => region.index > surfaceRegionIndex && isInsideSurface(region))
    const summarize = (region) => ({
      tag: region.tag,
      cls: region.cls,
      role: region.role,
      inherited: region.inherited,
      rect: region.rect,
    })
    band = {
      top: bandTop,
      noDragOverlapping: noDrag.length,
      noDragBeforeSurface: before.length,
      noDragAfterSurface: after.length,
      surfaceControlNoDrag: surfaceControls.length,
      // Laid-out boxes above the band's bottom edge: scrolled content keeps
      // negative-y rects (`.fm-inner`, `.fm-msg`, ...) once `.fm-body` scrolls.
      scrolled: noDrag.filter((region) => region.rect.top < 0 || region.rect.bottom <= 0).length,
      // The pre-fix culprits by class (rail wrapper / scrolled transcript).
      culprits: noDrag.filter((region) => /(fm-inner|fm-msg|fm-rail)/.test(region.cls)).slice(0, 8).map(summarize),
      before: before.slice(0, 8).map(summarize),
      after: after.slice(0, 8).map(summarize),
    }
  }

  return {
    viewport,
    nativeInheritance,
    regionCount: regions.length,
    probes,
    surface: surface
      ? {
          tag: surface.tagName.toLowerCase(),
          cls: String(surface.className || ''),
          // First/last region indices this element contributed to the ordered
          // list; the band contract is "no no-drag rect after the surface".
          isTopbar: Boolean(surface.classList.contains('fm-topbar')),
          region: surfaceRegion ? surfaceRegion.region : readRegion(getComputedStyle(surface)),
          inherited: surfaceRegion ? surfaceRegion.inherited : null,
          index: surfaceRegionIndex >= 0 ? surfaceRegionIndex : null,
          rect: surfaceRegion ? surfaceRegion.rect : null,
          childIndex: overlay ? [...overlay.children].indexOf(surface) : null,
          isLastChild: Boolean(overlay && overlay.lastElementChild === surface),
          dataWindowDrag: surface.hasAttribute('data-window-drag'),
        }
      : null,
    overlay: overlay
      ? {
          childCount: overlay.children.length,
          lastChildClass: overlay.lastElementChild ? String(overlay.lastElementChild.className || '') : null,
          surfaceIsLastChild: Boolean(surface && overlay.lastElementChild === surface),
          frameStripLastChild: Boolean(overlay.querySelector('.fm-frame-strip') && overlay.lastElementChild === overlay.querySelector('.fm-frame-strip')),
        }
      : null,
    band,
  }
}

/** Axis-aligned rectangle intersection test (touching edges do not count). */
export function intersects(a, b) {
  if (!a || !b) return false
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}
