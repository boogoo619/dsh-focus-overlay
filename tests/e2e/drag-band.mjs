#!/usr/bin/env node
/**
 * macOS/Windows window drag-band regression for dsh-focus-overlay on the DSH
 * desktop renderer (0.2.2-rc.1, Electron 44.7 / Chrome 152).
 *
 * WHY THIS TEST EXISTS
 * The desktop shells hide the native titlebar and render that area as web
 * content, so the focus overlay reserves the top band (`--dsh-frame-overlay-top`
 * = 68px on macOS, 60px on Windows) and owns the window drag surface itself:
 * `.fm-frame-strip` carries `-webkit-app-region: drag` + `data-window-drag`.
 * The renderer does NOT use the browser hit test for the window drag; Electron
 * takes the ordered list of CSS app-region rects from the renderer and applies
 * them in order — `drag` adds area, `no-drag` subtracts it, and the LATER rect
 * wins where rects overlap (electron `shell/browser/ui/drag_util.cc`
 * `DraggableRegionsToSkRegion`; renderer order = Blink
 * `LocalFrameView::CollectDraggableRegions` pre-order ≈ DOM order). Layout
 * rects are not clipped by ancestor overflow, so scrolled content keeps its
 * full (negative-y) box. `-webkit-app-region` is inherited on this runtime
 * (standardised as `window-drag` in Chromium 152), and the official darwin
 * stylesheet marks `[tabindex]` as no-drag — `.fm-overlay` has
 * `tabIndex={-1}`, so EVERY overlay descendant is a no-drag rect.
 *
 * The bug: `.fm-frame-strip` used to be the overlay's FIRST child. On sessions
 * with content, later overlay descendants overlapped the band and cancelled
 * the drag region — (a) the turn-rail wrapper `.fm-rail-slot`
 * (`position:absolute;inset:0;pointer-events:none`, rendered when the rail has
 * >=2 turns) is a full-viewport no-drag rect, (b) scrolled `.fm-body` content
 * keeps unclipped negative-y rects (`.fm-inner`, `.fm-msg`, `p`, `code`, ...).
 * Empty sessions rendered neither, which is exactly the report: draggable only
 * on a blank session. The fix renders the strip as the overlay's LAST child,
 * so its drag rect is the final word for the band.
 *
 * HOW THIS SCRIPT CHECKS IT (plain browser, geometric/ordering emulation)
 * This is a Playwright e2e run against the real web client in headless
 * Chromium, not a real Electron window. That is deliberate: the check encodes
 * Electron's documented ordered-region semantics instead of reading the
 * strip's computed style (which the old 0.13.0 test did and which cannot see
 * the overlap). `dragRegionProbe()` in `lib/desktop-sim.mjs` collects every
 * drag/no-drag rect in DOM order and returns the LAST covering rect for each
 * probe point. One wrinkle the helper documents: the bundled Playwright
 * Chromium (151) predates the standardised, inherited `window-drag` property,
 * so it only exposes the legacy NON-inherited `-webkit-app-region`; the helper
 * reconstructs the inherited value (the desktop renderer's actual behaviour)
 * by walking the DOM. Screenshots and the JSON report land in
 * tests/e2e/out/ (gitignored).
 *
 * Assertions:
 *   1. darwin: after opening the focus overlay on a stored session, scrolling
 *      `.fm-body` to the bottom, all probe points across the reserved band
 *      (x = 30, vw/2, vw-30, vw-140 at y = 10, 30, 50) resolve to `.fm-frame-strip`
 *      (drag). The structural contract is asserted too: the strip is the
 *      overlay's LAST child and its height equals the resolved
 *      `--dsh-frame-overlay-top` band.
 *   2. Non-vacuity: the probe must find no-drag rects overlapping the band that
 *      come BEFORE the strip (`.fm-rail-slot`, scrolled `.fm-inner`/`.fm-msg`)
 *      and NONE after it — that is what the ordering fix buys. If the fixture
 *      session is too thin to scroll or render a rail, a test-only synthetic
 *      no-drag rect proves both directions of the ordering: inserted just
 *      before the strip the band stays draggable, moved after it the band
 *      becomes no-drag (the old-order failure), then it is removed.
 *   3. The turn rail, when it renders within ~5s, is probed again as well.
 *   4. win32: same band probe with the 60px strip.
 *
 * RED-BEFORE EVIDENCE (recorded, not committed as code)
 * On the fixed build this script is green. Re-running with the strip moved back
 * to the overlay's first child in the live page (scratch script, DOM restored
 * after measuring) turned all 12 darwin band points into
 * `no-drag` with winner `.fm-rail-slot` (inherited no-drag), and the band
 * diagnostics reported 14 no-drag rects AFTER the strip. Restoring the strip as
 * the last child turned all 12 points back into `drag .fm-frame-strip`. The
 * synthetic control in step 2 below reproduces that ordering flip inside the
 * committed test, independent of which session the fixture has.
 *
 * Usage:
 *   # spawn its own isolated desktop-runtime instance (never the live app)
 *   DSH_HOME=/tmp/dsh-home-e2e DSH_PORT=3199 node tests/e2e/drag-band.mjs
 *   # or attach to a running instance (URL may carry ?token=…)
 *   DSH_GUI_ORIGIN='http://127.0.0.1:3199/?token=…' node tests/e2e/drag-band.mjs
 *
 * Preparation: `npm run build` (the isolated profile links this checkout; a
 * running server caches the client bundle at boot, restart it after a build),
 * and an isolated home cloned from the seeded one, e.g.
 * `cp -a -c /tmp/dsh-home-test/. /tmp/dsh-home-e2e/`.
 *
 * The fixture's stored sessions differ in size: the seeded fmtest session can
 * be a single short turn (no rail, nothing to scroll). The script first tries
 * `openSessionWithHistory()` and then walks the other stored sidebar sessions
 * until one renders a rail or a scrollable transcript, so the natural overlap
 * is exercised when the fixture carries it. When none does, the synthetic
 * control still proves the ordering contract (the required hit-test assertion
 * stays non-vacuous).
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureGui, ensureOutDir, launchSim } from './lib/desktop-sim.mjs'

const BAND_TOP = { darwin: 68, win32: 60 }
const RAIL_WAIT_MS = 5_000
const RICH_WAIT_MS = 12_000
const MAX_SESSION_ATTEMPTS = 6

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const approx = (value, expected, tolerance = 1) => Math.abs(value - expected) <= tolerance
const px = (value) => (Number.isFinite(value) ? `${Number(value.toFixed(2))}px` : String(value))
const short = (value, max = 90) => (typeof value === 'string' && value.length > max ? `${value.slice(0, max)}…` : value)

const counts = { pass: 0, fail: 0, skip: 0 }
const failures = []
const skips = []

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

/** Describe a probe point's winner for failure messages. */
function describeWinner(winner) {
  if (!winner) return '(no app-region rect covers this point)'
  return `${winner.region} <${winner.tag}> ${JSON.stringify(short(winner.cls))}${winner.inherited ? ' (inherited)' : ''} rect=${Math.round(winner.rect.x)},${Math.round(winner.rect.y)} ${Math.round(winner.rect.width)}x${Math.round(winner.rect.height)}`
}

/** A band width grid: x = 30, vw/2, vw-30, vw-140 at y = 10, 30, 50. */
const bandPoints = (width) => [30, Math.round(width / 2), width - 30, width - 140].flatMap((x) => [10, 30, 50].map((y) => [x, y]))

/** Compact snapshot of what the overlay currently renders. */
async function overlayState(sim) {
  return sim.page.evaluate(() => {
    const overlay = document.querySelector('.fm-overlay')
    const strip = document.querySelector('.fm-frame-strip')
    const body = document.querySelector('.fm-body')
    const rectOf = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    return {
      overlayCount: document.querySelectorAll('.fm-overlay').length,
      bubbles: document.querySelectorAll('.fm-overlay .fm-user').length,
      rail: Boolean(document.querySelector('.fm-rail-slot') || document.querySelector('.fm-rail')),
      scrollable: Boolean(body && body.scrollHeight > body.clientHeight + 1),
      body: body ? { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, scrollTop: body.scrollTop } : null,
      strip: strip
        ? {
            rect: rectOf(strip),
            appRegion: (
              getComputedStyle(strip).getPropertyValue('-webkit-app-region') ||
              getComputedStyle(strip).getPropertyValue('app-region') ||
              ''
            ).trim(),
            isLastChild: Boolean(overlay && overlay.lastElementChild === strip),
            childIndex: overlay ? [...overlay.children].indexOf(strip) : -1,
          }
        : null,
      overlay: overlay
        ? {
            lastChildClass: String(overlay.lastElementChild?.className || ''),
            childCount: overlay.children.length,
          }
        : null,
    }
  })
}

/**
 * Wait until the overlay has rendered at least one user bubble AND enough
 * content for the drag band to be overlapped naturally (rail or a transcript
 * taller than the body). History paging can keep adding turns for a while, so
 * poll instead of assuming one frame is enough.
 */
async function waitForOverlap(sim, timeout = RICH_WAIT_MS) {
  const started = Date.now()
  let last = null
  for (;;) {
    last = await overlayState(sim)
    if (last.bubbles >= 1 && (last.rail || last.scrollable)) return { ...last, timedOut: false }
    if (Date.now() - started > timeout) return { ...last, timedOut: true }
    await sleep(300)
  }
}

/** Set the focus body to the bottom and let the overlay settle on the anchor. */
async function scrollOverlayToBottom(sim) {
  await sim.page.evaluate(() => {
    const body = document.querySelector('.fm-body')
    if (body) body.scrollTop = 100000
  })
  await sim.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await sleep(200)
  return sim.page.evaluate(() => {
    const body = document.querySelector('.fm-body')
    const inner = document.querySelector('.fm-inner')
    const rectOf = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { y: rect.y, height: rect.height }
    }
    return body
      ? { scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, inner: rectOf(inner) }
      : null
  })
}

/** Probe every band point; returns the raw helper result. */
async function probeBand(sim, points, bandTop) {
  return sim.dragRegionProbe({ points, bandTop })
}

/** The ordered hit test must resolve every point to the drag strip. */
function checkAllStrip(mode, probe, label, points) {
  let bad = 0
  const details = []
  for (const item of probe.probes) {
    const ok = item.draggable && Boolean(item.winner && /(^|\s)fm-frame-strip(\s|$)/.test(item.winner.cls))
    if (!ok) {
      bad++
      if (details.length < 3) details.push(`(${item.point.x},${item.point.y}) → ${describeWinner(item.winner)}`)
    }
  }
  check(
    mode,
    `${label} (${points.length} points)`,
    bad === 0,
    bad === 0 ? `all ${points.length} points → drag .fm-frame-strip` : `${bad}/${points.length} wrong: ${details.join('; ')}`,
  )
}

/**
 * Find a stored session whose focus overlay actually overlaps the band, so the
 * ordered hit test is exercised against real content. Tries the helper's
 * default pick first, then the other stored sessions (thin fixtures fall
 * through to the synthetic control in the caller).
 */
async function openContentScenario(sim) {
  const attempts = []
  const record = (session, mounted, bubbles, state) => {
    attempts.push({
      session: session.title,
      mounted,
      bubbles,
      rail: state.rail,
      scrollable: state.scrollable,
      body: state.body,
      timedOut: state.timedOut,
    })
  }

  let session = await sim.openSessionWithHistory()
  // The desktop frame markers must be applied AFTER boot (see desktop-sim.mjs).
  await sim.applyFrame({ platform: 'darwin' })
  await sim.clickFocus()
  let mounted = await sim.waitOverlay({ timeout: 8_000 })
  let bubbles = mounted && (await sim.waitUserBubbles({ min: 1, timeout: 10_000 }))
  let state = await waitForOverlap(sim)
  record(session, mounted, bubbles, state)

  if (mounted && !(state.bubbles >= 1 && (state.rail || state.scrollable))) {
    // Fixtures vary: /tmp/dsh-home-test's seeded session can be one short turn
    // while other stored sessions carry multi-turn history. Walk them.
    const rows = await sim.storedSessions()
    for (const row of rows) {
      if (attempts.length >= MAX_SESSION_ATTEMPTS) break
      if (row.text === session.rowText) continue
      await sim.exitOverlay()
      session = await sim.openStoredSession(row.index)
      await sim.clickFocus()
      mounted = await sim.waitOverlay({ timeout: 8_000 })
      bubbles = mounted && (await sim.waitUserBubbles({ min: 1, timeout: 10_000 }))
      state = await waitForOverlap(sim)
      record(session, mounted, bubbles, state)
      if (mounted && state.bubbles >= 1 && (state.rail || state.scrollable)) break
    }
  }

  if (!mounted) throw new Error(`the focus overlay never mounted; session attempts: ${JSON.stringify(attempts)}`)
  const rich = state.bubbles >= 1 && (state.rail || state.scrollable)
  return { session, attempts, rich, state }
}

/** Insert (or move) a test-only synthetic no-drag rect and return the overlay children. */
async function insertBandControl(sim, bandTop, position) {
  return sim.page.evaluate(
    ({ bandTop, position }) => {
      const overlay = document.querySelector('.fm-overlay')
      const strip = document.querySelector('.fm-frame-strip')
      if (!overlay || !strip) throw new Error('overlay/strip missing for the control')
      let control = document.querySelector('#fm-drag-band-control')
      if (!control) {
        control = document.createElement('div')
        control.id = 'fm-drag-band-control'
        control.setAttribute('aria-hidden', 'true')
        // Same geometry as the strip, explicitly no-drag: identical to what a
        // later overlay child (`.fm-rail-slot`, scrolled `.fm-inner`) contributes.
        control.style.cssText = `position:fixed;top:0;left:0;right:0;height:${bandTop}px;pointer-events:none;z-index:0;-webkit-app-region:no-drag;app-region:no-drag`
      }
      if (position === 'before-strip') overlay.insertBefore(control, strip)
      else overlay.appendChild(control)
      return [...overlay.children].map((child) => child.className || child.id || child.tagName.toLowerCase())
    },
    { bandTop, position },
  )
}

async function removeBandControl(sim) {
  return sim.page.evaluate(() => {
    document.querySelector('#fm-drag-band-control')?.remove()
    const overlay = document.querySelector('.fm-overlay')
    const strip = document.querySelector('.fm-frame-strip')
    return overlay && strip ? [...overlay.children].map((child) => child.className || child.id || child.tagName.toLowerCase()) : []
  })
}

const gui = await ensureGui()
console.log(`GUI: ${gui.origin} (${gui.mode})`)
ensureOutDir()
const report = {
  startedAt: new Date().toISOString(),
  origin: gui.origin,
  mode: gui.mode,
  scenario: null,
  darwin: null,
  win32: null,
  control: null,
  failures,
  skips,
}

let sim
try {
  sim = await launchSim({ origin: gui.origin, log: console.log })
  console.log('booted; opening a stored session with history…')

  const scenario = await openContentScenario(sim)
  report.scenario = {
    session: scenario.session.title,
    rich: scenario.rich,
    attempts: scenario.attempts,
  }
  console.log(`session: “${scenario.session.title}”`)
  if (!scenario.rich) {
    console.log('  ℹ fixture session has no rail and no scrollable transcript — relying on the synthetic ordering control for non-vacuity')
  }

  // ── 1. darwin: structural contract + ordered band hit test ──────────────
  const mode = 'darwin'
  console.log(`\n── ${mode} (data-platform=darwin, reserved band ${BAND_TOP.darwin}px) ──`)
  const frame = await sim.frameState()
  const points = bandPoints(frame.viewport.width)
  const initial = await overlayState(sim)

  check(mode, 'overlay mounts on a stored session', initial.overlayCount === 1, `${initial.overlayCount} overlay(s)`)
  check(mode, 'overlay renders ≥1 user bubble', initial.bubbles >= 1, `${initial.bubbles} bubble(s)`)
  check(mode, 'filter: html carries data-platform=darwin', frame.dataset.platform === 'darwin')
  // The official CSS defines the band as a calc() (`calc(48px + 20px)` on
  // darwin), so the custom property keeps that specified form; the resolved
  // 68px is asserted through the strip's layout height below.
  check(
    mode,
    'official --dsh-frame-overlay-top is the 68px band (48px clearance + 20px)',
    /^(68px|calc\(48px \+ 20px\))$/.test(frame.vars['--dsh-frame-overlay-top']),
    frame.vars['--dsh-frame-overlay-top'],
  )
  check(
    mode,
    'official --dsh-frame-top-clearance is 48px (traffic lights)',
    frame.vars['--dsh-frame-top-clearance'] === '48px',
    frame.vars['--dsh-frame-top-clearance'],
  )
  check(mode, 'frame strip exists', Boolean(initial.strip))
  if (initial.strip) {
    check(mode, 'frame strip is the overlay’s LAST child', initial.strip.isLastChild, `childIndex=${initial.strip.childIndex}, lastChild=${JSON.stringify(initial.overlay?.lastChildClass)}`)
    check(
      mode,
      'frame strip height equals the reserved band (68px)',
      approx(initial.strip.rect.height, BAND_TOP.darwin),
      `h=${px(initial.strip.rect.height)}`,
    )
    check(mode, 'frame strip spans the viewport at y=0', initial.strip.rect.y <= 1 && initial.strip.rect.width >= frame.viewport.width - 1, `rect.y=${px(initial.strip.rect.y)}, w=${px(initial.strip.rect.width)}`)
    check(mode, 'frame strip is a drag region', initial.strip.appRegion === 'drag', `app-region=${initial.strip.appRegion}`)
  } else {
    check(mode, 'frame strip height equals the reserved band (68px)', false, 'no .fm-frame-strip element')
  }

  const scroll = await scrollOverlayToBottom(sim)
  check(
    mode,
    'reproducer: .fm-body scrolls, so scrolled content keeps rects above the band',
    Boolean(scroll && scroll.scrollTop > 0),
    scroll ? `scrollTop=${px(scroll.scrollTop)}, scrollHeight=${px(scroll.scrollHeight)}, clientHeight=${px(scroll.clientHeight)}` : 'no .fm-body',
  )
  if (scroll && scroll.scrollTop > 0) {
    check(
      mode,
      'reproducer: .fm-inner sits above the viewport top (negative y) after the scroll',
      Boolean(scroll.inner && scroll.inner.y < 0),
      scroll.inner ? `inner.y=${px(scroll.inner.y)}, inner.h=${px(scroll.inner.height)}` : 'no .fm-inner',
    )
  } else {
    skip(mode, 'reproducer: .fm-inner sits above the viewport top', 'the fixture session has no scrollable overlay body')
  }

  const probe = await probeBand(sim, points, BAND_TOP.darwin)
  report.darwin = {
    frame,
    points,
    scroll,
    initial,
    probe,
    screenshot: await sim.screenshot('drag-band-darwin-scrolled.png'),
  }

  console.log(
    `  ℹ app-region inheritance: native window-drag=${probe.nativeInheritance} (${
      probe.nativeInheritance ? 'this Chromium inherits it natively' : 'legacy non-inherited app-region: the helper reconstructs Electron’s inherited value'
    })`,
  )
  checkAllStrip(mode, probe, 'every band probe point resolves to the strip', points)

  // The fix's whole point: later overlay descendants must not sit after the strip.
  check(
    mode,
    'no no-drag rect over the band comes AFTER the strip',
    probe.band && probe.band.noDragAfterStrip === 0,
    probe.band
      ? `${probe.band.noDragAfterStrip} after, ${probe.band.noDragBeforeStrip} before, ${probe.band.noDragOverlapping} overlapping total`
      : 'no band diagnostics',
  )
  check(
    mode,
    'NON-VACUOUS: no-drag rects over the band exist before the strip (ordering matters)',
    probe.band && probe.band.noDragBeforeStrip > 0,
    probe.band ? `${probe.band.noDragBeforeStrip} no-drag rect(s) overlap the band before the strip` : 'no band diagnostics',
  )
  check(
    mode,
    'NON-VACUOUS: the pre-fix culprit classes (.fm-inner/.fm-msg/.fm-rail-slot) overlap the band',
    probe.band && probe.band.culprits.length > 0,
    probe.band && probe.band.culprits.length
      ? probe.band.culprits.map((region) => `${short(region.cls, 46)}${region.inherited ? '*' : ''}`).join(', ')
      : 'none — session content did not overlap the band',
  )
  if (scroll && scroll.scrollTop > 0) {
    check(
      mode,
      'NON-VACUOUS: scrolled content rects overlap the band',
      probe.band && probe.band.scrolled > 0,
      probe.band ? `${probe.band.scrolled} no-drag rect(s) with negative-y/above-band boxes` : 'no band diagnostics',
    )
  } else {
    skip(mode, 'NON-VACUOUS: scrolled content rects overlap the band', 'the fixture session has no scrollable overlay body')
  }
  console.log(
    `  ℹ natural overlap: bubbles=${scenario.state.bubbles}, rail=${probe.band?.culprits.some((region) => /fm-rail/.test(region.cls)) ?? false}, ` +
      `scrolled no-drag rects over band=${probe.band?.scrolled ?? 0}`,
  )

  // ── 2. optional: probe again with the turn rail mounted ─────────────────
  {
    const rail = await sim.page.waitForSelector('.fm-rail-slot, .fm-rail', { state: 'attached', timeout: RAIL_WAIT_MS }).catch(() => null)
    if (rail) {
      const railProbe = await probeBand(sim, points, BAND_TOP.darwin)
      checkAllStrip(mode, railProbe, 'with the turn rail mounted, every band point still resolves to the strip', points)
      check(
        mode,
        'the turn-rail wrapper overlaps the band as a no-drag rect (the reported culprit)',
        Boolean(railProbe.band && railProbe.band.culprits.some((region) => /fm-rail/.test(region.cls))),
        railProbe.band && railProbe.band.culprits.length
          ? railProbe.band.culprits.map((region) => short(region.cls, 46)).join(', ')
          : 'no culprit rects',
      )
      report.darwin.railProbe = railProbe
    } else {
      skip(mode, 'turn-rail band probe', `.fm-rail-slot/.fm-rail did not render within ${RAIL_WAIT_MS}ms`)
    }
  }

  // ── 3. test-only ordering control (works even on a thin fixture) ────────
  // A synthetic no-drag rect flush with the band: inserted just BEFORE the
  // strip (like every real overlay child) it must lose; moved AFTER the strip
  // (the pre-fix ordering, where later content beat the first-child strip) it
  // must win. This proves the emulation catches the regression without
  // depending on whether the fixture session has content.
  console.log('\n── ordering control (synthetic, removed afterwards) ──')
  const controlResult = { beforeStrip: null, afterStrip: null, restored: null, children: {} }
  try {
    controlResult.children.before = await insertBandControl(sim, BAND_TOP.darwin, 'before-strip')
    await sim.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    controlResult.beforeStrip = await probeBand(sim, points, BAND_TOP.darwin)
    check(
      mode,
      'CONTROL: a no-drag rect just before the strip does not cancel the band',
      controlResult.beforeStrip.probes.every((item) => item.draggable && /fm-frame-strip/.test(item.winner?.cls || '')),
      `children=${controlResult.children.before.join(' < ')}`,
    )

    controlResult.children.after = await insertBandControl(sim, BAND_TOP.darwin, 'after-strip')
    await sim.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    controlResult.afterStrip = await probeBand(sim, points, BAND_TOP.darwin)
    const cancelled = controlResult.afterStrip.probes.filter((item) => !item.draggable && item.winner && item.winner.region === 'no-drag').length
    check(
      mode,
      'CONTROL: the same no-drag rect AFTER the strip cancels the band (old ordering fails)',
      cancelled === points.length,
      `${cancelled}/${points.length} points no-drag; winner: ${describeWinner(controlResult.afterStrip.probes[0]?.winner)}`,
    )
    check(
      mode,
      'CONTROL: band diagnostics report no-drag rects after the strip while the control is there',
      Boolean(controlResult.afterStrip.band && controlResult.afterStrip.band.noDragAfterStrip > 0),
      controlResult.afterStrip.band
        ? `${controlResult.afterStrip.band.noDragAfterStrip} after, ${controlResult.afterStrip.band.noDragBeforeStrip} before`
        : 'no band diagnostics',
    )

    controlResult.children.restored = await removeBandControl(sim)
    await sim.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    controlResult.restored = await probeBand(sim, points, BAND_TOP.darwin)
    check(
      mode,
      'CONTROL: removing the synthetic rect restores the strip as the last word',
      controlResult.restored.probes.every((item) => item.draggable && /fm-frame-strip/.test(item.winner?.cls || '')) &&
        controlResult.restored.overlay?.stripIsLastChild === true,
      `children=${controlResult.children.restored.join(' < ')}`,
    )
  } finally {
    if (controlResult.children.restored === null) {
      controlResult.children.restored = await removeBandControl(sim).catch(() => [])
    }
  }
  report.control = controlResult

  // ── 4. win32: shared renderer path, 60px strip ──────────────────────────
  {
    const winMode = 'win32'
    console.log(`\n── ${winMode} (data-windows-titlebar, reserved band ${BAND_TOP.win32}px) ──`)
    await sim.applyFrame({ platform: 'win32' })
    await sleep(300)
    const winState = await overlayState(sim)
    const winFrame = await sim.frameState()
    const winPoints = bandPoints(winFrame.viewport.width)
    const winProbe = await probeBand(sim, winPoints, BAND_TOP.win32)

    check(winMode, 'html carries data-windows-titlebar', winFrame.dataset.windowsTitlebar === true)
    check(
      winMode,
      'official --dsh-frame-top-clearance is the 40px native titlebar',
      winFrame.vars['--dsh-frame-top-clearance'] === '40px',
      winFrame.vars['--dsh-frame-top-clearance'],
    )
    check(
      winMode,
      'official --dsh-windows-titlebar-height resolves to 40px',
      winFrame.vars['--dsh-windows-titlebar-height'] === '40px',
      winFrame.vars['--dsh-windows-titlebar-height'],
    )
    check(winMode, 'frame strip exists in the win32 frame', Boolean(winState.strip))
    if (winState.strip) {
      check(winMode, 'frame strip is still the overlay’s LAST child', winState.strip.isLastChild, `childIndex=${winState.strip.childIndex}`)
      check(
        winMode,
        'frame strip height equals the reserved band (60px)',
        approx(winState.strip.rect.height, BAND_TOP.win32),
        `h=${px(winState.strip.rect.height)}`,
      )
      check(winMode, 'frame strip is a drag region', winState.strip.appRegion === 'drag', `app-region=${winState.strip.appRegion}`)
    } else {
      check(winMode, 'frame strip height equals the reserved band (60px)', false, 'no .fm-frame-strip element')
    }
    check(winMode, 'overlay renders ≥1 user bubble', winState.bubbles >= 1, `${winState.bubbles} bubble(s)`)
    checkAllStrip(winMode, winProbe, 'every win32 band probe point resolves to the strip', winPoints)
    check(
      winMode,
      'no no-drag rect over the win32 band comes AFTER the strip',
      winProbe.band && winProbe.band.noDragAfterStrip === 0,
      winProbe.band ? `${winProbe.band.noDragAfterStrip} after, ${winProbe.band.noDragOverlapping} overlapping total` : 'no band diagnostics',
    )
    report.win32 = { frame: winFrame, points: winPoints, state: winState, probe: winProbe, screenshot: await sim.screenshot('drag-band-win32-scrolled.png') }
  }

  // ── 5. teardown: the keyboard exit still works ─────────────────────────
  {
    const esc = await sim.exitOverlay()
    check('win32', 'Esc exits the overlay', esc.exited, `${esc.presses} press(es)`)
    if (esc.exited) {
      const gone = await sim.page.evaluate(() => document.querySelectorAll('.fm-overlay').length)
      check('win32', 'no overlay remains after Esc', gone === 0, `${gone} overlay(s)`)
    }
  }
} catch (error) {
  counts.fail++
  failures.push(`harness: ${error.message}`)
  console.error(`\n✗ harness failure: ${error.stack || error.message}`)
} finally {
  if (sim) {
    const diagnostics = sim.diagnostics()
    report.diagnostics = { pageErrors: diagnostics.pageErrors, focusOverlayErrors: diagnostics.focusOverlayErrors }
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
console.log('\n=== drag-band regression ===')
console.log(`scenario: ${report.scenario ? `“${report.scenario.session}” (rich=${report.scenario.rich}, ${report.scenario.attempts.length} session attempt(s))` : '(none)'}`)
console.log(`checks: ${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped`)
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
try {
  const reportPath = join(ensureOutDir(), 'drag-band-report.json')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\nreport: ${reportPath}`)
} catch (error) {
  console.log(`\n(could not write JSON report: ${error.message})`)
}
console.log(`\nRESULT: ${green ? 'GREEN — the focus band stays a drag region under later no-drag rects' : 'RED'}`)
process.exitCode = green ? 0 : 1
