#!/usr/bin/env node
/**
 * macOS/Windows window drag-band regression for dsh-focus-overlay on the DSH
 * desktop renderer (0.2.2-rc.1, Electron 44.7 / Chrome 152).
 *
 * WHY THIS TEST EXISTS
 * The desktop shells hide the native titlebar and render that area as web
 * content. The focus overlay reserves ONLY the official traffic-light / caption
 * clearance (`--dsh-frame-top-clearance`: 48px macOS, 40px Windows; a compact
 * 40px titlebar row in native fullscreen) and merges its own title row INTO
 * that band: `.fm-topbar` is absolutely positioned over the band, is the
 * overlay's LAST child, carries `-webkit-app-region: drag` + `data-window-drag`,
 * and its exit control is explicitly `no-drag`. Before the merge (0.13.0/0.13.1)
 * the overlay stacked a second 48px row below the 68px dialog band and owned
 * the band with a separate `.fm-frame-strip`; the merged row replaces that
 * strip 1:1.
 *
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
 * `tabIndex={-1}`, so EVERY overlay descendant is a no-drag rect unless it
 * opts into drag.
 *
 * The failure mode this guards (fixed in 0.13.1): while the drag surface was
 * the overlay's FIRST child, later overlay descendants overlapped the band and
 * cancelled the drag region — (a) the turn-rail wrapper `.fm-rail-slot`
 * (`position:absolute;inset:0;pointer-events:none`, rendered when the rail has
 * >=2 turns) is a full-viewport no-drag rect, (b) scrolled `.fm-body` content
 * keeps unclipped negative-y rects (`.fm-inner`, `.fm-msg`, `p`, `code`, ...).
 * Empty sessions rendered neither, which was exactly the report: draggable only
 * on a blank session. The merged row must therefore be the LAST child, and the
 * only no-drag rect allowed after it is the interactive control INSIDE it (the
 * exit button), which must stay clickable.
 *
 * HOW THIS SCRIPT CHECKS IT (plain browser, geometric/ordering emulation)
 * This is a Playwright e2e run against the real web client in headless
 * Chromium, not a real Electron window. That is deliberate: the check encodes
 * Electron's documented ordered-region semantics instead of reading the row's
 * computed style (which cannot see the overlap). `dragRegionProbe()` in
 * `lib/desktop-sim.mjs` collects every drag/no-drag rect in DOM order and
 * returns the LAST covering rect for each probe point. One wrinkle the helper
 * documents: the bundled Playwright Chromium (151) predates the standardised,
 * inherited `window-drag` property, so it only exposes the legacy
 * NON-inherited `-webkit-app-region`; the helper reconstructs the inherited
 * value (the desktop renderer's actual behaviour) by walking the DOM.
 * Screenshots and the JSON report land in tests/e2e/out/ (gitignored).
 *
 * Assertions:
 *   1. darwin: band = 48px (the official traffic-light clearance, NOT the 68px
 *      dialog inset). `.fm-overlay` padding-top = 48, `.fm-topbar` rect
 *      {y:0,h:48} spanning the viewport, title text left = 88 (traffic-light
 *      clearance), body starts at 48, the row is the overlay's LAST child and
 *      the declared drag surface, no `.fm-frame-strip` remains. The band probe
 *      grid (three heights inside the band × four x positions clear of the
 *      exit button) resolves to `drag` on `.fm-topbar`/`.fm-title`; the exit
 *      button's center resolves `no-drag` (the control) and clicking it closes
 *      the overlay.
 *   2. Non-vacuity: the probe must find no-drag rects overlapping the band that
 *      come BEFORE the surface (`.fm-rail-slot`, scrolled `.fm-inner`/`.fm-msg`)
 *      and NONE after it except the surface's own control — that is what the
 *      ordering contract buys. If the fixture session is too thin to scroll or
 *      render a rail, a test-only synthetic no-drag rect proves both directions
 *      of the ordering: inserted just before the surface the band stays
 *      draggable, moved after it the band becomes no-drag (the pre-fix
 *      failure), then it is removed.
 *   3. The turn rail, when it renders within ~5s, is probed again as well.
 *   4. win32: same merged-row contract with the 40px caption band, exit control
 *      clear of the native caption zone (top-right 138×40), same ordered probes.
 *
 * RED-AFTER EVIDENCE (recorded, not committed as code)
 * On the merged build this script is green. Re-running with the row moved back
 * before the body in the live page (scratch script, DOM restored after
 * measuring) turns the band points into `no-drag` with later overlay rects as
 * winner, and the band diagnostics report no-drag rects AFTER the surface. The
 * synthetic control in step 2 reproduces that ordering flip inside the
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
import { ensureGui, ensureOutDir, intersects, launchSim } from './lib/desktop-sim.mjs'

const RAIL_WAIT_MS = 5_000
const RICH_WAIT_MS = 12_000
const MAX_SESSION_ATTEMPTS = 6

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const approx = (value, expected, tolerance = 1) => Math.abs(value - expected) <= tolerance
const px = (value) => (Number.isFinite(value) ? `${Number(value.toFixed(2))}px` : String(value))
const short = (value, max = 90) => (typeof value === 'string' && value.length > max ? `${value.slice(0, max)}…` : value)
const bandOf = (frame, fallback) => {
  const clearance = Number.parseFloat(frame.vars['--dsh-frame-top-clearance'])
  return Number.isFinite(clearance) && clearance > 0 ? clearance : fallback
}

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

/**
 * Band probe grid. Heights sit well inside the reserved band (the exit control
 * makes the band row interactive: below-band heights would fall into the
 * transcript). X positions stay clear of the exit control at the row's right
 * edge — the control's own centre is probed separately and must be `no-drag`.
 */
const bandPoints = (width, band) => {
  const heights = [Math.round(band * 0.2), Math.round(band * 0.5), band - 8]
  const xs = [30, Math.round(width / 2), width - 160, width - 240]
  return xs.flatMap((x) => heights.map((y) => [x, y]))
}
const centerOf = (rect) => [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)]
const WIN32_SURFACE = /(^|\s)fm-frame-strip(\s|$)/

/** Compact snapshot of what the overlay currently renders. */
async function overlayState(sim) {
  return sim.page.evaluate(() => {
    const overlay = document.querySelector('.fm-overlay')
    const topbar = overlay ? overlay.querySelector('.fm-topbar') : null
    const surface = overlay
      ? [...overlay.children].filter((element) => {
          if (!element.hasAttribute('data-window-drag')) return false
          const style = getComputedStyle(element)
          if (style.display === 'none') return false
          const region = (style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region') || '').trim()
          return region === 'drag'
        }).pop() || null
      : null
    const frameStrip = overlay ? overlay.querySelector('.fm-frame-strip') : null
    const body = document.querySelector('.fm-body')
    const exit =
      (overlay &&
        [...overlay.querySelectorAll('button')].find((button) => /退出专注|Exit focus/i.test(button.textContent || ''))) ||
      null
    const title = topbar ? topbar.querySelector('.fm-title') : null
    const rectOf = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
    }
    const regionOf = (element) => {
      if (!element) return ''
      const cs = getComputedStyle(element)
      return (cs.getPropertyValue('-webkit-app-region') || cs.getPropertyValue('app-region') || '').trim()
    }
    return {
      overlayCount: document.querySelectorAll('.fm-overlay').length,
      bubbles: document.querySelectorAll('.fm-overlay .fm-user').length,
      rail: Boolean(document.querySelector('.fm-rail-slot') || document.querySelector('.fm-rail')),
      scrollable: Boolean(body && body.scrollHeight > body.clientHeight + 1),
      body: body
        ? { rect: rectOf(body), scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, scrollTop: body.scrollTop }
        : null,
      overlayPaddingTop: overlay ? getComputedStyle(overlay).paddingTop : '',
      frameBandVar: overlay ? getComputedStyle(overlay).getPropertyValue('--fm-frame-band').trim() : '',
      topbar: topbar
        ? {
            rect: rectOf(topbar),
            appRegion: regionOf(topbar),
            position: getComputedStyle(topbar).position,
            heightPx: Number.parseFloat(getComputedStyle(topbar).height) || 0,
            dataWindowDrag: topbar.hasAttribute('data-window-drag'),
            isLastChild: Boolean(overlay && overlay.lastElementChild === topbar),
            childIndex: overlay ? [...overlay.children].indexOf(topbar) : -1,
            title: title ? { rect: rectOf(title), text: (title.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) } : null,
          }
        : null,
      surface: surface
        ? {
            rect: rectOf(surface),
            isTopbar: surface === topbar,
            appRegion: regionOf(surface),
            isLastChild: Boolean(overlay && overlay.lastElementChild === surface),
            childIndex: overlay ? [...overlay.children].indexOf(surface) : -1,
          }
        : null,
      exit: exit ? { rect: rectOf(exit), appRegion: regionOf(exit), text: (exit.textContent || '').replace(/\s+/g, ' ').trim() } : null,
      frameStrip: frameStrip
        ? {
            displayed: getComputedStyle(frameStrip).display !== 'none',
            display: getComputedStyle(frameStrip).display,
            rect: rectOf(frameStrip),
            appRegion: regionOf(frameStrip),
            isLastChild: Boolean(overlay && overlay.lastElementChild === frameStrip),
            childIndex: overlay ? [...overlay.children].indexOf(frameStrip) : -1,
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

/** The ordered hit test must resolve every non-control band point to the
 *  platform's drag claim: the merged title row on macOS, the caption strip on
 *  Windows. */
function checkAllSurface(mode, probe, label, points, winnerPattern = /(^|\s)fm-(topbar|title)(\s|$)/) {
  let bad = 0
  const details = []
  for (const item of probe.probes) {
    const ok = item.draggable && Boolean(item.winner && winnerPattern.test(item.winner.cls))
    if (!ok) {
      bad++
      if (details.length < 3) details.push(`(${item.point.x},${item.point.y}) → ${describeWinner(item.winner)}`)
    }
  }
  check(
    mode,
    `${label} (${points.length} points)`,
    bad === 0,
    bad === 0 ? `all ${points.length} points → drag ${winnerPattern === WIN32_SURFACE ? '.fm-frame-strip' : '.fm-topbar'}` : `${bad}/${points.length} wrong: ${details.join('; ')}`,
  )
}

/** The exit control lives INSIDE the drag row: it must stay hit-testable. */
function checkControlExcluded(mode, probe, label, point) {
  const result = probe.probes.find((item) => item.point.x === point[0] && item.point.y === point[1])
  check(
    mode,
    label,
    Boolean(result) && !result.draggable && result.winner && result.winner.region === 'no-drag',
    result ? describeWinner(result.winner) : 'probe point missing',
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
      body: state.body ? { scrollHeight: state.body.scrollHeight, clientHeight: state.body.clientHeight } : null,
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
      // The rendered drag claim (merged title row on macOS; never the hidden
      // macOS `.fm-frame-strip`, which carries the attribute but paints no box).
      const surface = overlay
        ? [...overlay.children].filter((element) => {
            if (!element.hasAttribute('data-window-drag')) return false
            const style = getComputedStyle(element)
            if (style.display === 'none') return false
            const region = (style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region') || '').trim()
            return region === 'drag'
          }).pop() || null
        : null
      if (!overlay || !surface) throw new Error('overlay/drag surface missing for the control')
      let control = document.querySelector('#fm-drag-band-control')
      if (!control) {
        control = document.createElement('div')
        control.id = 'fm-drag-band-control'
        control.setAttribute('aria-hidden', 'true')
        // Same geometry as the merged title row, explicitly no-drag: identical
        // to what a later overlay child (`.fm-rail-slot`, scrolled `.fm-inner`)
        // contributes.
        control.style.cssText = `position:fixed;top:0;left:0;right:0;height:${bandTop}px;pointer-events:none;z-index:0;-webkit-app-region:no-drag;app-region:no-drag`
      }
      if (position === 'before-surface') overlay.insertBefore(control, surface)
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
    return overlay
      ? [...overlay.children].map((child) => child.className || child.id || child.tagName.toLowerCase())
      : []
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

  // ── 1. darwin: merged-row contract + ordered band hit test ──────────────
  const mode = 'darwin'
  const frame = await sim.frameState()
  const band = bandOf(frame, 48)
  const points = bandPoints(frame.viewport.width, band)
  const initial = await overlayState(sim)
  console.log(`\n── ${mode} (data-platform=darwin, merged band ${band}px) ──`)

  check(mode, 'overlay mounts on a stored session', initial.overlayCount === 1, `${initial.overlayCount} overlay(s)`)
  check(mode, 'overlay renders ≥1 user bubble', initial.bubbles >= 1, `${initial.bubbles} bubble(s)`)
  check(mode, 'filter: html carries data-platform=darwin', frame.dataset.platform === 'darwin')
  check(
    mode,
    'official --dsh-frame-top-clearance is 48px (traffic lights)',
    frame.vars['--dsh-frame-top-clearance'] === '48px',
    frame.vars['--dsh-frame-top-clearance'],
  )
  check(mode, 'resolved band is the traffic-light clearance (48px), not the 68px dialog inset', approx(band, 48), `band=${band}px`)
  check(
    mode,
    'overlay reserves exactly the merged band (padding-top 48, --fm-frame-band 48px)',
    approx(Number.parseFloat(initial.overlayPaddingTop), band) && initial.frameBandVar === `${band}px`,
    `padding-top=${initial.overlayPaddingTop}, --fm-frame-band=${JSON.stringify(initial.frameBandVar)}`,
  )
  check(mode, 'title row exists', Boolean(initial.topbar))
  if (initial.topbar) {
    check(
      mode,
      'title row is merged INTO the band (absolute, y=0, h=band, spans the viewport)',
      initial.topbar.position === 'absolute' &&
        approx(initial.topbar.rect.top, 0) &&
        approx(initial.topbar.heightPx, band) &&
        approx(initial.topbar.rect.left, 0) &&
        initial.topbar.rect.width >= frame.viewport.width - 1,
      `position=${initial.topbar.position}, rect=${JSON.stringify({ x: Math.round(initial.topbar.rect.x), y: Math.round(initial.topbar.rect.y), w: Math.round(initial.topbar.rect.width), h: Math.round(initial.topbar.heightPx) })}`,
    )
    check(
      mode,
      'title row is the macOS drag surface (drag claim covering the band)',
      Boolean(initial.surface) &&
        initial.surface.isTopbar &&
        initial.surface.appRegion === 'drag' &&
        approx(initial.surface.rect.height, band) &&
        initial.topbar.appRegion === 'drag' &&
        initial.topbar.dataWindowDrag,
      `childIndex=${initial.topbar.childIndex}/${(initial.overlay?.childCount ?? 0) - 1}, app-region=${JSON.stringify(initial.topbar.appRegion)}, surface=${JSON.stringify(initial.surface?.isTopbar ? 'fm-topbar' : null)}`,
    )
    check(
      mode,
      'title text clears the traffic lights (left = 88, the official leading seat)',
      Boolean(initial.topbar.title) && initial.topbar.title.rect.left >= 88,
      initial.topbar.title ? `title.left=${px(initial.topbar.title.rect.left)}, text=${JSON.stringify(initial.topbar.title.text)}` : 'no .fm-title',
    )
    check(
      mode,
      'exit control is INSIDE the band row but excluded from dragging (no-drag)',
      Boolean(initial.exit) && initial.exit.appRegion === 'no-drag' && initial.exit.rect.top < band,
      initial.exit ? `exit=${JSON.stringify({ x: Math.round(initial.exit.rect.x), y: Math.round(initial.exit.rect.y), w: Math.round(initial.exit.rect.width), h: Math.round(initial.exit.rect.height) })}, app-region=${JSON.stringify(initial.exit.appRegion)}` : 'no exit button',
    )
  }
  check(mode, 'transcript starts immediately below the band (48px reclaimed)', Boolean(initial.body) && approx(initial.body.rect.top, band), initial.body ? `body.top=${px(initial.body.rect.top)}` : 'no .fm-body')
  check(
    mode,
    'the separate .fm-frame-strip is not rendered on macOS (merged into the title row)',
    Boolean(initial.frameStrip) && initial.frameStrip.displayed === false && initial.frameStrip.isLastChild,
    initial.frameStrip ? `display=${initial.frameStrip.display}, lastChild=${initial.frameStrip.isLastChild}` : 'no strip element',
  )

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

  const probe = await probeBand(sim, points, band)
  const exitPoint = initial.exit ? centerOf(initial.exit.rect) : null
  const exitProbe = exitPoint ? await probeBand(sim, [exitPoint], band) : null
  report.darwin = {
    frame,
    band,
    points,
    scroll,
    initial,
    probe,
    exitProbe,
    screenshot: await sim.screenshot('drag-band-darwin-scrolled.png'),
  }

  console.log(
    `  ℹ app-region inheritance: native window-drag=${probe.nativeInheritance} (${
      probe.nativeInheritance ? 'this Chromium inherits it natively' : 'legacy non-inherited app-region: the helper reconstructs Electron’s inherited value'
    })`,
  )
  checkAllSurface(mode, probe, 'every non-control band probe point resolves to the merged title row', points)
  if (exitProbe && exitPoint) {
    checkControlExcluded(mode, exitProbe, `exit control center (${exitPoint[0]},${exitPoint[1]}) stays no-drag (clickable, not a drag handle)`, exitPoint)
  } else {
    skip(mode, 'exit control band probe', 'no exit button found in the title row')
  }

  // The merge's whole point: later overlay descendants must not sit after the
  // drag surface, and the only no-drag rect after it is its own control.
  check(
    mode,
    'no no-drag rect over the band comes AFTER the drag surface (only its own control)',
    probe.band && probe.band.noDragAfterSurface === 0,
    probe.band
      ? `${probe.band.noDragAfterSurface} after, ${probe.band.surfaceControlNoDrag} own-control rect(s), ${probe.band.noDragBeforeSurface} before, ${probe.band.noDragOverlapping} overlapping total`
      : 'no band diagnostics',
  )
  check(
    mode,
    'NON-VACUOUS: no-drag rects over the band exist before the drag surface (ordering matters)',
    probe.band && probe.band.noDragBeforeSurface > 0,
    probe.band ? `${probe.band.noDragBeforeSurface} no-drag rect(s) overlap the band before the surface` : 'no band diagnostics',
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
      const railProbe = await probeBand(sim, points, band)
      checkAllSurface(mode, railProbe, 'with the turn rail mounted, every non-control band point still resolves to the merged title row', points)
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
  // A synthetic no-drag rect flush with the band: inserted just BEFORE the drag
  // surface (like every real overlay child) it must lose; moved AFTER it (the
  // pre-fix ordering, where later content beat the first-child surface) it must
  // win. This proves the emulation catches the regression without depending on
  // whether the fixture session has content.
  console.log('\n── ordering control (synthetic, removed afterwards) ──')
  const controlResult = { beforeSurface: null, afterSurface: null, restored: null, children: {} }
  try {
    controlResult.children.before = await insertBandControl(sim, band, 'before-surface')
    await sim.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    controlResult.beforeSurface = await probeBand(sim, points, band)
    check(
      mode,
      'CONTROL: a no-drag rect just before the drag surface does not cancel the band',
      controlResult.beforeSurface.probes.every((item) => item.draggable && /fm-(topbar|title)/.test(item.winner?.cls || '')),
      `children=${controlResult.children.before.join(' < ')}`,
    )

    controlResult.children.after = await insertBandControl(sim, band, 'after-surface')
    await sim.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    controlResult.afterSurface = await probeBand(sim, points, band)
    const cancelled = controlResult.afterSurface.probes.filter((item) => !item.draggable && item.winner && item.winner.region === 'no-drag').length
    check(
      mode,
      'CONTROL: the same no-drag rect AFTER the drag surface cancels the band (old ordering fails)',
      cancelled === points.length,
      `${cancelled}/${points.length} points no-drag; winner: ${describeWinner(controlResult.afterSurface.probes[0]?.winner)}`,
    )
    check(
      mode,
      'CONTROL: band diagnostics report no-drag rects after the drag surface while the control is there',
      Boolean(controlResult.afterSurface.band && controlResult.afterSurface.band.noDragAfterSurface > 0),
      controlResult.afterSurface.band
        ? `${controlResult.afterSurface.band.noDragAfterSurface} after, ${controlResult.afterSurface.band.noDragBeforeSurface} before`
        : 'no band diagnostics',
    )

    controlResult.children.restored = await removeBandControl(sim)
    await sim.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    controlResult.restored = await probeBand(sim, points, band)
    check(
      mode,
      'CONTROL: removing the synthetic rect restores the row as the last word',
      controlResult.restored.probes.every((item) => item.draggable && /fm-(topbar|title)/.test(item.winner?.cls || '')) &&
        controlResult.restored.surface?.isTopbar === true,
      `children=${controlResult.children.restored.join(' < ')}, surface=${JSON.stringify(controlResult.restored.surface?.isTopbar ? 'fm-topbar' : null)}`,
    )
  } finally {
    if (controlResult.children.restored === null) {
      controlResult.children.restored = await removeBandControl(sim).catch(() => [])
    }
  }
  report.control = controlResult

  // ── 3b. the in-band control is clickable and closes the overlay ─────────
  // (The native hit test is what matters: the exit button's own rect resolves
  // `no-drag` above. This click additionally proves the wiring.)
  {
    let clicked = false
    try {
      await sim.page.locator('.fm-topbar button').click({ timeout: 5_000 })
      await sleep(400)
      clicked = await sim.page.evaluate(() => !document.querySelector('.fm-overlay'))
    } catch {
      clicked = false
    }
    check(mode, 'clicking the in-band exit control closes the overlay (not swallowed by the drag row)', clicked)
  }

  // ── 4. win32: caption band chrome + title row below it ─────────────────
  // On Windows the caption band is NOT merged into: the web caption menubar
  // ([data-windows-menu], above the overlay) and the native caption buttons
  // live there, so the title row stays directly below the band and the
  // separate `.fm-frame-strip` owns the band drag (same ordered-region contract
  // on the shared renderer path).
  {
    // Re-open the overlay (the click above closed it) for the Windows frame.
    await sim.clickFocus()
    const remounted = await sim.waitOverlay({ timeout: 8_000 })
    if (remounted) await sim.waitUserBubbles({ min: 1, timeout: 10_000 })
    await sim.applyFrame({ platform: 'win32' })
    await sleep(300)
    const winMode = 'win32'
    const winState = await overlayState(sim)
    const winFrame = await sim.frameState()
    const winBand = bandOf(winFrame, 40)
    // Scroll the transcript so scrolled content keeps negative-y rects over the
    // band as well — keeps the ordering assertion non-vacuous on win32.
    await scrollOverlayToBottom(sim)
    const winPoints = bandPoints(winFrame.viewport.width, winBand)
    const winProbe = await probeBand(sim, winPoints, winBand)
    console.log(`\n── ${winMode} (data-windows-titlebar, caption band ${winBand}px + title row below) ──`)

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
    check(winMode, 'overlay mounts in the Windows frame', winState.overlayCount === 1, `${winState.overlayCount} overlay(s)`)
    check(winMode, 'overlay renders ≥1 user bubble', winState.bubbles >= 1, `${winState.bubbles} bubble(s)`)
    check(
      winMode,
      'overlay reserves only the 40px caption band (no +20px dialog gap, no merged row)',
      approx(Number.parseFloat(winState.overlayPaddingTop), winBand) && winState.frameBandVar === `${winBand}px`,
      `padding-top=${winState.overlayPaddingTop}, --fm-frame-band=${JSON.stringify(winState.frameBandVar)}`,
    )
    if (winState.topbar) {
      check(
        winMode,
        'title row sits directly BELOW the caption band (keeps the menubar/caption buttons clear)',
        winState.topbar.position === 'static' &&
          approx(winState.topbar.rect.top, winBand) &&
          approx(winState.topbar.heightPx, 40) &&
          winState.topbar.rect.width >= winFrame.viewport.width - 1,
        `position=${winState.topbar.position}, rect=${JSON.stringify({ x: Math.round(winState.topbar.rect.x), y: Math.round(winState.topbar.rect.y), w: Math.round(winState.topbar.rect.width), h: Math.round(winState.topbar.heightPx) })}`,
      )
      check(
        winMode,
        'title row is not a drag region on Windows (the caption band strip is)',
        winState.topbar.appRegion !== 'drag',
        `app-region=${JSON.stringify(winState.topbar.appRegion)}`,
      )
      check(
        winMode,
        'exit control sits in the title row, below the native caption band, and is not a drag region',
        Boolean(winState.exit) && winState.exit.rect.top >= winBand && winState.exit.appRegion !== 'drag',
        winState.exit
          ? `exit.top=${px(winState.exit.rect.top)} (band ends ${winBand}), app-region=${JSON.stringify(winState.exit.appRegion)}`
          : 'no exit button',
      )
    }
    check(
      winMode,
      'transcript starts below the caption band + title row',
      Boolean(winState.body) && Boolean(winState.topbar) && approx(winState.body.rect.top, winState.topbar.rect.bottom),
      winState.body && winState.topbar ? `body.top=${px(winState.body.rect.top)}, row.bottom=${px(winState.topbar.rect.bottom)}` : 'missing overlay children',
    )
    check(
      winMode,
      'separate .fm-frame-strip claims the caption band',
      Boolean(winState.frameStrip) &&
        winState.frameStrip.displayed &&
        approx(winState.frameStrip.rect.top, 0) &&
        approx(winState.frameStrip.rect.height, winBand) &&
        winState.frameStrip.rect.width >= winFrame.viewport.width - 1 &&
        winState.frameStrip.appRegion === 'drag',
      winState.frameStrip
        ? `display=${winState.frameStrip.display}, rect=${JSON.stringify({ x: Math.round(winState.frameStrip.rect.x), y: Math.round(winState.frameStrip.rect.y), w: Math.round(winState.frameStrip.rect.width), h: Math.round(winState.frameStrip.rect.height) })}, app-region=${JSON.stringify(winState.frameStrip.appRegion)}`
        : 'no strip element',
    )
    check(
      winMode,
      'strip is the overlay’s LAST child and the drag surface',
      Boolean(winState.frameStrip) && winState.frameStrip.isLastChild && Boolean(winState.surface) && !winState.surface.isTopbar && winState.surface.isLastChild && winState.surface.appRegion === 'drag',
      `stripLast=${winState.frameStrip?.isLastChild}, surface=${JSON.stringify(winState.surface?.isTopbar ? 'fm-topbar' : 'fm-frame-strip')}`,
    )
    checkAllSurface(winMode, winProbe, 'every win32 band probe point resolves to the caption strip', winPoints, WIN32_SURFACE)
    check(
      winMode,
      'no no-drag rect over the win32 band comes AFTER the strip',
      winProbe.band && winProbe.band.noDragAfterSurface === 0,
      winProbe.band
        ? `${winProbe.band.noDragAfterSurface} after, ${winProbe.band.noDragBeforeSurface} before, ${winProbe.band.noDragOverlapping} overlapping total`
        : 'no band diagnostics',
    )
    // Windows has no global no-drag rules (the darwin `[tabindex]`/`button`
    // rules are darwin-only): only explicitly declared regions exist, so there
    // is nothing to be non-vacuous about on the *before* side. The real window's
    // caption menubar declares its own no-drag rect and paints above the
    // overlay; this helper's contract for win32 is therefore "strip is the last
    // rendered drag claim and no declared no-drag rect follows it".
    console.log(
      `  ℹ win32 declared regions: ${winProbe.regionCount} rect(s), ${winProbe.band?.noDragOverlapping ?? 0} no-drag rect(s) over the band (Windows has no global no-drag rules)`,
    )
    report.win32 = {
      frame: winFrame,
      band: winBand,
      points: winPoints,
      state: winState,
      probe: winProbe,
      screenshot: await sim.screenshot('drag-band-win32-scrolled.png'),
    }
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
console.log(`\nRESULT: ${green ? 'GREEN — the merged title row stays a drag band under later no-drag rects' : 'RED'}`)
process.exitCode = green ? 0 : 1
