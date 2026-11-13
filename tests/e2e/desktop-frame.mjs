#!/usr/bin/env node
/**
 * Desktop window-frame regression matrix for dsh-focus-overlay on
 * DSH desktop 0.2.2-rc.1 (macOS + Windows renderer contract).
 *
 * The desktop shell paints a hidden native titlebar as web content and marks
 * `<html>`: `data-platform="darwin"` (macOS traffic lights at x16,y18,
 * ~60.7×14), `data-windows-titlebar` + `--dsh-windows-titlebar-height:40px`
 * (Windows native caption zone top-right), and `data-fullscreen` on both.
 * The official layout publishes `--dsh-frame-top-clearance` (48 / 40) and
 * `--dsh-frame-overlay-top` (clearance + 20px, i.e. 68 / 60).
 * The focus overlay reserves ONLY the traffic-light / caption clearance
 * (`--dsh-frame-top-clearance`, or a compact 40px titlebar row in native
 * fullscreen) and merges its own title row INTO that band: the row is the
 * overlay's LAST child and is the window drag surface, with its exit control
 * explicitly no-drag. The 20px dialog gap and the extra 48px titlebar row the
 * old layout stacked underneath the band are gone. The plain web generation
 * must stay pixel-identical (topbar in normal flow, no band).
 *
 * This script asserts that contract for:
 *   plain web      — overlay mounts, user bubbles render, topbar at y≈0 in
 *                    normal flow, no frame band, no drag surface, Esc exits;
 *   darwin         — band 48px: overlay padding-top 48, title row y=0 h=48
 *                    spanning the viewport and merged with the traffic lights
 *                    (title left ≥ 88), body starts at 48, exit clear of the
 *                    traffic-light box, exit control no-drag, row is the last
 *                    overlay child + declared drag region, legacy
 *                    `.fm-frame-strip` gone;
 *   win32          — band 40px, same merged-row contract, exit clear of the
 *                    top-right caption zone {x ≥ vw-138, y < 40};
 *   darwin/win32 + fullscreen — band 40px (compact row; no stale 48/40
 *                    clearance, no dialog gap).
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

/** Shared contract of the DESKTOP BAND, split per platform:
 *  - macOS: the overlay reserves only the traffic-light clearance and the title
 *    row is merged INTO it — the row is also the window drag surface itself.
 *  - Windows: the caption band must stay chrome (native caption buttons + the
 *    web caption menubar paints above the overlay), so the band is reserved
 *    empty and the title row sits directly BELOW it; the separate
 *    `.fm-frame-strip` owns the band drag.
 *  Both drop the official +20px dialog gap and are far tighter than 0.13.x. */

/** macOS: title row merged into the traffic-light band, is the drag surface. */
function checkMacMergedBand(mode, m, band) {
  const pass = (label, ok, detail = '') => check(mode, label, ok, detail)
  const overlayPadding = m.overlay ? Number.parseFloat(m.overlay.paddingTop) : NaN
  pass(
    `overlay reserves exactly the merged ${band}px band (padding-top)`,
    approx(overlayPadding, band),
    m.overlay ? `padding-top=${m.overlay.paddingTop}, --fm-frame-band=${JSON.stringify(m.overlay.frameBandVar)}` : 'no overlay',
  )
  pass(
    '--fm-frame-band resolves to the official clearance (no +20px dialog gap)',
    Boolean(m.overlay) && m.overlay.frameBandVar === `${band}px`,
    m.overlay ? m.overlay.frameBandVar : 'no overlay',
  )
  pass(
    'title row is merged into the band (top = 0, absolute in-band)',
    Boolean(m.topbar) && approx(m.topbar.rect.top, 0) && m.topbar.position === 'absolute',
    m.topbar ? `topbar.top=${px(m.topbar.rect.top)}, position=${m.topbar.position}` : 'no .fm-topbar',
  )
  pass(
    'title row height equals the band (no second 48px bar underneath)',
    Boolean(m.topbar) && approx(m.topbar.heightPx, band),
    m.topbar ? `h=${px(m.topbar.heightPx)} (band=${band})` : 'no .fm-topbar',
  )
  pass(
    'title row spans the viewport at the top',
    Boolean(m.topbar) && approx(m.topbar.rect.left, 0) && m.topbar.rect.width >= m.viewport.width - 1,
    m.topbar ? `left=${px(m.topbar.rect.left)}, width=${px(m.topbar.rect.width)}` : 'no .fm-topbar',
  )
  pass(
    'transcript starts immediately below the band (space reclaimed)',
    Boolean(m.body) && approx(m.body.rect.top, band),
    m.body ? `body.top=${px(m.body.rect.top)} (expected ${band})` : 'no .fm-body',
  )
  pass(
    'title row declares the drag region (data-window-drag + computed app-region drag)',
    Boolean(m.topbar) && m.topbar.dataWindowDrag && m.topbar.appRegion === 'drag',
    m.topbar ? `data-window-drag=${m.topbar.dataWindowDrag}, app-region=${JSON.stringify(m.topbar.appRegion)}` : 'no .fm-topbar',
  )
  pass(
    'title row IS the overlay’s drag surface (band-height drag claim)',
    Boolean(m.dragSurface) && m.dragSurface.isTopbar && m.dragSurface.appRegion === 'drag' && approx(m.dragSurface.heightPx, band),
    m.dragSurface ? `cls=${JSON.stringify(m.dragSurface.cls)}, app-region=${JSON.stringify(m.dragSurface.appRegion)}, h=${px(m.dragSurface.heightPx)}` : 'no drag surface',
  )
  pass(
    'the separate .fm-frame-strip is not rendered on macOS (merged into the row)',
    Boolean(m.frameStrip) && m.frameStrip.displayed === false,
    m.frameStrip ? `display=${m.frameStrip.display}` : 'no strip element',
  )
  pass(
    'interactive control inside the band is excluded from the drag region (no-drag)',
    Boolean(m.topbar) && m.topbar.controlCount >= 1 && m.topbar.controlRegions.every((control) => control.appRegion === 'no-drag'),
    m.topbar
      ? `${m.topbar.controlCount} control(s): ${m.topbar.controlRegions.map((control) => `${control.tag}(${control.appRegion || 'none'})`).join(', ')}`
      : 'no .fm-topbar',
  )
}

/** Windows: caption band reserved as chrome, title row directly below it, the
 *  separate strip owns the band drag. */
function checkWindowsStackedBand(mode, m, band) {
  const pass = (label, ok, detail = '') => check(mode, label, ok, detail)
  const rowHeight = 40
  const overlayPadding = m.overlay ? Number.parseFloat(m.overlay.paddingTop) : NaN
  pass(
    `overlay reserves the ${band}px caption band only (padding-top)`,
    approx(overlayPadding, band),
    m.overlay ? `padding-top=${m.overlay.paddingTop}, --fm-frame-band=${JSON.stringify(m.overlay.frameBandVar)}` : 'no overlay',
  )
  pass(
    '--fm-frame-band resolves to the official caption height (no +20px gap)',
    Boolean(m.overlay) && m.overlay.frameBandVar === `${band}px`,
    m.overlay ? m.overlay.frameBandVar : 'no overlay',
  )
  pass(
    'title row sits directly BELOW the caption band (not merged under the menubar)',
    Boolean(m.topbar) && approx(m.topbar.rect.top, band) && m.topbar.position === 'static',
    m.topbar ? `topbar.top=${px(m.topbar.rect.top)} (expected ${band}), position=${m.topbar.position}` : 'no .fm-topbar',
  )
  pass(
    `title row height is the compact ${rowHeight}px row`,
    Boolean(m.topbar) && approx(m.topbar.heightPx, rowHeight),
    m.topbar ? `h=${px(m.topbar.heightPx)}` : 'no .fm-topbar',
  )
  pass(
    'title row spans the viewport',
    Boolean(m.topbar) && approx(m.topbar.rect.left, 0) && m.topbar.rect.width >= m.viewport.width - 1,
    m.topbar ? `left=${px(m.topbar.rect.left)}, width=${px(m.topbar.rect.width)}` : 'no .fm-topbar',
  )
  pass(
    'title row is NOT a window drag region on Windows (menubar/native caption own the band)',
    Boolean(m.topbar) && m.topbar.appRegion !== 'drag',
    m.topbar ? `app-region=${JSON.stringify(m.topbar.appRegion)}` : 'no .fm-topbar',
  )
  pass(
    'separate .fm-frame-strip is rendered over the caption band',
    Boolean(m.frameStrip) && m.frameStrip.displayed && approx(m.frameStrip.rect.top, 0) && approx(m.frameStrip.rect.height, band) && m.frameStrip.rect.width >= m.viewport.width - 1,
    m.frameStrip ? `display=${m.frameStrip.display}, rect=${JSON.stringify({ x: Math.round(m.frameStrip.rect.x), y: Math.round(m.frameStrip.rect.y), w: Math.round(m.frameStrip.rect.width), h: Math.round(m.frameStrip.rect.height) })}` : 'no strip element',
  )
  pass(
    'captioned strip is the overlay’s LAST child and the drag surface',
    Boolean(m.frameStrip) && m.frameStrip.isLastChild && m.frameStrip.appRegion === 'drag' && Boolean(m.dragSurface) && !m.dragSurface.isTopbar && m.dragSurface.isLastChild,
    m.frameStrip ? `stripLast=${m.frameStrip.isLastChild}, strip-region=${JSON.stringify(m.frameStrip.appRegion)}, surface=${JSON.stringify(m.dragSurface?.cls ?? null)}` : 'no strip element',
  )
  pass(
    'transcript starts below the caption band + title row',
    Boolean(m.body) && Boolean(m.topbar) && approx(m.body.rect.top, m.topbar.rect.bottom),
    m.body && m.topbar ? `body.top=${px(m.body.rect.top)}, row.bottom=${px(m.topbar.rect.bottom)}` : 'missing overlay children',
  )
  pass(
    'exit control sits in the title row, clear of the native caption band',
    Boolean(m.exit) && m.exit.rect.top >= band,
    m.exit ? `exit.top=${px(m.exit.rect.top)} (caption band ends at ${band})` : 'no exit button',
  )
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
    const topbarH = m.topbar ? m.topbar.heightPx : NaN
    matrix.push({ mode, mounted: run.mounted, bubbles: m.userBubbleCount, topbarTop, band: 0, esc: '' })

    check(mode, 'overlay mounts', run.mounted)
    check(mode, 'renders ≥1 user bubble', m.userBubbleCount >= 1, `${m.userBubbleCount}`)
    check(mode, 'single overlay instance', m.overlayCount === 1, `${m.overlayCount}`)
    check(mode, 'title row sits at the viewport top (no frame padding)', Number.isFinite(topbarTop) && approx(topbarTop, 0), `topbar.top=${px(topbarTop)}`)
    check(
      mode,
      'overlay reserves no frame band',
      Boolean(m.overlay) && Number.parseFloat(m.overlay.paddingTop) === 0 && m.overlay.frameBandVar === '0px',
      m.overlay ? `padding-top=${m.overlay.paddingTop}, --fm-frame-band=${JSON.stringify(m.overlay.frameBandVar)}` : 'no overlay',
    )
    check(mode, 'desktop frame variables are undefined', m.frameVars['--dsh-frame-overlay-top'] === '' && m.frameVars['--dsh-windows-titlebar-height'] === '', `overlay-top=${JSON.stringify(m.frameVars['--dsh-frame-overlay-top'])}, win-height=${JSON.stringify(m.frameVars['--dsh-windows-titlebar-height'])}`)
    check(
      mode,
      'title row stays in normal flow (not the desktop in-band drag surface)',
      Boolean(m.topbar) && m.topbar.position === 'static' && m.topbar.appRegion !== 'drag',
      m.topbar ? `position=${m.topbar.position}, app-region=${JSON.stringify(m.topbar.appRegion)}, content-h=${px(topbarH)}` : 'no .fm-topbar',
    )
    check(
      mode,
      'transcript follows the title row in flow (web layout unchanged)',
      Boolean(m.body) && Boolean(m.topbar) && approx(m.body.rect.top, m.topbar.rect.bottom),
      m.body && m.topbar ? `body.top=${px(m.body.rect.top)}, topbar.bottom=${px(m.topbar.rect.bottom)}` : 'missing overlay children',
    )
    check(
      mode,
      'no drag surface on the plain web (title row is not a drag claim, strip not rendered)',
      m.dragSurface === null && Boolean(m.frameStrip) && m.frameStrip.displayed === false,
      `dragSurface=${m.dragSurface === null ? 'none' : m.dragSurface.cls}, strip display=${JSON.stringify(m.frameStrip?.display)}`,
    )
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
    matrix.push({ mode, mounted: run.mounted, bubbles: m.userBubbleCount, topbarTop, band: 48, esc: '' })

    check(mode, 'overlay mounts', run.mounted)
    check(mode, 'renders ≥1 user bubble', m.userBubbleCount >= 1, `${m.userBubbleCount}`)
    check(mode, 'html carries data-platform=darwin', m.html.platform === 'darwin')
    check(mode, 'official --dsh-frame-top-clearance resolves to 48px', m.frameVars['--dsh-frame-top-clearance'] === '48px', m.frameVars['--dsh-frame-top-clearance'])
    checkMacMergedBand(mode, m, 48)
    {
      // Native traffic lights: x 16..77 (≈60.7 wide), y 18..32.
      const trafficLights = { x: 16, y: 18, width: 61, height: 14 }
      const titleRect = m.topbar && m.topbar.title ? m.topbar.title.rect : null
      check(
        mode,
        'title text clears the traffic-light box (left ≥ 88, the official leading seat)',
        Boolean(titleRect) && titleRect.left >= 88 && !intersects(titleRect, trafficLights),
        titleRect ? `title.left=${px(titleRect.left)}, title=${JSON.stringify(m.topbar.title.text)}` : 'no .fm-title inside the title row',
      )
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
    matrix.push({ mode, mounted: run.mounted, bubbles: m.userBubbleCount, topbarTop, band: 40, esc: '' })

    check(mode, 'overlay mounts', run.mounted)
    check(mode, 'renders ≥1 user bubble', m.userBubbleCount >= 1, `${m.userBubbleCount}`)
    check(mode, 'html carries data-platform=darwin + data-fullscreen', m.html.platform === 'darwin' && m.html.fullscreen === 'true')
    check(
      mode,
      'official fullscreen --dsh-frame-overlay-top would be 20px (band var is ours, not the dialog inset)',
      m.frameVars['--dsh-frame-overlay-top'] === '20px',
      m.frameVars['--dsh-frame-overlay-top'],
    )
    checkMacMergedBand(mode, m, 40)
    check(
      mode,
      'fullscreen title row drops the 88px traffic-light inset (no lights in fullscreen)',
      Boolean(m.topbar && m.topbar.title) && m.topbar.title.rect.left >= 12 && m.topbar.title.rect.left < 48,
      m.topbar && m.topbar.title ? `title.left=${px(m.topbar.title.rect.left)}` : 'no .fm-title inside the title row',
    )
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
    matrix.push({ mode, mounted: run.mounted, bubbles: m.userBubbleCount, topbarTop, band: 40, esc: '' })

    check(mode, 'overlay mounts', run.mounted)
    check(mode, 'renders ≥1 user bubble', m.userBubbleCount >= 1, `${m.userBubbleCount}`)
    check(mode, 'html carries data-windows-titlebar', m.html.windowsTitlebar === true)
    check(mode, 'official --dsh-windows-titlebar-height resolves to 40px', m.frameVars['--dsh-windows-titlebar-height'] === '40px', m.frameVars['--dsh-windows-titlebar-height'])
    checkWindowsStackedBand(mode, m, 40)
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
    matrix.push({ mode, mounted: run.mounted, bubbles: m.userBubbleCount, topbarTop, band: 40, esc: '' })

    check(mode, 'overlay mounts', run.mounted)
    check(mode, 'renders ≥1 user bubble', m.userBubbleCount >= 1, `${m.userBubbleCount}`)
    check(mode, 'html carries data-windows-titlebar + data-fullscreen', m.html.windowsTitlebar === true && m.html.fullscreen === 'true')
    check(
      mode,
      'official fullscreen --dsh-frame-overlay-top would be 20px (band var is ours, not the dialog inset)',
      m.frameVars['--dsh-frame-overlay-top'] === '20px',
      m.frameVars['--dsh-frame-overlay-top'],
    )
    checkWindowsStackedBand(mode, m, 40)
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
    matrix.push({ mode, mounted, bubbles: measurement.userBubbleCount, topbarTop, band: 40, esc: '' })

    check(mode, 'overlay mounts', mounted)
    check(mode, 'renders ≥1 user bubble', measurement.userBubbleCount >= 1, `${measurement.userBubbleCount}`)
    checkWindowsStackedBand(mode, measurement, 40)
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
const header = ['mode', 'mounted', 'bubbles', 'topbarTop', 'band', 'Esc']
const widths = [28, 9, 8, 11, 6, 10]
const row = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('')
console.log(row(header))
for (const entry of matrix) {
  console.log(row([entry.mode, entry.mounted ? '✓' : '✗', entry.bubbles, px(entry.topbarTop), px(entry.band), entry.esc || '–']))
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
