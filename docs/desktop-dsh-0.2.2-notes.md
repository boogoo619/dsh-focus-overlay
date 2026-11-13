# DSH desktop 0.2.2-rc.1 — shared ground truth (for the adaptation team)

Written 2026-11-10 by the Lead. Read this before probing the desktop runtime.
Everything below was verified on the user's machine; paths are absolute.

## What "latest desktop dsh" is

- macOS app: `/Applications/DeepSeek Harness.app`, version **0.2.2-rc.1** (`Info.plist`
  + bundled runtime `Resources/app.asar/dsh/package.json` name
  `@deepseek-ai/dsh-desktop-runtime`, version `0.2.2-rc.1`; Electron 0.2.2 desktop shell
  `Resources/app.asar/package.json` name `@deepseek-ai/dsh-desktop`, version `0.2.2-rc.1`).
- The Windows build ships the **same renderer/shell JS** (one cross-platform Electron app);
  only native binaries differ. So the renderer contract below applies to both platforms.
- The app hosts the standard dsh web UI at `http://127.0.0.1:55674` with profile
  `desktop` (`DSH_PROFILE=desktop`, `DSH_HOME=/Users/libogong/.dsh`,
  `DSH_PROFILE_DIR=/Users/libogong/.dsh/profiles/desktop`).
- Old CLI checkout (`~/.npm-global/.../@deepseek-ai/dsh@0.2.0-rc.2`) is **not** the
  target anymore; the desktop runtime is the newest code on this machine.

## Extracted reference code (read-only for you)

- Desktop Electron shell (main.js, preloads, renderer): `/tmp/dsh-desktop-shell/`
- Desktop dsh runtime node_modules (0.2.2-rc.1, all server + client packages):
  `/tmp/dsh-0.2.2/` (package root `/tmp/dsh-0.2.2`, packages under
  `/tmp/dsh-0.2.2/node_modules/@deepseek-ai/…`).
- Prebuilt web frontend (shell module table, CSS tokens, `__DSH_BOOT__` boot):
  `/tmp/dsh-0.2.2/node_modules/@deepseek-ai/dsh-web-frontend/dist/`.
- The global CLI 0.2.0-rc.2 remains at
  `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/` for diffing old vs new.

## Desktop window-frame contract (from `preload-app.cjs` / `lib/main.js`)

- Renderer preload (`preload-app.cjs`):
  - `document.documentElement.dataset.platform = process.platform` (`darwin` | `win32`;
    not set in a normal browser).
  - On macOS **and** Windows: `data-fullscreen` on `<html>` reflects window fullscreen.
  - On Windows only: `data-windows-titlebar` on `<html>` and
    `--dsh-windows-titlebar-height: 40px` on `<html>`'s inline style; plus a native
    titlebar overlay (`titleBarStyle:"hidden"`, `titleBarOverlay:{height:40}`, caption
    buttons top-right) and a web-rendered caption menubar at top-left (`z-index:1100`).
  - macOS window: `titleBarStyle:"hiddenInset"`, traffic lights at `x:16,y:18`
    (≈60.7×14 px box starting x=16), vibrancy `sidebar`, transparent background.
- Layout CSS (`dsh-client-ui-layout/lib/client.js`) defines on `<html>`:
  - `html[data-platform=darwin]` → `--dsh-frame-top-clearance:48px`
  - `html[data-windows-titlebar]` → `--dsh-frame-top-clearance:var(--dsh-windows-titlebar-height)`
    (40px) and `--dsh-frame-chrome-top:var(--dsh-windows-titlebar-height)`
  - both → `--dsh-frame-overlay-top:calc(var(--dsh-frame-top-clearance) + 20px)`
  - fullscreen (`html[data-platform=darwin][data-fullscreen]`, `html[data-windows-titlebar][data-fullscreen]`)
    → `--dsh-frame-overlay-top:20px; --dsh-frame-chrome-top:0px`
  - plain web: none of these vars are defined (so always use a fallback).
- Window dragging:
  - macOS: global CSS `html[data-platform=darwin] [data-window-drag]{-webkit-app-region:drag}`
    and `[data-window-drag-recall]{-webkit-app-region:no-drag}`. Official headers/sidebar
    strips carry `data-window-drag`. Interactive elements are auto `no-drag` under darwin.
  - Windows: official AppFrame draws its 40px titlebar drag band itself
    (`[data-windows-titlebar] .frame:before { -webkit-app-region: drag; height: 40px }`);
    `-webkit-app-region` works in the Windows renderer too.
- Official full-window surfaces:
  - settings-account overlay: Windows pads `padding-top: var(--dsh-windows-titlebar-height)`;
    macOS reserves a 60.667px `.trafficLights` spacer in its top controls row.
  - Official overlay pages that add top inset use
    `padding-top: calc(<inset> + var(--dsh-frame-top-clearance,0px))` on darwin.
  - `body > :not(#root)` is `no-drag` on darwin; our overlay lives inside `#root`
    (`shell.overlay` layer), so it can opt into drag with `data-window-drag`.

## The plugin surface being adapted

`dsh-focus-overlay` (repo = current working dir). Client half `src/client/index.ts` →
`lib/client.js`, CJS `__ModuleLoader__.load({id:"dsh-focus-overlay", factory})` bundle,
externals resolved from the frontend shell module table
(`@deepseek-ai/dsh-client-ui-primitives` is a **static shell module** on 0.2.2 — it is
*not* an installable package anymore, so keep it in `dsh.client.inject` only if it
still resolves; it did resolve in the isolated run).

Key changed primitive on 0.2.2 (already confirmed by live probe, error:
`projectUserText is not a function`):
- `projectUserText` was removed from `@deepseek-ai/dsh-client-ui-primitives`.
- 0.2.2 primitives exports the user-text pipeline pieces instead:
  `UserTextRun` (`<span class=plainRun>{text}</span>`), `UserMessageBubble`,
  `extractMarkdownPlainText`, `ReferenceChip`, …, plus `MarkdownText`, `Button`,
  `Modal`, and the `Icon…OutlineRegular` / `Icon…OutlineMedium` icon set.
- 0.2.2 module export list was dumped by probe; ask the Lead for the full list if needed.

## Isolated 0.2.2 desktop-runtime test instance (Lead-owned, read-only to you)

The Lead runs a web server on the **same 0.2.2 desktop runtime** at
`http://127.0.0.1:3099/?token=RPuC_TXhrVyNHqDVBg5R0IH-QhRjM-etyvNFhjOsuDU…`
(token rotates on restart; if it fails, start your own copy, see below).
`DSH_HOME=/tmp/dsh-home-test`, profile `fmtest` (created with
`--from-default-profile web`, plugin installed with
`dsh plugin --profile fmtest add link:<repo>`). Sessions, workspaces, credentials and
settings were copied from the real `~/.dsh`.

Start your own isolated instance (preferred for the verifier; use a distinct home/port):

```sh
rm -rf /tmp/dsh-home-verify && mkdir -p /tmp/dsh-home-verify
cp -a -c /tmp/dsh-home-test/. /tmp/dsh-home-verify/     # APFS clone; fall back to cp -a
# (rebuild the plugin first so the profile link serves the current lib/)
PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:$PATH" DSH_HOME=/tmp/dsh-home-verify \
  ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  --expose-internals \
  "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js" \
  --profile fmtest --port 3098 --no-open
```

The process prints `dsh web: http://127.0.0.1:3098/?token=…`; open that URL with
Playwright. Token is per-process. Kill with SIGTERM/`job_kill`.

Playwright: `playwright-core` is a devDependency of the repo; Chromium at
`~/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
Sessions are already seeded in `/tmp/dsh-home-test` (including one titled
“适配最新 Windows 和 Mac 桌面版 dsh”); the first-run “预览版说明” dialog dismisses with
`button:has-text("继续")`, the plugin intro modal is skipped by
`localStorage['dsh-focus-overlay:onboarded']='1'` in an init script.

Simulating the desktop frame in a normal browser (the preload markers only):
- Apply **after** boot (`page.evaluate`), not before: faking `data-platform=darwin`
  before boot makes the official `dsh-client-shortcuts` entry fail (it expects the
  Electron bridge), which cascades into 30 pending entries. After boot the markers still
  drive all frame CSS (tokens/attributes are pure CSS selectors).
- macOS: `document.documentElement.dataset.platform='darwin'`.
- Windows: `dataset.windowsTitlebar=''; document.documentElement.style.setProperty('--dsh-windows-titlebar-height','40px')`.
- fullscreen: `dataset.fullscreen='true'` (combined with either).
- Plain-browser baseline: no markers → frame vars undefined (fallbacks must apply).

## Real GUI auth (read-only probing)

Real desktop GUI: `http://127.0.0.1:55674`, cookie auth minted from
`~/.dsh/.credentials.yaml` record `client-connection/browser-session` (secret is
base64url; HMAC-SHA256 over `v1.` + base64url(JSON payload) with
`{version:1, authority:"127.0.0.1:55674", issuedAt, expiresAt}`; cookie name
`dsh-auth-` + base64url(sha256(authority))). Existing e2e scripts
`tests/e2e/header-toggle.mjs` / `input-caret.mjs` contain the code.

## Known breakages / hypotheses (verify, don't trust blindly)

1. **Hard break**: `projectUserText` missing on 0.2.2 → overlay throws and never mounts
   for any session containing a user message. Confirmed live (`overlay render failed`,
   TypeError). Lead is fixing with an export-compat fallback.
2. Verify every other primitive/service/slot the client half touches on 0.2.2
   (`MarkdownText`, `Button` variants, `Modal`, icons, `slots` register/inject, `locale.register`
   two-arg, `sessions.list` + `byId[].cwd`, `uiSession.sessionStatus` / `current`,
   `uiConversation` chat view + `imageUrl`, `conversation.input.for`, `chatFileMentions.forClosing`,
   `configForms`, `pluginNavigation.openBundle`, `sidebarRight.openResource`, `workspaces`,
   `settings.onboarding`, `plugins.bundle.config`, `shell.overlay`,
   `conversation.session.header.actions`).
3. Auto-focus watches `sessions.binding(id).session.getSnapshot().running`; check whether
   0.2.2 still exposes `running` on the session snapshot or moved it to
   `sessionSnapshot`/`uiSession.sessionStatus` (`completionUnread`), and whether the
   settle detection still sees the finalized assistant node.
4. CSS tokens: overlay styles reference many `--dsw-*` tokens; probe them at the
   overlay's DOM position on 0.2.2 (root probe is misleading). `--dsh-chat-flow-gap` is
   already known-dead with fallback; find any newly dead tokens.
5. Windows-specific: `dsh-resource://file/session/<id>/<path>` address building
   (`model.ts::sessionFileAddressOf`) for `C:\…` paths and `byId[].cwd` source; native
   caption zone (top-right 40px tall) vs overlay topbar; caption menubar (z-1100)
   coverage; drag band; fullscreen.

## Repo conventions

- TypeScript sources in `src/`; build `npm run build` (tsdown, emits `lib/`), tests
  `npm test` (vitest; `tests/model.test.ts` covers pure logic), e2e `.mjs` under
  `tests/e2e/` (Playwright against a live GUI; they mint the real-GUI cookie and
  default to `http://127.0.0.1:3080`; adapt with env where needed).
- Do **not** commit/publish (user confirms separately). Keep edits inside your assigned
  write scope. The Lead owns `src/`, `package.json`, README/handoff. You own only the
  files named in your task.

## Post-audit corrections (2026-11-10, after the three audit/verify workstreams)

- The Windows caption **menubar** is *not* covered by the focus overlay: the
  overlay lives inside the official `shell.overlay` stacking context
  (`z-index:20`) while the preload's `[data-windows-menu]` host is `z-index:1100`.
  The audit verified it sits exactly in the reserved 60px band, occludes no
  content and is the only Windows app menu — keep it visible.
- Two official Windows controls are promoted to `position:fixed; z-index:30`
  (above that `z-index:20` layer) and painted over the focus overlay:
  `[data-sidebar-toggle]` always, and the sidebar's new-session control
  (`[class*="newSession"]`) when the sidebar is collapsed / window <768px.
  Both are hidden through
  `html[data-windows-titlebar] body[data-fm-focus] …{display:none!important}`
  while focus is on; they return on exit. Covered by the e2e z-leak guard.
- `chatFileMentions.forClosing` on 0.2.x needs the real Turn face
  (`owner.turn.data.get('deliverables')`), not a plain `{turn, step}` owner;
  `src/client/model.ts::fileMentionOwnerOf` resolves it from
  `chatSnapshot.timeline.turns` (closed turns only) and keeps the legacy shape
  for 0.1.x. Queue badge now reads the official input facade's `state.queue`
  first (the session snapshot lost `queue` in 0.2).
- Audits: `docs/contract-audit-0.2.2.md` (client contract, per surface) and
  `docs/windows-desktop-audit.md` (Windows-specific paths, IME, paths corpus,
  frame). They agree: everything else the plugin touches is present on 0.2.2.

## Drag-region overlap order — and how to verify it in a real window (2026-11-13)

The focus overlay's window-drag band broke on sessions with content (blank
sessions were draggable). Ground truth learned while fixing it — keep this in
mind for any window-chrome / drag work:

- Electron hit-tests a frameless window against the renderer's **ordered** list
  of CSS `app-region` rects. Renderer order = layout-tree (DOM) order, parent
  before child; the browser keeps "drag adds, no-drag subtracts, later rect
  wins" (electron `shell/browser/ui/drag_util.cc::DraggableRegionsToSkRegion`,
  comment block above `Build`; renderer order = Blink
  `LocalFrameView::CollectDraggableRegions` pre-order).
- `-webkit-app-region` is **inherited**, and the official darwin CSS marks
  `[tabindex]`, `button`, roles, … as `no-drag`. The focus overlay root is
  `tabIndex={-1}` → every overlay descendant is a no-drag rect unless it sets
  `drag` explicitly (the `.fm-frame-strip`).
- Layout rects are **not clipped** by ancestor overflow: scrolled content keeps
  negative-y rects, and `position:absolute;inset:0` wrappers (`.fm-rail-slot`)
  are full-viewport rects. Both overlap the reserved titlebar band and, if they
  come after the strip in DOM order, cancel it. Hence the strip MUST be the
  overlay's last child; a new overlay child that paints/positions over the band
  must not precede it.
- Emulating the hit test in a page (ordered computed-style rects, last cover
  wins) reproduces the desktop behavior; only reading the strip's own computed
  `-webkit-app-region` (what the 0.13.0 test did) is insufficient.

**Real-window verification recipe** (no access to the live app needed): launch a
second, fully isolated instance of the packaged app so the real preload applies
`data-platform=darwin` at boot, outside the agent sandbox:

    # clone the live home (APFS clone; never point the second instance at ~/.dsh)
    cp -c -R ~/.dsh /tmp/dsh-home-appclone
    # fix per-profile relative symlinks that break outside ~/.dsh, e.g.
    ln -sfn /Users/libogong/Downloads/dsh-focus-overlay \
      /tmp/dsh-home-appclone/profiles/desktop/node_modules/dsh-focus-overlay
    # wrapper .app bundle whose executable sets DSH_HOME and execs the app with
    # --remote-debugging-port=9334 + --user-data-dir=/tmp/dsh-electron-userdata2
    open -n /tmp/DSHFocusTest.app

Then attach with `playwright-core` `chromium.connectOverCDP('http://127.0.0.1:9334')`,
take `contexts()[0].pages()[0]` (`dsh-app://app/`, real Electron window), set
`localStorage['dsh-focus-overlay:onboarded']='1'` + prefs, reload, and drive the
real GUI. The second instance's server caches the plugin client bundle at boot —
restart it after every `npm run build`. The user's live app (127.0.0.1:55674) and
`~/.dsh` must stay untouched. Note the agent shell exports
`ELECTRON_RUN_AS_NODE=1` (inherited from the runtime): a direct app launch from
this shell runs the binary as Node and exits with "bad option" — launch through
the wrapper/`open` instead, or unset it.
