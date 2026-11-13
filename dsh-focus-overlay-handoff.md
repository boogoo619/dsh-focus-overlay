# Handoff — dsh-focus-overlay (focus-mode bundle plugin)

## Fix — window drag band dead on sessions WITH content (2026-11-13)

**Symptom (user report, macOS desktop app):** after entering focus mode the
window could no longer be dragged by the top band on a session that has
conversation content; a blank session could be dragged. Windows untested by the
user, but the renderer path is shared.

**Root cause — drag-region overlap order.** Electron hit-tests a frameless
window against the renderer's ordered list of CSS `app-region` rects. The
renderer sends them in layout-tree (= DOM) order, parent before child, and the
browser keeps "a `drag` rect adds its area, a `no-drag` rect removes it; where
rects overlap the LATER rect wins" (Electron
`shell/browser/ui/drag_util.cc::DraggableRegionsToSkRegion`; renderer order =
Blink `LocalFrameView::CollectDraggableRegions` pre-order). Two facts compound:

1. `-webkit-app-region` is an **inherited** property, and the official darwin
   CSS marks `[tabindex]` (among buttons/inputs/roles) `no-drag`. The focus
   overlay root is `tabIndex={-1}`, so **every descendant of `.fm-overlay` is a
   no-drag rect**.
2. `.fm-frame-strip` (the drag surface covering the reserved desktop titlebar
   band, 68px darwin / 60px win32) was the overlay's **first** child, so any
   later overlay descendant whose layout rect overlaps that band cancelled it.
   Layout rects are **not clipped** by ancestor overflow, so:
   - the turn-rail wrapper `.fm-rail-slot` (`position:absolute;inset:0;
     pointer-events:none`; renders once the rail has ≥2 turns) is a
     full-viewport no-drag rect — it wins the band at every point;
   - the scrolled `.fm-body` flow keeps negative-y absolute rects
     (`.fm-inner`, `.fm-msg`, paragraphs, inline code) after the overlay
     scrolls to its anchor.

A blank session renders neither, so the strip was the last rect over the band
and dragging worked — exactly the reported split.

**Evidence (real Electron window, not simulation).** An isolated second
instance of the packaged app was launched with
`--remote-debugging-port=9334`, `DSH_HOME=/tmp/dsh-home-appclone` (clone of
`~/.dsh`, never the live home) and driven over CDP. Measured with an emulation
of the ordered region hit test (computed `app-region` rects in DOM order, last
cover wins): **with content** every band probe point (y=10/30/50, x=30, vw/2,
vw-30, vw-140 at 1280×820, `data-platform=darwin` from the real preload)
resolved to `no-drag <div class="fm-rail-slot">` (and `.fm-inner` at y=-1245
for the scrolled case) while `.fm-frame-strip` was `drag` at 0,0 1280×68; the
**blank draft session** resolved to `drag .fm-frame-strip` and carried neither
element. This matches the user's report exactly.

**Fix:** `.fm-frame-strip` now renders as the overlay's **last** child (after
`{replyNotice}`), so its drag rect is the final word for the band; nothing
inside the overlay can override it any more. `src/client/FocusView.tsx` and
`src/client/styles.ts` document the ordering contract so it is not "tidied"
back to the top. No other behavior change: the strip is still `aria-hidden`,
non-focusable (a `tabindex` would match the darwin `no-drag` rule), paints
nothing, and collapses to 0px on the plain web.

**Verification:**
- Unit suite: 129/129 passing.
- **Real Electron window** (isolated second instance of the packaged app,
  `--remote-debugging-port` + CDP, preload markers at boot — never the live
  app): 43/43 checks. Content session (2 bubbles, rail mounted, `.fm-inner`
  y=-1245): all 12 reserved-band probe points resolve to `drag
  .fm-frame-strip`; 6436/6437 region rects precede it, zero after. Non-vacuity
  flip in the same live window: `insertBefore(strip, firstChild)` → 12/12
  points become `no-drag` with winner `.fm-rail-slot`; `appendChild(strip)` →
  12/12 back to `drag .fm-frame-strip`. Scrolled-content-only path (rail off,
  `.fm-inner` y=-1632) and the empty draft (hotkey F) are draggable too; Esc,
  re-open, no page/plugin console errors.
- **Playwright e2e regression** `tests/e2e/drag-band.mjs` (new; 35 checks, run
  twice green by its author and once by the Lead on a fresh isolated home, port
  3201): darwin 12/12 band points → strip; 82 no-drag rects over the band all
  BEFORE the strip, 0 after; win32 band 60px 12/12 → strip; a synthetic
  no-drag rect inserted before the strip keeps the band draggable while moving
  it after the strip flips all 12 points to no-drag (old-order failure,
  reproduced inside the committed test); red-before recorded by re-ordering the
  live DOM. `tests/e2e/lib/desktop-sim.mjs` gained
  `probeDragRegions()`/`sim.dragRegionProbe()` (ordered hit test + inherited
  `window-drag` reconstruction, because Playwright's Chromium 151 predates the
  inherited standard) and a behavior-preserving `storedSessions()` /
  `openStoredSession()` split. `desktop-frame.mjs`/`header-toggle.mjs`/
  `input-caret.mjs` unaffected.
- **Gap that let this ship broken in 0.13.0:** the previous desktop-frame check
  only read `getComputedStyle(strip)['-webkit-app-region']` and the strip's own
  geometry; it never emulated the ordered overlap that a `no-drag` rect later in
  the DOM performs. Any future window-chrome work must keep the drag band
  claimed by the last layout-tree element covering it.

**Rollout:** the desktop app caches the plugin client bundle at server start, so
the fix reaches the live app only after restarting DeepSeek Harness (a page
reload is not enough). Changes are uncommitted/unreleased (no version bump);
`lib/` rebuilt from `src/`.

## dsh desktop 0.2.2-rc.1 adaptation (2026-11-10)

**Target:** the new **DSH desktop app** (`/Applications/DeepSeek Harness.app`,
Electron shell `@deepseek-ai/dsh-desktop` 0.2.2-rc.1 + bundled
`@deepseek-ai/dsh-desktop-runtime` 0.2.2-rc.1). macOS and Windows ship the same
Electron renderer/shell JS, so one adaptation covers both; the app serves the
usual web UI (`DSH_PROFILE=desktop`, profile `~/.dsh/profiles/desktop`).

**Symptom:** on the desktop runtime, clicking「专注」did nothing for every session
that contains a user message. Console:
`[dsh-focus-overlay] overlay render failed; … TypeError:
(0 , _deepseek_ai_dsh_client_ui_primitives.projectUserText) is not a function`
— the overlay threw during the first user row (the old 0.1.3 `MessageText`
failure mode, one generation later). Even once rendered, the overlay covered the
desktop window chrome: the top bar sat under the macOS traffic lights / Windows
native titlebar and the window could not be dragged while focus was open.

**Causes (two independent changes):**

1. **`projectUserText` was removed from the primitives module in 0.2.2.** The
   official user-text pipeline moved to a slot/parser system; the primitives now
   export `UserTextRun` (plain inline run), `UserMessageBubble`,
   `ReferenceChip`, `extractMarkdownPlainText`, etc. A named import of the
   removed function is `undefined` → React #130 on the first user row.
   Fix: `src/client/primitives.ts` — `projectUserTextCompat` resolves the
   projection at runtime (`projectUserText` on 0.1.2–0.2.0 → `UserTextRun` on
   0.2.2+ → raw text), the same availability-fallback pattern as `icons.ts`.
   Cosmetic loss on 0.2.2: `@session` / `/skill` chips inside *user* text render
   as plain text (the new official parser lives in the conversation plugin and
   is not reachable across the client-bundle purity boundary).
2. **The desktop shell renders the hidden native titlebar area as web content.**
   0.2.2's `preload-app.cjs`/`lib/main.js` set `data-platform` (darwin/win32),
   `data-windows-titlebar` + `--dsh-windows-titlebar-height:40px` (Windows) and
   `data-fullscreen`; `dsh-client-ui-layout` exposes
   `--dsh-frame-top-clearance` / `--dsh-frame-chrome-top` /
   `--dsh-frame-overlay-top` (68px macOS, 60px Windows, 20px fullscreen) and a
   `[data-window-drag]{-webkit-app-region:drag}` drag contract. The overlay knew
   none of it. Fix: `.fm-overlay` pads `padding-top:var(--dsh-frame-overlay-top,
   0px)` and owns a top `.fm-frame-strip` (first child) with `data-window-drag`,
   `-webkit-app-region:drag`, `aria-hidden`, no `tabindex` (the darwin official
   CSS no-drags any `[tabindex]` element — adding one silently kills the drag
   region) and height = the same frame variable. Plain browsers have none of
   these variables → 0px fallback, layout unchanged.
3. **Windows promotes two official controls above the overlay.**
   `dsh-client-ui-sidebar` moves its sidebar-collapse toggle (always) and its
   new-session control (when the sidebar is collapsed / the window is narrower
   than 768px) into a `position:fixed; z-index:30` titlebar layer. Our overlay
   lives inside the official `shell.overlay` layer (`z-index:20`), so both
   floated over focus mode in the titlebar band; the toggle stole clicks/drags
   from the drag strip and a stray click on new-session switched sessions under
   the reader. Fix: `html[data-windows-titlebar] body[data-fm-focus]
   [data-sidebar-toggle]{display:none!important}` plus the same for
   `[class*="newSession"]` — exactly while focus is on; both return with the
   chrome on exit. macOS keeps them behind the overlay already. (The Windows
   caption *menubar* is intentionally left visible: it is native titlebar
   chrome, sits in the reserved band and does not occlude overlay content.)
4. **Assistant inline-code file chips were dead on every 0.2 build.**
   `chatFileMentions.forClosing` reads the turn's produced/presented files from
   `owner.turn.data.get('deliverables')`; the overlay passed a plain
   `{turn: {turn, step}}` owner, which threw inside the provider and was
   swallowed by the overlay's catch. Fix: `model.ts::fileMentionOwnerOf` resolves
   the real Turn face from the Chat snapshot's `timeline.turns` (matching the
   official ui-chat turn tail; closed turns only) and keeps the legacy owner
   shape for 0.1.x. Unit-tested; the live positive case needs a fresh turn with
   `deliverables.produced` data (the seeded sessions carry none), so it is
   contract-verified rather than click-verified.
5. **Queued badge source.** The session snapshot no longer carries `queue`;
   read the official input facade's `state.queue` first (old snapshot read kept
   as fallback), so「已排队 N」works again on 0.2.x.

**Also adapted:** `package.json` `dsh.compatibility.dshReleases` gains
`0.2.2-rc.1`; README.md / README.en.md document the desktop install path
(desktop profile is separate from `web`; install via Plugins page or
`dsh plugin --profile desktop add …`) and the window-chrome behavior.

**Verified on the 0.2.2 desktop runtime (isolated `dsh web` instance from the
app's own bundled runtime, plugin linked via a test profile):** overlay mounts
with `projectUserTextCompat` (user bubble renders, no pageerror); frame geometry
— darwin `.fm-topbar.y=68`/strip 68px, win32 `y=60`/strip 60px, fullscreen
`y=20`/strip 20px, plain web `y=0`/strip 0px, strip computed
`-webkit-app-region: drag` on darwin+win32, zero focusable children, no tabindex
(darwin's official `[tabindex]{-webkit-app-region:no-drag}` rule would kill the
drag region); exit button clear of the mac traffic-light box and the win caption
zone; Esc exits; win32 no element with fixed/sticky z≥20 paints above the
overlay; Plugins page detail renders the `plugins.bundle.config` card (all four
prefs); first-run intro renders; borrowed composer shares the official draft
(focus typing survives exit) and the fallback textarea keeps its mid-text
backspace/caret invariant; unit suite 125 passing.

New regression harness (added in this adaptation): `tests/e2e/lib/desktop-sim.mjs`
+ `tests/e2e/desktop-frame.mjs` — **99 assertions green**, run twice on freshly
spawned isolated instances: 5 frame modes (plain / darwin / darwin+fullscreen /
win32 / win32+fullscreen) plus 2 Windows collapsed-sidebar scenarios
(1280×820 user-collapsed and 520×600 narrow-window) covering the new-session
titlebar leak, the sidebar-toggle hide/restore and a generic "no fixed/sticky
z≥20 element paints above the overlay" guard (proven non-vacuous: dropping the
`body[data-fm-focus]` marker reproduces the two z-30 leaks). The harness spawns
or attaches to an isolated desktop-runtime instance and applies the desktop
markers after boot. `tests/e2e/header-toggle.mjs` and
`tests/e2e/input-caret.mjs` also accept the isolated instance through
`DSH_GUI_ORIGIN` (token URL) without changing their default 3080/cookie flow;
both are green on 0.2.2 (input-caret: 14/14 invariants). Unit suite: 129.
The two audits that drove the remaining fixes live in
`docs/contract-audit-0.2.2.md` and `docs/windows-desktop-audit.md`.

**Known limits of this verification:** the real Electron window cannot be
driven from a plain headless browser, so desktop chrome is validated by
applying the same `data-*` markers the preload writes *after* boot plus the
official shell/runtime code (applying them before boot breaks the official
shortcuts entry, which expects the Electron bridge); no physical Windows
machine was available — the Windows path is the same renderer JS plus
`data-windows-titlebar` simulation. The assistant file-mention owner fix
(`fileMentionOwnerOf`) is unit-tested and contract-matched to the official
ui-chat caller, but its live *positive* chip case needs a turn whose
`deliverables.produced` projection is non-empty; the seeded sessions carry
none, so it is not click-verified here (the previous state was a silently
swallowed TypeError on every 0.2 build — a pre-existing bug, not a 0.2.2
regression). Real-Windows-only checks (Microsoft Pinyin IME, native caption
buttons, the preload-injected caption menubar) are source/simulation-verified
only; see `docs/windows-desktop-audit.md` for the Windows release checklist.

## dsh 0.2 contract audit (2026-10-02, follow-up)

Full sweep of every dsh surface the plugin touches, verified against the
installed 0.2.0-rc.2 types/runtime and probed on the live GUI. Two robustness
fixes landed; everything else checked out.

**Verified compatible (field-by-field):**

- **Pending interactions.** 0.2 exposes them on `uiSession.sessionStatus`
  (`Map<id, {running, pendingInteraction, completionUnread}>`). `PendingQuestion`
  keeps `kind` ('question' | 'plan-review' — our card branches on `!isApproval`,
  so both land in the question flow), `questions` (`id/question/detail/header/
  options[{label,description}]/multiSelect/intent`), and `answer({answers:
  [{id, selected, custom}]})` — exactly what `encodeAnswer` builds.
  `PendingApproval` keeps `kind/toolName/reason` and
  `answer('allowed-once' | 'rejected')`.
- **Send paths.** `conversation.input.for(actx)` → `setDraft/submit('queue')/
  state` all present on `SessionInput`; the fallback `face.prompt(parts, 'queue')`
  matches `prompt(content, mode, signal?, requestId?)`.
- **Content nodes.** Every 0.2 `ConversationNode` kind is handled ('user',
  'steering', 'assistant', 'turn-error', 'turn-max-tokens' explicitly; 'tool-
  result', 'command', 'context', 'compaction', 'model-retry', 'unknown-surface'
  into the metric folder). `AssistantMessageNode.blocks/turn/step/interrupted`
  and block kinds ('text'/'reasoning'/'tool-call'/'image'/'other') unchanged.
- **Primitives.** `MarkdownLabels` still needs only `code.copyLabel/copiedLabel`
  + `footnotes`; `Button` variants 'primary'/'outline' + `size="sm"` + `icon`
  valid; `Modal headless` valid; `projectUserText(text, sessionLabels, …?)`
  unchanged.
- **Locale.** `ctx.locale.register(ns, dicts)` two-arg overload survives in the
  0.2 runtime (it branches on `typeof localeOrDicts === 'string'`).
- **CSS tokens.** Probed at the overlay's DOM position: every `--dsw-*` token we
  reference resolves on 0.2 (a `:root` probe is misleading — tokens are scoped
  lower). Only `--dsh-chat-flow-gap` is gone, and its single use carries a
  fallback. `[data-conversation-scroll]` (anchor capture) still exists.
- **Onboarding.** Live-verified on a fresh context: the intro modal appears on
  the empty hero (after the official `welcome-notice`/`deepseek-official` steps
  self-complete), and「打开设置」deep-links through
  `pluginNavigation.openBundle` to the Plugins page → bundle detail → config
  body. Note for testing: the e2e `openGui()` boilerplate seeds the `onboarded`
  flag — strip that line before testing the intro, or you'll conclude (as I
  first did) that it never appears.
- **Ledger.** `plugins.bundle.config` carries our `dsh-focus-overlay` key beside
  dshmarket's; `settings.plugin.item` is undeclared on 0.2 (expected no-op).

**Fixes from this audit:**

1. `openMentionedFile` now prefers the legacy `workspaces.openPath` when that
   verb exists and falls back to `sidebarRight.openResource` + the inlined
   `dsh-resource://file/session/…` address. 0.1.x also shipped a `sidebarRight`
   service whose address grammar may differ from the one we inline, and
   `workspaces.openPath` is a clean version discriminator (0.2's pure controller
   has no such verb) — so old builds keep their proven path.
2. `currentSessionIdOf` now prefers the *public* list-row read
   (`byId[id].retainedBy.mainView > 0`, the same read the official cordis
   inspector uses) over `uiSession.current`, which is typed **private** in 0.2
   even though it works at runtime. The private source stays as a guarded last
   resort.

**Known-unverifiable here (disclosed, not fixed):** the answer card has not been
exercised against a live pending question on 0.2 (contract matches exactly; the
render path is the same one 0.1.x used); no stored session rendered file-mention
chips, so the new `openResource` path is covered by the address-grammar unit
tests but not by a live click; 0.1.x backward compatibility is preserved by
guards and has not been regression-run on a real 0.1.x runtime.

## dsh 0.2.0-rc.2 adaptation (2026-10-02)

**Symptom:** upgrading to dsh 0.2 broke the whole web client. The GUI showed
"HARNESS — Failed to load plugins: web boot: 1 entry did not activate
dsh-focus-overlay: pending (waiting for service: settingsScope)", and the 专注
button/overlay/settings card were all absent. Separately, once the plugin did
activate, the overlay opened empty ("暂无打开的会话").

**Causes (four independent 0.2 contract changes):**

1. **`settingsScope` was removed from the client service registry.** dsh 0.2
   makes every client entry's activation mandatory: an injected service that
   never appears leaves the fiber *pending* and the web boot aborts with the
   message above. Fix: dropped it from `inject` and read it opportunistically
   (`ctx.get('settingsScope')`) so 0.1.x still gets it.
2. **The plugin settings page moved.** `settings.plugin.item` (Settings →
   Plugins, keyed tab) no longer exists. 0.2 configures a profile plugin on the
   **sidebar Plugins page**: a bundle registers `plugins.bundle.config` (keyed
   by npm package name) and the page renders it between the description and the
   row list. Fix: register *both* slots — each `slots.inject` is a no-op where
   its slot is undeclared, so one bundle serves both layouts. The intro's "open
   settings" now deep-links through `ctx.get('pluginNavigation').openBundle()`
   when present, else `openSection('plugins')`.
3. **The session list lost `current`, and `sessions.binding(id)` no longer
   materializes.** 0.2 publishes the viewed session as the `uiSession.current`
   main-binding source (a binding only exists while someone retains the session;
   the main view does). Fix: `currentSessionIdOf(listState, mainBinding)` reads
   `ls.current` (0.1.x) → binding `key`/`props.sessionId` (0.2) → the
   `retainedBy.mainView > 0` list scan, and both the watcher and the overlay
   subscribe to `sessions.list` **and** `uiSession.current`.
4. **Fixed-size icon primitives were removed.** `IconCheckOutline14`,
   `IconChevronDownOutline14`, `IconEditOutline16`, `IconSendOutline14` are gone
   in 0.2 (replaced by `…OutlineRegular`/`…Medium` + `size`). A stale named
   import is `undefined` → React #130 the moment it renders — the same failure
   mode as the 0.1.3 `MessageText` removal. Fix: `src/client/icons.ts` picks the
   first exported variant at runtime (namespace import), falling back to
   `() => null`.

**Also adapted:** pending interactions moved again — 0.2 exposes them on
`uiSession.sessionStatus` (`Map<sessionId, { running, pendingInteraction,
completionUnread }>`) instead of `uiSession.pendingInteractions`; the
`ui-chat.transcriptView` preference moved from `settingsScope` to
`configForms.get('ui-chat')` and widened to compact|standard|detailed|verbose
(legacy normal/expanded accepted); the Node half's `settings.register` no longer
exists in 0.2 (0.2's `ctx.settings` is a form service), and the guard already
no-ops there.

**Verified end-to-end on 0.2.0-rc.2** against the live GUI:
`tests/e2e/plugin-boot.mjs` (new — boot banner + activation + configuration
surface, red on the stale `settingsScope` inject), `tests/e2e/header-toggle.mjs`
(overlay mounts and renders user bubbles), `tests/e2e/input-caret.mjs` (both
borrow and fallback modes), `tests/e2e/star-fireworks.mjs` (Star button now
navigates through the new Plugins page). Unit suite: 119 passing.

## dsh 0.1.5-rc.1 adaptation (2026-09-10)

**Symptom:** after upgrading DSH, clicking the session-header 「专注」 button did
nothing. The button rendered and the click handler ran, but the overlay never
appeared; the console showed `[dsh-focus-overlay] overlay render failed; it will
retry on the next open  Error: Minified React error #130` (element type is
invalid → a component was `undefined`).

**Cause:** `@deepseek-ai/dsh-client-ui-primitives` **removed the `MessageText`
component**. Diffing the published package confirms it existed through
`0.1.2-rc.1` and was gone by `0.1.3-alpha.2`; `0.1.5-rc.1` still does not export
it. The plugin's user/steering row renderer imported `MessageText`, so it was
`undefined`, and the overlay threw as soon as it rendered a session containing a
user message. A blank session has no user rows, which is why the existing
`input-caret.mjs` loop (fresh session + `F` hotkey) stayed green and missed it.

**Fix:** render user text through the official **`projectUserText`** projection
instead — it has been exported continuously since `0.1.2-rc.1`
(`projectUserText(text, sessionLabels, slashNames?, slashKind?)`, the trailing
args optional), so one call covers every supported release. See `UserText` in
`src/client/FocusView.tsx`. `.fm-user` keeps supplying the bubble chrome and
`white-space: pre-wrap`.

**Regression loop:** `tests/e2e/header-toggle.mjs` — opens a stored session
*with history*, clicks the real header button (not the hotkey), and asserts the
overlay mounts and a user bubble renders. Verified red on the stale import
(React #130) and green after the fix.

**Not the cause:** the `dsh.compatibility.dshReleases` map stopping at
`0.1.3-alpha.1`. DSH does not read that field at all (nor does dshmarket); it is
informational for the plugin storefront. `0.1.5-rc.1` was added to it.

## dsh 0.1.2-rc.1 adaptation (2026-09-06, uncommitted)

Adapted the plugin to the 0.1.2 client rewrite. Verified end-to-end in a
headless browser against the live GUI (content renders, Esc exits, F hotkey
re-enters, settings card present). Key contract changes and where they are
handled:

- **Conversation content moved off the session snapshot.** The session face
  snapshot (`sessions.binding(id).session`) is now pure `SessionSnapshot`
  (running/queue/promptError/hasMore…). Content lives in the chat view:
  `ctx.uiConversation.binding(id).target('chat')` → `ChatSnapshot`, whose
  `legacy` slice (`{ nodes, partial, runningCalls }`) has the old shapes.
  Subscribing the target *activates* it. Adapter: `legacySliceOf()` (model.ts);
  hooks `useChatView` (FocusView.tsx).
- **History is paged by turns now.** A fresh binding materializes only the
  tail window (user prompts of earlier turns absent). FocusContent drives
  `face.loadOlder()` to completion while the overlay is open.
- **`snapshot.pending` is gone.** Pending interactions moved to
  `ctx.uiSession.pendingInteractions` (`ReadonlyMap<sessionId,
  PendingQuestion | PendingApproval>`). Answer paths are `wait.answer({
  answers })` and `wait.answer('allowed-once' | 'rejected')`. See
  `usePendingInteraction` + Composer `AnswerCard`.
- **`conversation.resolveImage` is gone** → `uiConversation.imageUrl(sessionId,
  attachment)` (loadImage in FocusView.tsx).
- **`@deepseek-ai/dsh-client-runtime` no longer exists** (split into
  dsh-client-modules / ui-* packages). Removed from `dsh.client.inject`;
  `@deepseek-ai/dsh-client-ui-primitives` survives as a runtime module id in
  the frontend bundle (MarkdownText/MessageText/Button/Modal/Icon* intact).
- **CSS tokens**: removed in 0.1.2 — `--dsw-specific-bubble`,
  `--dsw-static-deepseek-500/200`, `--dsw-alias-bg-overlay`,
  `--dsw-specific-input-major`, `--dsw-alias-border-l2-darkmode-thin`,
  `--dsw-shadow-lv2`, `--dsw-font-s-strong-14`. Migrated to `--dsw-alias-*`
  equivalents (styles.ts). Removed-but-fallback tokens are harmless.
- **Font-size setting**: 0.1.2 scales content via `body` vars
  `--dsh-content-font-size` (12–17px) / `--dsh-content-font-delta` /
  `-secondary`; overlay text derives from these so it follows the setting.
- Slot names unchanged: `shell.overlay`, `conversation.session.header.actions`,
  `settings.plugin.item` (keyed), `settings.onboarding`.
- Debug tooling that worked: headless Chromium (playwright-core + ms-playwright
  cache) + auth cookie minted from `~/.dsh/.credentials.yaml`
  (`client-connection/browser-session` secret; HMAC key is the base64url-DECODED
  secret bytes; cookie name `dsh-auth-` + base64url(sha256("127.0.0.1:3080"))).


Date: 2026-08-18 (CST). User communicates in Chinese.

## What this is

A DeepSeek Harness (DSH) **bundle plugin** (npm package) that adds a "Focus Mode"
full-screen reading overlay to the DSH web GUI. It hides the header/composer,
folds the AI tool-call flow into one-line summaries, and reuses the official
`@deepseek-ai/dsh-client-ui-primitives` Markdown/image rendering.

- Local repo: `/Users/libogong/Downloads/dsh-focus-overlay/`
- GitHub: `https://github.com/boogoo619/dsh-focus-overlay` (branch `master`)
- DSH checkout (runtime source of truth for contracts):
  `/Users/libogong/.npm-global/lib/node_modules/@deepseek-ai/dsh`

## Where things stand (as of handoff)

All feature work is **committed and pushed**. Release v0.3.0 is created. The
**only unfinished step is npm publish**, blocked on 2FA (EOTP).

Commits/tags on `master` (newest first):

- `d297b35 Bump version to 0.3.0`  ← current HEAD, tag `v0.3.0` (pushed)
- `1f08902 Add auto-focus mode and reply/waiting reminders`
- `827ac32 Move navbar left to avoid scrollbar overlap`
- `1371507 Bump version to 0.2.0`  ← tag `v0.2.0`

Done:
- package.json + package-lock.json version = `0.3.0`
- git tag `v0.3.0` pushed
- GitHub Release created: https://github.com/boogoo619/dsh-focus-overlay/releases/tag/v0.3.0
- README.md / README.en.md updated to document the new auto-focus features
- Tests pass (26), build passes. `lib/` is gitignored (build output).

## Pending: npm publish (blocked on OTP)

- npm registry still has **0.1.0**. `0.2.0` was GitHub-only (never published).
- `npm publish` returns `EOTP` (2FA). npm account = `yt_boogoo`.
- Next agent: ask the user for a fresh 6-digit OTP, then run
  `npm publish --otp=<code>` in the repo. OTP expires fast (~30s).
- Decision to surface to user: publish 0.3.0 directly (jumps 0.1.0 → 0.3.0 on
  npm), or first backfill 0.2.0 then 0.3.0.
- `npm publish` runs `prepare` → `npm run build` (tsdown) automatically, so
  `lib/` is rebuilt at publish time. A `--dry-run` already succeeded earlier.

## The feature just built (auto-focus / reminders)

Settings toggle `autoFocus` (default **off**) in `FocusPrefs`
(`src/client/settings.ts`, localStorage key `dsh-focus-overlay:prefs`).

Detection lives in `src/client/index.ts` `apply()`, as a standalone `ctx.effect()`
that subscribes to `sessions.list` (current session id) and the current session's
`binding().session` (`SessionFace` = `ObservableSnapshot<ConversationSnapshot>`).

Two triggers, two different mechanisms:

1. **Reply completed normally** (event): watch `running` true→false, then call
   `detectSettledCompletion(snap)` (pure, in `src/client/model.ts`).
   - If focus closed → `focusStore.setAutoAnchor(anchorSeq)` + `focusStore.set(true)`
     (auto-open scrolled to the user question that started the turn).
   - If focus open → `focusStore.notifyDone()` (one-shot "new reply ready" toast).
   - `detectSettledCompletion` walks nodes backwards to the first terminal node
     (`assistant`/`turn-error`/`turn-max-tokens`); accepts only a non-interrupted
     assistant. Abnormal endings never fire.

2. **AI blocked waiting for user** (ask_user_question / approval) — this is a
   **live state**, NOT an event, so it is NOT edge-detected. The overlay derives
   it directly: `hasPendingInteraction(snap)` (pure, in `model.ts`) reads
   `snapshot.pending.length > 0`. Shows "AI 正在等待你的回复 / 去回复" toast while
   focus is open; clears automatically the moment the user answers (pending empties).
   The "去回复" button just exits focus (`focusStore.set(false)`) so the user can
   answer in the main view (which the overlay would otherwise hide).

Toast UI + `focusStore` live in `src/client/FocusView.tsx`. The `waiting` toast is
derived from `snap.pending`; the `done` toast is a one-shot `donePing` counter
cleared on overlay unmount (`clearDonePing`) so it never re-shows on re-entry.

## Verified DSH runtime facts (for further work)

- There is **no client-side "reply finished" event**; the session snapshot's
  `running` bit edge is the signal. Client events catalog: `connection/reset`,
  `locale/change`, `slots/changed`, `theme/change`.
- `ConversationSnapshot` (see
  `.../dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/sessions/conversation.d.ts`):
  `sessionId`, `views`, `chat`, `nodes`, `turnTimings`, `turnEnds`, `partial`,
  `runningCalls`, `pending`, `queue`, `running`, `subagent`, `composerPhase`,
  `removed`, `openState`, `openError`, `hasMore`, `loadingOlder`, `promptError`,
  `blank`, `lastAgentError`.
- `snapshot.pending: PendingInteraction[]`, kind `'question' | 'approval'`, with
  `key`, `sessionId`, `payload` (see `sessions/pending.d.ts`).
- **Important:** `running` stays TRUE while `ask_user_question` blocks (the agent
  awaits the tool result inside `step()`), so `pending` — not the `running` edge —
  is how "blocked waiting for user" is detected.
- `ISessions` service (`ctx.sessions`): `list: ObservableSnapshot<SessionListState>`
  (`.current`, `.byId`, `.ids`), `binding(id): SessionBinding` → `{ sessionId,
  session: SessionFace, ctx }`. `SessionFace = ISession & ObservableSnapshot<ConversationSnapshot>`
  (`getSnapshot()` / `subscribe(fn)`).
- `ObservableSnapshot<T>` = `{ getSnapshot(): T; subscribe(fn): () => void }`.
- Button primitive variants: `'primary' | 'ghost' | 'outline' | 'toolbar'`.
- Slot registration pattern is in `index.ts` (`shell.overlay`,
  `conversation.session.header.actions`, `settings.section`).

## Repo / workflow conventions

- Bundle plugin build: `tsdown` dual-half (`src/index.mjs` → `lib/index.mjs` ESM;
  `src/client/index.ts` → `lib/client.js` CJS). Scripts: `build`, `test` (vitest),
  `prepare` (build). `dsh.bundle.patch` → `cordis.patch.yml`,
  `dsh.client.inject` = `["@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-ui-primitives"]`.
- Pure/decision logic goes in `src/client/model.ts` with vitest coverage in
  `tests/model.test.ts` (keep the pattern if adding more logic).
- User's workflow: **do not commit until the user confirms**; releases/publishes
  are separate, explicitly requested actions. Version bumps use
  `npm version <v> -m "Bump version to %s"` (syncs package-lock, commits, tags).
- i18n is bilingual zh/en in `src/client/locales.ts`; README is bilingual too.

## Suggested skills

- `cordis-plugin-development` — before any further plugin change, to re-query the
  Host/Client Services/Events/Slots via Inspect and confirm exact contracts.
- `code-review` — if asked to review the changes since `v0.2.0` (or any point).
- `diagnosing-bugs` — if a reported behavior issue needs systematic debugging.
