#!/usr/bin/env node
/**
 * Desktop window-frame regression matrix for dsh-focus-overlay on
 * DSH desktop 0.2.2-rc.1 (macOS + Windows renderer contract).
 *
 * The desktop shell paints a hidden native titlebar as web content and marks
 * `<html>`: `data-platform="darwin"` (macOS traffic lights at x16,y18,
 * ~60.7×14), `data-windows-titlebar` + `--dsh-windows-titlebar-height:40px`
 * (Windows native caption zone top-right), and `data-fullscreen` on both.
 * The official layout turns those into `--dsh-frame-top-clearance` (48 / 40)
 * and `--dsh-frame-overlay-top` (clearance + 20px, i.e. 68 / 60, 20 fullscreen).
 * The focus overlay must reserve that strip and keep the window draggable
 * without putting anything focusable under the traffic lights / caption
 * buttons, while the plain web generation must stay pixel-identical.
 *
 * This script asserts that contract for:
 *   plain web      — overlay mounts, user bubbles render, topbar at y≈0,
 *                    strip collapsed to 0, Esc exits;
 *   darwin         — topbar ≥48 (expected 68), strip 0→68 at y=0,
 *                    aria-hidden, data-window-drag, NO tabindex (a tabindex
 *                    would match the official `[tabindex]{-webkit-app-region:
 *                    no-drag}` rule and silently kill the drag band),
 *                    0 focusables, computed app-region "drag";
 *   win32          — topbar ≥40 (expected 60), strip 60, exit clear of the
 *                    top-right caption zone {x ≥ vw-138, y < 40};
 *   darwin/win32 + fullscreen — topbar ≈20 (16..32), no stale 48/40 clearance.
 * Esc must exit in every mode.
 *
 * Windows z-leak follow-up (0.2.2 desktop renderer): dsh-client-ui-sidebar
 * promotes its collapse toggle (`[data-sidebar-toggle]`) to `position:fixed;
 * z-index:30` at x12,y6 under `html[data-windows-titlebar]` — above the
 * official `shell.overlay` layer (z-20) that hosts this overlay — so it used
 * to float over focus mode and steal clicks from the drag strip. The plugin
 * now hides it only while focus is on. Asserted here: hidden while the
 * overlay is open, visible again after Esc, and no other official
 * fixed/sticky element with z-index >= 20 is hit-tested above the overlay
 * (center + corners; `[data-windows-menu]` and Playwright-injected nodes are
 * skipped — those cannot exist in the browser simulation).
 *
 * Windows collapsed-sidebar regression (second titlebar leak): with the
 * official sidebar collapsed — user-collapsed at any width, or any window
 * narrower than 768px — dsh-client-ui-sidebar pins BOTH the collapse toggle
 * (x12,y6) and the new-session button (x48,y6) to position:fixed; z-index:30
 * in the titlebar band, above the shell.overlay layer hosting this overlay.
 * The plugin hides both while focus is on. Asserted at 1280×820 (user
 * collapse) and at the 520×600 Windows minimum window (collapse at 1280
 * first, then resize): both controls visible and hit-testable in the band
 * off-focus, hidden + 0 z-leaks in focus, visible again after Esc.
 *
 * Usage:
 *   # spawn its own isolated desktop-runtime instance on :3098
 *   DSH_HOME=/tmp/dsh-home-verify DSH_PORT=3098 node tests/e2e/desktop-frame.mjs
 *   # or attach to a running instance (URL may carry ?token=…)
 *   DSH_GUI_ORIGIN='http://127.0.0.1:3098/?token=…' node tests/e2e/desktop-frame.mjs
 *
 * Preparation (see docs/desktop-dsh-0.2.2-notes.md):
 *   - `npm run build` (the isolated profile links this checkout; a running
 *     server won't pick up a rebuilt client bundle — restart it);
 *   - isolated home cloned from the seeded one, e.g.
 *     `cp -a -c /tmp/dsh-home-test/. /tmp/dsh-home-verify/`;
 *   - profile `fmtest` has the plugin installed via `dsh plugin add link:…`.
 * Screenshots + JSON report land in tests/e2e/out/ (gitignored).
 *
 * Known red baseline (pre-adaptation plugin on 0.2.2-rc.1): the overlay never
 * mounts in ANY mode — clicking the header 专注 logs
 *   [dsh-focus-overlay] overlay render failed; it will retry on the next open
 *   TypeError: (0 , _deepseek_ai_dsh_client_ui_primitives.projectUserText) is not a function
 * and this script then fails the `overlay mounts` check per mode (frame
 * assertions become dependent failures; Esc is reported as skipped because
 * there is no overlay to dismiss).
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureGui, ensureOutDir, intersects, launchSim } from './lib/desktop-sim.mjs'

const approx = (value, expected, tolerance = 1) => Math.abs(value - expected) <= tolerance
const px = (value) => (Number.isFinite(value) ? `${Number(value.toFixed(2))}px` : String(value))

const counts = { pass: 0, fail: 0, skip: 0 }
const failures = []
const skips = []
const matrix = []

function check(mode, label, ok, detail = '') {
  if (ok) {
    counts.pass++
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    counts.fail++
    const line = `[${mode}] ${label}${detail ? ` — ${detail}` : ''}`
    failures.push(line)
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function skip(mode, label, reason) {
  counts.skip++
  skips.push(`[${mode}] ${label} (${reason})`)
  console.log(`  – ${label} — skipped: ${reason}`)
}

/** Assert the strip is a real drag band. Chromium normally exposes
 *  `-webkit-app-region` via getComputedStyle; if a headless build returns
 *  empty, fall back to the attribute + height contract. */
function checkDragRegion(mode, strip, minHeight) {
  if (!strip) {
    check(mode, 'frame strip exists', false, 'no .fm-frame-strip element')
    return
  }
  if (strip.appRegion) {
    check(mode, 'frame strip is a drag region (computed -webkit-app-region)', strip.appRegion === 'drag', `app-region=${strip.appRegion}`)
  } else {
    check(
      mode,
      'frame strip is a drag region (fallback: data-window-drag + height; computed app-region empty in this Chromium)',
      strip.dataWindowDrag && strip.heightPx >= minHeight,
      `data-window-drag=${strip.dataWindowDrag}, h=${px(strip.heightPx)}`,
    )
  }
}

function checkStripCommon(mode, strip, viewportWidth) {
  check(mode, 'frame strip exists', Boolean(strip))
  if (!strip) return
  check(mode, 'frame strip spans the viewport at y=0', strip.rect.top <= 1 && strip.widthPx >= viewportWidth - 1, `top=${px(strip.rect.top)}, width=${px(strip.widthPx)}`)
  check(mode, 'frame strip is aria-hidden', strip.ariaHidden === 'true', `aria-hidden=${strip.ariaHidden}`)
  check(mode, 'frame strip carries data-window-drag', strip.dataWindowDrag)
  // On darwin, the official rule `html[data-platform=darwin] :is(…,[tabindex],…) {-webkit-app-region:no-drag}`
  // matches any [tabindex] element and would silently disable dragging.
  check(mode, 'frame strip has NO tabindex attribute', strip.tabIndexAttr === null, `tabindex=${strip.tabIndexAttr}`)
  check(mode, 'frame strip contains no focusable elements', strip.focusableCount === 0, `${strip.focusableCount} focusable(s)${strip.focusableTags.length ? `: ${strip.focusableTags.join(',')}` : ''}`)
}

const gui = await ensureGui()
console.log(`GUI: ${gui.origin} (${gui.mode})`)
ensureOutDir()
const report = { startedAt: new Date().toISOString(), origin: gui.origin, mode: gui.mode, runs: [], failures, skips }

let sim
try {
  sim = await launchSim({ origin: gui.origin, log: console.log })
  console.log('booted; opening a stored session with history…')
  const session = await sim.openSessionWithHistory()
  console.log(`session: “${session.title}”`)

  /** Open the overlay under a set of frame markers and snapshot it. */
  async function openAndMeasure(mode, frame) {
    await sim.applyFrame(frame)
    await sim.clickFocus()
    const mounted = await sim.waitOverlay({ timeout: 6_000 })
    let bubbles = false
    if (mounted) bubbles = await sim.waitUserBubbles({ min: 1, timeout: 10_000 })
    const measurement = await sim.measureOverlay()
    await sim.movePointerToIdle()
    const zLeaks = await sim.zLeakScan()
    const toggle = await sim.sidebarToggleState()
    const screenshot = await sim.screenshot(`desktop-frame-${mode}.png`)
    const diagnostics = sim.diagnostics()
    const run = { mode, frame, mounted, bubbles, screenshot, measurement, zLeaks, toggle, diagnostics }
    report.runs.push(run)
    return run
  }

  // ── 1. plain browser baseline (no desktop markers) ──────────────────────
  {
    const mode = 'plain'
    console.log(`\n── ${mode} (no desktop markers) ──`)
    const run = await openAndMeasure(mode, { platform: null, fullscreen: false })
    const m = run.measurement
    const topbarTop = m.topbar ? m.topbar.rect.top : NaN
    const stripH = m.strip ? m.strip.heightPx : NaN
    matrix.push({ mode, mounted: run.mounted, bubbles: m.userBubbleCount, topbarTop, stripH, esc: '' })

    check(mode, 'overlay mounts', run.mounted)
    check(mode, 'renders ≥1 user bubble', m.userBubbleCount >= 1, `${m.userBubbleCount}`)
    check(mode, 'single overlay instance', m.overlayCount === 1, `${m.overlayCount}`)
    check(mode, 'topbar sits at the viewport top (no frame padding)', Number.isFinite(topbarTop) && topbarTop >= -1 && topbarTop <= 1, `topbar.top=${px(topbarTop)}`)
    check(mode, 'overlay reserves no frame padding', m.overlay && Number.parseFloat(m.overlay.paddingTop) === 0, m.overlay ? `padding-top=${m.overlay.paddingTop}` : 'no overlay')
    check(mode, 'desktop frame variables are undefined', m.frameVars['--dsh-frame-overlay-top'] === '' && m.frameVars['--dsh-windows-titlebar-height'] === '', `overlay-top=${JSON.stringify(m.frameVars['--dsh-frame-overlay-top'])}, win-height=${JSON.stringify(m.frameVars['--dsh-windows-titlebar-height'])}`)
    check(mode, 'frame strip collapses to 0 height', m.strip && m.strip.heightPx === 0, m.strip ? `h=${px(stripH)}` : 'no strip')
    console.log(`  ℹ z-leak scan: ${run.zLeaks.leaks.length} leak(s), ${run.zLeaks.candidates.length} fixed/sticky z≥20 candidate(s) (not asserted in plain mode)`)

    const esc = run.mounted ? await sim.exitOverlay() : { exited: false, presses: 0 }
    if (run.mounted) {
      check(mode, 'Esc exits the overlay', esc.exited, `${esc.presses} press(es)`)
      matrix[matrix.length - 1].esc = esc.exited ? `✓ (${esc.presses})` : '✗'
    } else {
      skip(mode, 'Esc exits the overlay', 'overlay never mounted')
    }
  }

  // ── 2. macOS window frame ──────────────────────────────────────────────
  {
    const mode = 'darwin'
    console.log(`\n── ${mode} (data-platform=darwin) ──`)
    const run = await openAndMeasure(mode, { platform: 'darwin', fullscreen: false })
    const m = run.measurement
    const topbarTop = m.topbar ? m.topbar.rect.top : NaN
    const strip = m.strip
    matrix.push({ mode, mounted: run.mounted, bubbles: m.userBubbleCount, topbarTop, stripH: strip ? strip.heightPx : NaN, esc: '' })

    check(mode, 'overlay mounts', run.mounted)
    check(mode, 'renders ≥1 user bubble', m.userBubbleCount >= 1, `${m.userBubbleCount}`)
    check(mode, 'html carries data-platform=darwin', m.html.platform === 'darwin')
    check(mode, 'official --dsh-frame-top-clearance resolves to 48px', m.frameVars['--dsh-frame-top-clearance'] === '48px', m.frameVars['--dsh-frame-top-clearance'])
    check(mode, 'topbar clears the traffic lights (top ≥ 48)', Number.isFinite(topbarTop) && topbarTop >= 48, `topbar.top=${px(topbarTop)}`)
    check(mode, 'topbar reserves 48px clearance + 20px gap (≈68px)', approx(topbarTop, 68), `topbar.top=${px(topbarTop)}`)
    {
      // Native traffic lights: x 16..77 (≈60.7 wide), y 18..32.
      const trafficLights = { x: 16, y: 18, width: 61, height: 14 }
      const exitRect = m.exit ? m.exit.rect : null
      check(
        mode,
        'exit button does not intersect the traffic-light box (x16..77, y18..32)',
        exitRect ? !intersects(exitRect, trafficLights) : false,
        exitRect
          ? `exit=${JSON.stringify({ x: Math.round(exitRect.x), y: Math.round(exitRect.y), w: Math.round(exitRect.width), h: Math.round(exitRect.height) })}`
          : 'no exit button found in the overlay',
      )
    }
    checkStripCommon(mode, strip, m.viewport.width)
    if (strip) {
      check(mode, 'frame strip height ≥ 48 (expected 68)', strip.heightPx >= 48, `h=${px(strip.heightPx)}`)
      check(mode, 'frame strip height is 68px (48 clearance + 20 gap)', approx(strip.heightPx, 68), `h=${px(strip.heightPx)}`)
      checkDragRegion(mode, strip, 48)
    } else {
      checkDragRegion(mode, null, 48)
    }
    check(
      mode,
      'no official fixed/sticky z≥20 element paints above the overlay',
      run.zLeaks.leaks.length === 0,
      run.zLeaks.leaks.length
        ? `leaks: ${run.zLeaks.leaks.map((leak) => `${leak.tag}.${leak.cls}(z=${leak.zIndex})@${leak.point.x},${leak.point.y}`).join('; ')}`
        : `${run.zLeaks.candidates.length} candidate(s) scanned, 0 leaks`,
    )

    const esc = run.mounted ? await sim.exitOverlay() : { exited: false, presses: 0 }
    if (run.mounted) {
      check(mode, 'Esc exits the overlay', esc.exited, `${esc.presses} press(es)`)
      matrix[matrix.length - 1].esc = esc.exited ? `✓ (${esc.presses})` : '✗'
    } else {
      skip(mode, 'Esc exits the overlay', 'overlay never mounted')
    }
  }

  // ── 3. macOS fullscreen ────────────────────────────────────────────────
  {
    const mode = 'darwin+fullscreen'
    console.log(`\n── ${mode} (data-platform=darwin + data-fullscreen) ──`)
    const run = await openAndMeasure(mode, { platform: 'darwin', fullscreen: true })
    const m = run.measurement
    const topbarTop = m.topbar ? m.topbar.rect.top : NaN
    const strip = m.strip
    matrix.push({ mode, mounted: run.mounted, bubbles: m.userBubbleCount, topbarTop, stripH: strip ? strip.heightPx : NaN, esc: '' })

    check(mode, 'overlay mounts', run.mounted)
    check(mode, 'renders ≥1 user bubble', m.userBubbleCount >= 1, `${m.userBubbleCount}`)
    check(mode, 'html carries data-platform=darwin + data-fullscreen', m.html.platform === 'darwin' && m.html.fullscreen === 'true')
    check(mode, 'topbar top ≈20px (16..32)', Number.isFinite(topbarTop) && topbarTop >= 16 && topbarTop <= 32, `topbar.top=${px(topbarTop)}`)
    check(mode, 'no 48px clearance remains', m.overlay && Number.parseFloat(m.overlay.paddingTop) <= 32, m.overlay ? `padding-top=${m.overlay.paddingTop}` : 'no overlay')
    check(mode, 'overlay reserves exactly the 20px fullscreen gap', m.overlay && approx(Number.parseFloat(m.overlay.paddingTop), 20), m.overlay ? `padding-top=${m.overlay.paddingTop}` : 'no overlay')
    if (strip) {
      check(mode, 'frame strip collapses to the 20px fullscreen gap', approx(strip.heightPx, 20), `h=${px(strip.heightPx)}`)
      check(mode, 'frame strip is still a drag region', strip.appRegion === 'drag' || strip.dataWindowDrag, strip.appRegion ? `app-region=${strip.appRegion}` : 'data-window-drag fallback')
    } else {
      skip(mode, 'frame strip geometry', 'no strip element in fullscreen (acceptable if drag band is not needed)')
    }
    console.log(`  ℹ z-leak scan: ${run.zLeaks.leaks.length} leak(s), ${run.zLeaks.candidates.length} candidate(s) (informational in fullscreen)`)

    const esc = run.mounted ? await sim.exitOverlay() : { exited: false, presses: 0 }
    if (run.mounted) {
      check(mode, 'Esc exits the overlay', esc.exited, `${esc.presses} press(es)`)
      matrix[matrix.length - 1].esc = esc.exited ? `✓ (${esc.presses})` : '✗'
    } else {
      skip(mode, 'Esc exits the overlay', 'overlay never mounted')
    }
  }

  // ── 4. Windows window frame ────────────────────────────────────────────
  {
    const mode = 'win32'
    console.log(`\n── ${mode} (data-windows-titlebar + --dsh-windows-titlebar-height:40px) ──`)
    const run = await openAndMeasure(mode, { platform: 'win32', fullscreen: false })
    const m = run.measurement
    const topbarTop = m.topbar ? m.topbar.rect.top : NaN
    const strip = m.strip
    matrix.push({ mode, mounted: run.mounted, bubbles: m.userBubbleCount, topbarTop, stripH: strip ? strip.heightPx : NaN, esc: '' })

    check(mode, 'overlay mounts', run.mounted)
    check(mode, 'renders ≥1 user bubble', m.userBubbleCount >= 1, `${m.userBubbleCount}`)
    check(mode, 'html carries data-windows-titlebar', m.html.windowsTitlebar === true)
    check(mode, 'official --dsh-windows-titlebar-height resolves to 40px', m.frameVars['--dsh-windows-titlebar-height'] === '40px', m.frameVars['--dsh-windows-titlebar-height'])
    check(mode, 'topbar clears the native titlebar (top ≥ 40)', Number.isFinite(topbarTop) && topbarTop >= 40, `topbar.top=${px(topbarTop)}`)
    check(mode, 'topbar reserves 40px titlebar + 20px gap (≈60px)', approx(topbarTop, 60), `topbar.top=${px(topbarTop)}`)
    {
      // Native caption buttons: top-right, 40px tall, 138px wide.
      const captionZone = { x: m.viewport.width - 138, y: 0, width: 138, height: 40 }
      const exitRect = m.exit ? m.exit.rect : null
      check(
        mode,
        'exit button does not intersect the native caption zone (x ≥ vw-138, y < 40)',
        exitRect ? !intersects(exitRect, captionZone) : false,
        exitRect
          ? `exit=${JSON.stringify({ x: Math.round(exitRect.x), y: Math.round(exitRect.y), w: Math.round(exitRect.width), h: Math.round(exitRect.height) })}, zone=${JSON.stringify(captionZone)}`
          : 'no exit button found in the overlay',
      )
    }
    checkStripCommon(mode, strip, m.viewport.width)
    if (strip) {
      check(mode, 'frame strip height ≥ 40 (expected 60)', strip.heightPx >= 40, `h=${px(strip.heightPx)}`)
      check(mode, 'frame strip height is 60px (40 titlebar + 20 gap)', approx(strip.heightPx, 60), `h=${px(strip.heightPx)}`)
      checkDragRegion(mode, strip, 40)
    } else {
      checkDragRegion(mode, null, 40)
    }
    check(
      mode,
      'no official fixed/sticky z≥20 element paints above the overlay',
      run.zLeaks.leaks.length === 0,
      run.zLeaks.leaks.length
        ? `leaks: ${run.zLeaks.leaks.map((leak) => `${leak.tag}.${leak.cls}(z=${leak.zIndex})@${leak.point.x},${leak.point.y}`).join('; ')}`
        : `${run.zLeaks.candidates.length} candidate(s) scanned, 0 leaks`,
    )
    // The fixed z-30 sidebar-collapse toggle was the leak; the plugin hides it
    // only while focus is on (html[data-windows-titlebar] body[data-fm-focus]
    // [data-sidebar-toggle]{display:none!important}), so assert both edges.
    {
      const toggle = run.toggle
      const describe = (state) => state.items.map((item) => `display=${item.display}, rect=${Math.round(item.rect.width)}x${Math.round(item.rect.height)}`).join(' | ')
      check(mode, '[data-sidebar-toggle] exists on the Windows desktop renderer', toggle.count >= 1, `${toggle.count} element(s)`)
      check(mode, 'sidebar toggle is hidden while focus is on', toggle.count >= 1 && toggle.allHidden, toggle.count ? describe(toggle) : 'selector missing')
      check(mode, 'body carries data-fm-focus while the overlay is open (CSS trigger)', toggle.bodyFocus)
    }

    const esc = run.mounted ? await sim.exitOverlay() : { exited: false, presses: 0 }
    if (run.mounted) {
      check(mode, 'Esc exits the overlay', esc.exited, `${esc.presses} press(es)`)
      matrix[matrix.length - 1].esc = esc.exited ? `✓ (${esc.presses})` : '✗'
      const restored = await sim.sidebarToggleState()
      run.toggleAfterExit = restored
      check(
        mode,
        'sidebar toggle is visible again after Esc (focus off)',
        restored.count >= 1 && restored.items.every((item) => item.visible),
        restored.count ? restored.items.map((item) => `display=${item.display}, rect=${Math.round(item.rect.width)}x${Math.round(item.rect.height)}`).join(' | ') : 'selector missing',
      )
      check(mode, 'body no longer carries data-fm-focus after Esc', restored.bodyFocus === false)
    } else {
      skip(mode, 'Esc exits the overlay', 'overlay never mounted')
    }
  }

  // ── 5. Windows fullscreen ──────────────────────────────────────────────
  {
    const mode = 'win32+fullscreen'
    console.log(`\n── ${mode} (data-windows-titlebar + data-fullscreen) ──`)
    const run = await openAndMeasure(mode, { platform: 'win32', fullscreen: true })
    const m = run.measurement
    const topbarTop = m.topbar ? m.topbar.rect.top : NaN
    const strip = m.strip
    matrix.push({ mode, mounted: run.mounted, bubbles: m.userBubbleCount, topbarTop, stripH: strip ? strip.heightPx : NaN, esc: '' })

    check(mode, 'overlay mounts', run.mounted)
    check(mode, 'renders ≥1 user bubble', m.userBubbleCount >= 1, `${m.userBubbleCount}`)
    check(mode, 'html carries data-windows-titlebar + data-fullscreen', m.html.windowsTitlebar === true && m.html.fullscreen === 'true')
    check(mode, 'topbar top ≈20px (16..32)', Number.isFinite(topbarTop) && topbarTop >= 16 && topbarTop <= 32, `topbar.top=${px(topbarTop)}`)
    check(mode, 'no 40px titlebar clearance remains', m.overlay && Number.parseFloat(m.overlay.paddingTop) <= 32, m.overlay ? `padding-top=${m.overlay.paddingTop}` : 'no overlay')
    check(mode, 'overlay reserves exactly the 20px fullscreen gap', m.overlay && approx(Number.parseFloat(m.overlay.paddingTop), 20), m.overlay ? `padding-top=${m.overlay.paddingTop}` : 'no overlay')
    if (strip) {
      check(mode, 'frame strip collapses to the 20px fullscreen gap', approx(strip.heightPx, 20), `h=${px(strip.heightPx)}`)
      check(mode, 'frame strip is still a drag region', strip.appRegion === 'drag' || strip.dataWindowDrag, strip.appRegion ? `app-region=${strip.appRegion}` : 'data-window-drag fallback')
    } else {
      skip(mode, 'frame strip geometry', 'no strip element in fullscreen (acceptable if drag band is not needed)')
    }
    console.log(`  ℹ z-leak scan: ${run.zLeaks.leaks.length} leak(s), ${run.zLeaks.candidates.length} candidate(s) (informational in fullscreen); sidebar toggle hidden=${run.toggle.count > 0 ? run.toggle.allHidden : 'n/a'}`)

    const esc = run.mounted ? await sim.exitOverlay() : { exited: false, presses: 0 }
    if (run.mounted) {
      check(mode, 'Esc exits the overlay', esc.exited, `${esc.presses} press(es)`)
      matrix[matrix.length - 1].esc = esc.exited ? `✓ (${esc.presses})` : '✗'
    } else {
      skip(mode, 'Esc exits the overlay', 'overlay never mounted')
    }
  }

  // ── 6. Windows collapsed-sidebar titlebar controls (new-session leak) ───
  // With the sidebar collapsed, the official new-session button and the
  // collapse toggle both become fixed z-30 titlebar-band controls — the leak
  // class the plugin's second hide rule covers.
  const runTitlebarCollapsedScenario = async ({ mode, viewportLabel }) => {
    console.log(`\n── ${mode} (${viewportLabel}, sidebar collapsed) ──`)
    const before = await sim.titlebarControlsState()
    const ns = before.newSession[0]
    const toggle = before.toggle[0]
    const rectText = (item) => (item ? `${Math.round(item.rect.x)},${Math.round(item.rect.y)} ${Math.round(item.rect.width)}×${Math.round(item.rect.height)}` : 'missing')
    const displayText = (state) => `toggle=${state.toggle.map((item) => item.display).join('/') || 'none'}, newSession=${state.newSession.map((item) => item.display).join('/') || 'none'}`

    check(mode, 'official sidebar is collapsed (titlebar-band layout)', before.sidebarCollapsed)
    check(mode, 'button[class*="newSession"] exists', before.newSession.length >= 1, `${before.newSession.length}`)
    check(
      mode,
      'new-session button is visible in the titlebar band before focus (≈48,6 28×28)',
      Boolean(ns) && ns.visible && approx(ns.rect.x, 48, 2) && approx(ns.rect.y, 6, 2) && approx(ns.rect.width, 28, 2) && approx(ns.rect.height, 28, 2),
      `display=${ns ? ns.display : 'missing'}, rect=${rectText(ns)}`,
    )
    check(
      mode,
      'new-session button is the hit-tested surface at its center before focus',
      Boolean(ns) && ns.hitTop.some((hit) => /newSession/.test(hit)),
      ns ? ns.hitTop.join(' > ') : 'missing',
    )
    check(mode, 'sidebar toggle is visible before focus', Boolean(toggle) && toggle.visible, `display=${toggle ? toggle.display : 'missing'}, rect=${rectText(toggle)}`)

    await sim.clickFocus()
    const mounted = await sim.waitOverlay({ timeout: 8_000 })
    if (mounted) await sim.waitUserBubbles({ min: 1, timeout: 10_000 })
    const measurement = await sim.measureOverlay()
    await sim.movePointerToIdle()
    const open = await sim.titlebarControlsState()
    const zLeaks = await sim.zLeakScan()
    const screenshot = await sim.screenshot(`desktop-frame-${mode}.png`)
    const topbarTop = measurement.topbar ? measurement.topbar.rect.top : NaN
    report.runs.push({ mode, viewport: measurement.viewport, before, open, measurement, zLeaks, screenshot })
    matrix.push({ mode, mounted, bubbles: measurement.userBubbleCount, topbarTop, stripH: measurement.strip ? measurement.strip.heightPx : NaN, esc: '' })

    check(mode, 'overlay mounts', mounted)
    check(mode, 'renders ≥1 user bubble', measurement.userBubbleCount >= 1, `${measurement.userBubbleCount}`)
    check(mode, '.fm-topbar top ≈60px (40px native titlebar + 20px gap)', Number.isFinite(topbarTop) && topbarTop >= 40 && approx(topbarTop, 60), `topbar.top=${px(topbarTop)}`)
    check(
      mode,
      'new-session button is hidden while focus is on (display none)',
      open.newSession.length >= 1 && open.newSession.every((item) => !item.visible),
      open.newSession.length ? displayText(open) : 'selector missing',
    )
    check(
      mode,
      'sidebar toggle is hidden while focus is on (display none)',
      open.toggle.length >= 1 && open.toggle.every((item) => !item.visible),
      open.toggle.length ? displayText(open) : 'selector missing',
    )
    check(mode, 'body carries data-fm-focus while the overlay is open', open.bodyFocus)
    check(
      mode,
      'no official fixed/sticky z≥20 element paints above the overlay',
      zLeaks.leaks.length === 0,
      zLeaks.leaks.length
        ? `leaks: ${zLeaks.leaks.map((leak) => `${leak.tag}.${leak.cls}(z=${leak.zIndex})@${leak.point.x},${leak.point.y}`).join('; ')}`
        : `${zLeaks.candidates.length} candidate(s) scanned, 0 leaks`,
    )

    const esc = mounted ? await sim.exitOverlay() : { exited: false, presses: 0 }
    if (mounted) {
      check(mode, 'Esc exits the overlay', esc.exited, `${esc.presses} press(es)`)
      matrix[matrix.length - 1].esc = esc.exited ? `✓ (${esc.presses})` : '✗'
      const after = await sim.titlebarControlsState()
      report.runs[report.runs.length - 1].after = after
      const nsAfter = after.newSession[0]
      const toggleAfter = after.toggle[0]
      check(
        mode,
        'new-session button is visible again after Esc (display != none, non-zero rect)',
        Boolean(nsAfter) && nsAfter.visible && approx(nsAfter.rect.x, 48, 2) && approx(nsAfter.rect.y, 6, 2) && approx(nsAfter.rect.width, 28, 2),
        `display=${nsAfter ? nsAfter.display : 'missing'}, rect=${rectText(nsAfter)}`,
      )
      check(
        mode,
        'sidebar toggle is visible again after Esc (display != none, non-zero rect)',
        Boolean(toggleAfter) && toggleAfter.visible,
        `display=${toggleAfter ? toggleAfter.display : 'missing'}, rect=${rectText(toggleAfter)}`,
      )
      check(mode, 'body no longer carries data-fm-focus after Esc', after.bodyFocus === false)
    } else {
      skip(mode, 'Esc exits the overlay', 'overlay never mounted')
    }
  }

  // 6a. 1280×820 with a user-collapsed sidebar.
  await sim.setViewport({ width: 1280, height: 820 })
  await sim.applyFrame({ platform: 'win32', fullscreen: false })
  await sim.collapseSidebar()
  await runTitlebarCollapsedScenario({ mode: 'win32-collapsed-1280', viewportLabel: '1280×820' })

  // 6b. The 520×600 Windows minimum window: the session was opened and the
  // sidebar collapsed at 1280×820 above; resizing now keeps the collapsed
  // titlebar-band layout (and the Windows layout auto-collapses <768px too).
  await sim.setViewport({ width: 520, height: 600 })
  await sim.collapseSidebar()
  await runTitlebarCollapsedScenario({ mode: 'win32-collapsed-narrow-520', viewportLabel: '520×600' })
} catch (error) {
  counts.fail++
  failures.push(`harness: ${error.message}`)
  console.error(`\n✗ harness failure: ${error.stack || error.message}`)
} finally {
  if (sim) {
    const diagnostics = sim.diagnostics()
    if (diagnostics.focusOverlayErrors.length) {
      console.log('\nplugin console errors (first 3):')
      for (const line of diagnostics.focusOverlayErrors.slice(0, 3)) console.log(`  ${line.split('\n')[0]}`)
    }
    if (diagnostics.pageErrors.length) {
      console.log('\npage errors (first 3):')
      for (const line of diagnostics.pageErrors.slice(0, 3)) console.log(`  ${line}`)
    }
    await sim.close()
  }
  await gui.stop()
}

// ── summary ────────────────────────────────────────────────────────────────
console.log('\n=== desktop frame matrix ===')
const header = ['mode', 'mounted', 'bubbles', 'topbarTop', 'stripH', 'Esc']
const widths = [28, 9, 8, 10, 8, 10]
const row = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('')
console.log(row(header))
for (const entry of matrix) {
  console.log(row([entry.mode, entry.mounted ? '✓' : '✗', entry.bubbles, px(entry.topbarTop), px(entry.stripH), entry.esc || '–']))
}
console.log(`\nchecks: ${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped`)
if (skips.length) {
  console.log('skipped:')
  for (const line of skips) console.log(`  – ${line}`)
}
if (failures.length) {
  console.log('\nfailing assertions:')
  for (const line of failures) console.log(`  ✗ ${line}`)
}
const green = counts.fail === 0 && counts.pass > 0
report.finishedAt = new Date().toISOString()
report.result = green ? 'GREEN' : 'RED'
report.counts = counts
report.matrix = matrix
try {
  const reportPath = join(ensureOutDir(), 'desktop-frame-report.json')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\nreport: ${reportPath}`)
} catch (error) {
  console.log(`\n(could not write JSON report: ${error.message})`)
}
console.log(`\nRESULT: ${green ? 'GREEN — desktop window-frame contract holds on the 0.2.2 runtime' : 'RED'}`)
process.exitCode = green ? 0 : 1
