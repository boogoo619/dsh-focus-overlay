# Windows desktop audit — dsh-focus-overlay on DSH desktop 0.2.2-rc.1

Audited 2026-11-10 by `windows-auditor` against the extracted desktop shell
(`/tmp/dsh-desktop-shell`, `@deepseek-ai/dsh-desktop@0.2.2-rc.1`) and the 0.2.2-rc.1
runtime (`/tmp/dsh-0.2.2`, `@deepseek-ai/dsh-desktop-runtime`), plus live probes on an
isolated 0.2.2 web instance (port 3096, own `DSH_HOME=/tmp/dsh-home-win`, profile
`fmtest`, plugin served from this checkout's rebuilt `lib/`).

**Host limitation:** all live probes ran on macOS. The Windows desktop build ships the
same renderer/shell JS (one cross-platform Electron app; only native binaries differ),
which was verified in the shell code — see §0. But native Windows behaviour (caption
button painting/hit-testing, real window dragging, real IME, DPI, snap layouts, scrollbar
rendering) **cannot be proven here**; those are listed as inference and in the
"cannot be verified on this host" section.

Status at audit time: the Lead's 0.2.2 fixes are in the tree (`projectUserTextCompat`,
frame strip, Windows sidebar-toggle rule). Measurements were taken against the served
bundle containing them. Live results:

| Probe | Result |
|---|---|
| `npx vitest run tests/model.test.ts` | 125/125 pass |
| Windows markers: overlay `padding-top` / topbar top / strip height | 60px / 60px / 60px |
| Windows exit button vs native caption zone `{x≥vw-138, y<40}` | no intersection (`y=70..98`, 1280 wide) |
| Windows interactive/focusable elements inside `y<40` | none (0) |
| Windows fullscreen (`data-fullscreen`): topbar top / strip | 20px / 20px |
| macOS markers (reference): topbar top / strip | 68px / 68px |
| macOS fullscreen: topbar top / strip | 20px / 20px |
| Plain web: overlay padding / strip | 0px / 0px |
| `--webkit-app-region` computed on strip | `drag` (all modes) |
| `sessionFileAddressOf` vs official `fileAddressFor` (24-case Windows corpus) | 0 diffs |

---

## 0. Cross-platform renderer contract (verified)

- The desktop main window loads `dsh-app://app/`, which proxies the local Host web UI;
  the renderer contract is identical on both OSes. `createWindow` differs only in
  `titleBarStyle` / `titleBarOverlay` / `trafficLightPosition` / vibrancy
  (`/tmp/dsh-desktop-shell/lib/main.js:20105-20130`).
- Windows-only preload: `syncWindowsAppearance()` sets `data-windows-titlebar` +
  `--dsh-windows-titlebar-height:40px` on `<html>`, mounts the web-rendered caption
  menubar and syncs caption colors over IPC
  (`/tmp/dsh-desktop-shell/lib/preload-app.cjs:1658-1727`; call site `:1959`).
  Fullscreen state is mirrored to `data-fullscreen` on both OSes (`:63-76`).
- Windows window options: `titleBarStyle:"hidden"`, `titleBarOverlay:{height:40}`,
  caption buttons top-right; min size 520×600
  (`/tmp/dsh-desktop-shell/lib/main.js:20111-20117`, `:20101-20104`).
- Official layout CSS turns the markers into variables on `<html>`
  (`/tmp/dsh-0.2.2/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js:74`):
  `--dsh-frame-top-clearance: 40px` + `--dsh-frame-chrome-top: 40px` (Windows),
  `--dsh-frame-overlay-top: 60px`; fullscreen → `--dsh-frame-overlay-top: 20px`,
  `--dsh-frame-chrome-top: 0px` (the clearance variable itself is **not** cleared).
  The official frame also draws its own 40px drag band and pads itself by 40px
  (`[data-windows-titlebar] .PIRFFq_frame` and `:before` in that same CSS string).
- The plugin renders inside `shell.overlay` → `div.PIRFFq_overlayLayer {z-index:20}`
  (verified ancestor chain in the live DOM), so its 2147483000 is contained in that
  stacking context. This matters for §1.3/§1.4.

Verified current implementation (Lead's changes, referenced below):
`src/client/FocusView.tsx:1071` (frame strip render),
`src/client/styles.ts:5` (overlay `padding-top:var(--dsh-frame-overlay-top,0px)`),
`src/client/styles.ts:16` (`.fm-frame-strip`, `-webkit-app-region:drag`),
`src/client/styles.ts:23` (Windows sidebar-toggle hide rule).

---

## 1. Window frame, caption zone, drag region

### W1 — Frame clearance is correct on Windows (verified, no action) — OK

Measured with post-boot Windows markers:

- `.fm-overlay` = viewport `0,0,1280,820` (fixed positioning escapes the official frame's
  40px padding — confirmed).
- `padding-top: 60px` from `--dsh-frame-overlay-top` (= 40px titlebar + 20px gap).
- `.fm-topbar` top = **60px**; exit button box `x=1161.3..1264, y=70..98`
  (`1280×820`, viewport 1280). Caption zone `{x≥1142, y<40}` → **no intersection**.
- At the window minimum `520×600`: topbar top 60, exit `x=401..504, y=70..98`, caption
  zone `{x≥382, y<40}` → no intersection; no focusable element inside `y<40`.
- Fullscreen: `padding-top/topbar/strip = 20px` (follows the official var; no stale
  40/48px clearance), exit `y=30..58`.
- Plain browser (no markers): padding 0, strip height 0 — web generation unchanged.

Risk: none. The `--dsh-frame-overlay-top`-based approach is **consistent with the
official full-window overlays** (e.g. settings-account adds
`padding-top:var(--dsh-windows-titlebar-height)` only:
`/tmp/dsh-0.2.2/node_modules/@deepseek-ai/dsh-client-ui-settings-account/lib/client.js`,
`PlatformOverlay.module.css`).

### W2 — Drag strip is sufficient for the web-side contract (verified) — OK

`.fm-frame-strip` is `position:absolute; top:0; left/right:0; height:60px`,
`-webkit-app-region:drag`, `data-window-drag`, `aria-hidden=true`, 0 children,
0 focusable descendants, `z-index:0` (hence below all later overlay children).
Computed `-webkit-app-region` in this Chromium = `drag`. The official frame's own
`.PIRFFq_frame:before` 40px drag band is **under** the overlay layer, so the plugin's
own strip is genuinely required and is the only drag surface in focus mode.
The strip is also the hit target at `(30,20)`, `(80,20)`, `(400,20)` (verified via
`elementsFromPoint`), so dragging works across the whole reserved band except where
official chrome sits above it (W3/W4).

Risk: the strip's height (60px) intentionally exceeds the native titlebar (40px); the
band therefore also double-click-maximizes at y=40..60 — same as a taller titlebar,
acceptable.

### W3 — Windows sidebar-toggle z-index leak (verified FIXED by Lead) — fixed

On the Windows renderer the official sidebar promotes its collapse toggle to
`position:fixed; z-index:30; left:12px; top:6px`
(`/tmp/dsh-0.2.2/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js`, CSS
string: `[data-windows-titlebar] .kB3qhq_toggle{...}`). `30 > overlayLayer's 20`, so it
used to paint **above** the focus overlay and steal clicks/drags from the strip.
Live probe of the current bundle: the rule
`html[data-windows-titlebar] body[data-fm-focus] [data-sidebar-toggle]{display:none!important}`
(`src/client/styles.ts:23`) matches and the button computes `display:none`; hit tests at
`(20,20)/(30,20)` return `.fm-frame-strip` as intended.

Required change: none (already landed). Keep the regression assertion in the e2e harness.

### W4 — **Must fix: the official "new session" titlebar button still floats above the overlay** (Windows only, major)

When the official sidebar is collapsed — either the user collapsed it before entering
focus mode, or the window is narrower than 768px (Windows has no drawer: see
`/tmp/dsh-0.2.2/.../dsh-client-ui-layout/lib/client.js`, `windowsTitlebar` branch of
`drawer`) — the official new-session control is promoted to the titlebar band:

`[data-windows-titlebar] .kB3qhq_collapsed .kB3qhq_newSession{top:calc((var(--dsh-windows-titlebar-height) - 28px) / 2);z-index:30;-webkit-app-region:no-drag;border:none;margin:0;padding:0;position:fixed;left:48px}`
(`/tmp/dsh-0.2.2/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js`, CSS
string). `z-index:30 > 20` → it paints **above** the focus overlay at
`x=48..76, y=6..34`.

Live probe (current bundle, both cases reproduced):
- 1280×820 with sidebar collapsed before focus: element `BUTTON.kB3qhq_newSession`,
  `z=30`, rect `48,6,28×28`, hit-tested at `(60,20)` above `.fm-frame-strip`.
- 520×600 default (sidebar auto-collapsed): same button, same rect/hit test.
- The Lead's `[data-sidebar-toggle]` rule does not cover it (different element,
  no stable data attribute; only a hashed class `kB3qhq_newSession` and a localized
  `aria-label="新建会话"`).

Impact: in focus mode the button is visible and clickable in the reserved titlebar band,
and clicking it starts a new session under the overlay — the overlay switches to the new
(empty) session while the user is reading, an invisible action with a visible state
change. It is also the one non-titlebar control left in the drag band (because it sits
at left 48px, over the strip).

Required change (either is acceptable; both are small):

1. **Preferred — generic sweep (robust across dsh builds)** in the focus-on effect
   (`src/client/index.ts` near the `data-fm-focus` body-attribute effect, currently
   `src/client/index.ts:58-66`): while focus is on **and**
   `document.documentElement.hasAttribute('data-windows-titlebar')`, find official
   fixed controls in the titlebar band that are not descendants of the overlay and not
   the caption menubar host, mark them `data-fm-titlebar-hidden`, and restore on exit:

   ```ts
   // focus-on sync: after setting body[data-fm-focus]
   const HIDE_ATTR = 'data-fm-titlebar-hidden'
   const sweep = () => {
     document.querySelectorAll(`[${HIDE_ATTR}]`).forEach((el) => {
       el.removeAttribute(HIDE_ATTR)
     })
     if (!focusStore.get() || !document.documentElement.hasAttribute('data-windows-titlebar')) return
     const overlay = document.querySelector('.fm-overlay')
     for (const el of document.querySelectorAll('body button, body [role="button"]')) {
       if (!(el instanceof HTMLElement)) continue
       if (el.closest('.fm-overlay') || el.closest('[data-windows-menu]') || el.closest('[data-sidebar-toggle]')) continue
       const cs = getComputedStyle(el)
       if (cs.position !== 'fixed') continue
       const r = el.getBoundingClientRect()
       if (r.width === 0 || r.height === 0) continue
       if (r.top < parseFloat(cs.getPropertyValue('--dsh-windows-titlebar-height') || '40')) el.setAttribute(HIDE_ATTR, '')
       void overlay
     }
   }
   // CSS: html[data-windows-titlebar] [data-fm-titlebar-hidden]{display:none!important}
   ```
   (Re-run sweep on `focusStore` subscription edges; the class/attribute-based sweep does
   not depend on hashed class names.)
2. **Cheapest one-liner (pinned to 0.2.2-rc.1, breaks on any sidebar refactor)** — add to
   `src/client/styles.ts` next to line 23:
   ```css
   html[data-windows-titlebar] body[data-fm-focus] [class*="newSession"]{display:none!important}
   ```
3. Accept explicitly (not recommended for a Windows release): document that the official
   Windows titlebar cluster (menubar + new session) stays live in focus mode and that
   clicking new-session changes the underlying session.

Note: the caption menubar itself is intentionally kept (W5) — the sweep above skips
`[data-windows-menu]`; the toggle is already hidden by the existing rule.

### W5 — Caption menubar is **not** covered by the overlay; keep it visible (verified) — acceptable

Hypothesis in `docs/desktop-dsh-0.2.2-notes.md` ("caption menubar z-index 1100 being
covered by the overlay's high z-index") is **wrong**. `installWindowsMenu()` attaches the
host to `document.body` with `position:fixed; top:0; left:var(--dsh-windows-menu-start,48px);
z-index:1100; height:var(--dsh-windows-titlebar-height)` and `-webkit-app-region:no-drag`
(`/tmp/dsh-desktop-shell/lib/preload-app.cjs:1541-1655`). Because our overlay lives inside
the `z-index:20` stacking context, `1100 > 20` → the menubar paints above it.

Live probe with a faithful mock host (same inline styles, body child, `z=1100`,
`--dsh-windows-menu-start` resolved by the official CSS to 84px in the collapsed-sidebar
state): `elementsFromPoint(100,20)/(200,20)` return the menubar buttons above
`.fm-frame-strip`; the host rect `84,0,117×40` — inside the reserved 60px band, not over
content. The menubar also has `rememberEditor` focus restoration and no-drag, so its
buttons keep working in focus mode.

Recommendation: **accept** (do not hide). It is the only app menu on Windows — the native
application menu is intentionally reduced to a hidden F12 devtools accelerator
(`/tmp/dsh-desktop-shell/lib/main.js:21000-21014`), so hiding the menubar in focus mode
would remove About / Check updates / Manage dsh Command / Quit while focus is on. It fits
exactly in the reserved band. Required change: none; document the behaviour in the plugin
README/desktop notes.

### W6 — Caption-button background color seam (minor, visual; unverifiable here)

`titleBarOverlay.color` is continuously set from the renderer's measured
`--dsw-specific-sidebar-fill` (`syncWindowsAppearance`, `/tmp/dsh-desktop-shell/lib/preload-app.cjs:1672-1701`;
main-process `setTitleBarOverlay` at `lib/main.js:21084-21091`). The focus overlay paints
`--dsw-alias-bg-base`. Measured in the live 0.2.2 page: sidebar fill `#f9fafb` vs overlay
`#fff` (light), frame `rgb(27,27,28)` vs overlay `rgb(21,21,23)` (dark). The native
window-controls overlay area (top-right ≈138×40) is therefore painted in the sidebar
color over the overlay's base color: a faint rectangle edge. The official full-window
overlays behave the same way, so this is **not a regression**; optional polish:
`html[data-windows-titlebar] .fm-frame-strip{background:var(--dsw-specific-sidebar-fill,transparent)}`
would blend the whole reserved band with the native controls (design decision, do not
change unilaterally). Needs a Windows screenshot to judge.

### W7 — Windows fullscreen: contract followed, but the state is effectively unreachable (verified/low)

The overlay collapses to 20px in `[data-fullscreen]` (measured), matching the official
vars. In 0.2.2-rc.1 the Windows main window never calls `setFullScreen` — the only
`setFullScreen` call sites are macOS hide (`lib/main.js:21095-21100`) and the macOS update
handoff (`lib/main.js:15529-15565`); the Windows application menu is empty
(`:21000-21014`). So `data-fullscreen` on Windows is defensive. If it ever fires, the
official CSS assumes the native caption buttons are gone in fullscreen
(`--dsh-frame-chrome-top:0px`); the plugin inherits that assumption. **Inference, needs a
Windows check only if fullscreen becomes user-reachable** (then confirm min/max/close are
hidden; if they are not, the exit button at `y=30..58` would sit under their zone).

### W8 — Window frame z-order and native layers (verified/inferred)

- Verified: overlay covers the full viewport including the frame's 40px padding; the
  official 40px drag band and the leading seat (`z 15`) are under the overlay.
- Inferred (cannot run Electron on Windows here): the native Window Controls Overlay
  (min/max/close) paints **above** web content, so the plugin cannot block those buttons;
  a `-webkit-app-region:drag` element overlapping that zone (our 60px strip does overlap
  the top-right 138×40) must not disable them — standard WCO behaviour, but verify on a
  Windows machine (checklist).

---

## 2. Paths and file addresses on win32

### W9 — `sessionFileAddressOf` matches the official grammar for Windows paths (verified, no action) — OK

`src/client/model.ts:150-162` was exercised against the official
`fileAddressFor` from `/tmp/dsh-0.2.2/node_modules/@deepseek-ai/dsh-util-workspace-path/lib/index.js`
(24-case corpus, drive letters, backslashes, UNC, casing, trailing separators, spaces,
`#`, `?`, `%`, CJK, `..`, `path===cwd`, undefined/empty cwd, POSIX control cases).
**0 diffs.** Specifically for Windows:

- `C:\w\src\a.ts` + cwd `C:\w` → `dsh-resource://file/session/<id>/src/a.ts` (backslash
  normalization + workspace reduction, colon kept literal);
- drive root (`C:\` / `C:`) and drive-relative `C:foo\bar` behave exactly like official;
- UNC `\\server\share\proj\a.ts` under cwd → reduced to relative; outside cwd keeps the
  `//server/share/...` spelling in a session-scoped address — identical to official
  (and the Host resolves both via `dsh-api-workspace-files`);
- casing mismatch (`c:\users` vs `C:\Users`) leaves the absolute path in the address,
  exactly like official; the Host's `ls`/`resolve(path,{cwd})` still opens it
  (`/tmp/dsh-0.2.2/.../dsh-api-workspace-files/lib/index.js:40-80,550-610`);
- segment encoding incl. `%` → `%25`, `#`/`?` encoded; session id encoded.

### W10 — Caller chain on 0.2.2: cwd source, service verbs, line param (verified)

- `sessions.list.byId[id].cwd` **exists** on 0.2.2 and is optional (only set when the list
  entry has a cwd): built in
  `/tmp/dsh-0.2.2/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/service.js:493-514`
  (`...entry.cwd !== undefined ? { cwd: entry.cwd } : {}`), same in `client.js:4171-4186`.
  Caller `src/client/FocusView.tsx:661` reads exactly that snapshot path. A subagent or
  brand-new row without `cwd` degrades to absolute spelling — still works.
- `workspaces.openPath` does **not** exist in 0.2.2 (the `workspaces` client service is
  the pure controller: `/tmp/dsh-0.2.2/.../dsh-api-workspace-controller/lib/client.js:382-445`),
  so the plugin correctly falls through to `sidebarRight.openResource`
  (`src/client/FocusView.tsx:662-665`). `sidebarRight` exists and exposes
  `openResource(address, options)` (`/tmp/dsh-0.2.2/.../dsh-client-ui-sidebar-right/lib/client.js:2494-2506`,
  provided at `:5600`).
- `openResource(address, {params:{line}})` matches 0.2.2's consumer:
  `dsh-client-ui-sidebar-documentpreview` reads `tab.navigation.params.line` and
  highlights `number === target` — a **number** (`.../dsh-client-ui-sidebar-documentpreview/lib/client.js:633-655,759`).
  On 0.2.2 the `openFile` callback receives only the path (`producedFileMentions` calls
  `openFile(path)`), so `line` is never actually forwarded today — no Windows issue, but
  the code path is untested.
- Address resolution is Host-authoritative: `dsh-api-workspace-files` parses via
  `parseFileAddress` and resolves the session-scoped path against the session workspace
  root, allowing absolute files inside/outside; Windows drive paths are valid host paths.

### W11 — **Must fix (cross-platform; blocks Windows file-open validation): `chatFileMentions.forClosing` owner shape changed on 0.2.2** (major)

`src/client/FocusView.tsx:669-680` calls
`chatFileMentions.forClosing({turn:{turn,step}, seq, openFile}, currentId)`.
0.2.2's implementation is
`forClosing(owner, _sessionId, getFileTriggerProps)` and immediately does
`selectProducedFiles(owner)` → `owner.turn.data.get("deliverables")`
(`/tmp/dsh-0.2.2/node_modules/@deepseek-ai/dsh-client-ui-deliverables/lib/client.js:2684-2690,1146-1150,1258-1262`).
The plugin's owner has no `turn.data` → `TypeError` → swallowed by the caller's
`try/catch` (`:676-680`) → **no mention chips and no file-open at all on 0.2.2**, on both
platforms (so the Windows path handling above cannot be reached from the UI until fixed).

Required change (owned by the contract adaptation, not a Windows-only edit): carry the
official chat node / turn owner into `fileMentionsFor`. Minimal approach: keep the raw
node in `FocusItem` (or map `seq → node`) and pass
`{ turn: { turn: node.turn, data: node.turn.data }, seq, openFile }` plus the third
`getFileTriggerProps` argument if a context menu is wanted. If `deliverables` data is not
reachable from the legacy slice, fall back to the official chat view's own
`fileMentions` resolver rather than synthesizing an owner. See also §4 W15 (chips are
how Windows absolute paths reach the address builder).

### W12 — Focus-mode file open has no visible effect (cross-platform, minor)

`sidebarRight.openResource` opens the file in the right sidebar, which is **behind** the
focus overlay. A user clicking a file reference sees nothing until exiting focus. Suggest
either closing focus on successful open (`focusStore.set(false)` after `openResource`),
or a toast; not Windows-specific, but Windows is a release target so the behaviour should
be a deliberate decision. Also: `openMentionedFile` swallows every failure silently
(`src/client/FocusView.tsx:655-667`); one `console.warn` on failure would make Windows
path bugs diagnosable.

### W13 — Windows unit-test coverage gaps (minor)

`tests/model.test.ts:331-352` covers `C:\w` absolute-reduction, colon-literal, `/w/`
trailing slash and `./`+backslash. Missing Windows cases worth pinning (all currently
correct, so they are regression guards): UNC under/outside cwd, drive root (`C:\`),
drive-relative (`C:foo\bar`), casing mismatch, trailing-backslash cwd, `..\`, path equal
to cwd (`.../` empty body), `%`/`#`/`?`/spaces in segments, CJK path, undefined and empty
cwd, and a parity check against the official `fileAddressFor` corpus.

---

## 3. Input / IME / keyboard

### W14 — F-hotkey and Esc guards behave correctly on 0.2.2 (verified live) — OK

Published probe results on the isolated 0.2.2 instance with the 0.2.2 official composer
(Lexical `contenteditable`):

- typing `f` in the official composer → overlay does **not** open (typing guard on
  `isContentEditable`, `src/client/index.ts:211-219`);
- `Ctrl+F` with body focus → does not open (`hotkeyShouldEnter`, `src/client/model.ts:635-646`);
- plain `F` with body focus → opens; `body[data-fm-focus]` set;
- synthetic `Esc` with `isComposing=true` → ignored; with `keyCode=229` → ignored;
  plain `Esc` → exits (`src/client/FocusView.tsx:598-619`).
- Unit tests cover modifiers/repeat; `AltGr` (Ctrl+Alt) can never trigger the hotkey.

### W15 — Fallback textarea IME shield works on 0.2.2 (verified via synthetic composition) — OK

With `borrow:false` at 1280×820 the plugin's `.fm-bar-text` textarea rendered and:
typing `hello` echoed to the main composer's Lexical editor; `Shift+Enter` inserted a
newline and did not send; during a synthetic `compositionstart → input(value)` sequence
the shared draft store was **not** echoed (main composer text unchanged) and the textarea
kept focus; `compositionend` flushed the final text and restored/kept focus
(`src/client/Composer.tsx:281-375`). Enter-to-send is guarded by
`!isComposing && keyCode !== 229` (`src/client/Composer.tsx:338-348`).

Caveat: the synthetic DOM events prove the plugin's logic, **not** real Windows IME
behaviour (candidate window, `keyCode 229` timing, focus retargeting are OS/IME-specific).

### W16 — Hotkey is character-based; non-Latin Windows keyboard layouts break it (minor)

`hotkeyShouldEnter` checks `e.key === 'f' | 'F'` and the window listener passes the raw
event. On a Russian/Greek/other non-Latin layout the physical F key produces a different
character, so the hotkey silently does nothing (no false trigger). The official desktop
shortcut system matches **physical codes** (`input.code`, `Key[A-Z]`,
`/tmp/dsh-desktop-shell/lib/main.js:19470-19560`; `dsh-client-shortcuts`
`normalizeBinding`). Suggested patch (keep character match for layouts where the letter
is elsewhere, add physical fallback):

```ts
// src/client/model.ts:635 (extend event type with code?: string)
const k = typeof e.key === 'string' ? e.key : ''
const code = typeof (e as any).code === 'string' ? (e as any).code : ''
return k === 'f' || k === 'F' || (code === 'KeyF' && k !== 'F')
```
(`k !== 'F'` avoids double-counting the Shift+F case; guard rails stay unchanged.)
Risk: minor — feature unavailable on non-Latin layouts, no wrong behaviour. On Windows
this is more visible than on macOS (multiple layouts are common).

### W17 — Tabs escape into official chrome behind the overlay (minor, cross-platform)

`Tab` from the overlay can reach the hidden official UI (the overlay is not a focus trap;
the rest of the app is not `inert`). On Windows, two extra focusable elements are
actually **visible** above the overlay: the caption menubar buttons (W5) and, when the
sidebar is collapsed, the new-session button (W4). Not introduced by this adaptation, but
worth a note; the strip itself is correctly `aria-hidden` with no focusables.

### W18 — Enter chords in fallback composer differ from the official composer (minor)

The fallback textarea sends on plain `Enter` and on `Ctrl+Enter` (only `shiftKey` is
checked, `src/client/Composer.tsx:343-348`). The official composer treats Ctrl+Enter as
the "complementary" input action (newline/composition, see
`fixed.complementary` in `/tmp/dsh-0.2.2/.../dsh-client-ui-conversation/lib/client.js:22700-22720`).
On Windows (Ctrl as the send modifier is common) users may get a send where the main
composer would not. Minor behavioural mismatch; add `!e.ctrlKey && !e.metaKey` if parity
is desired.

---

## 4. Rendering / layout at Windows sizes

### W19 — Typography tokens are Windows-safe (verified) — OK

`--dsw-font-family` (from the official theme) resolves on the live 0.2.2 page to
`-apple-system, "system-ui", "Segoe UI", "PingFang SC", "Hiragino Sans GB",
"Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif` — Segoe UI and
Microsoft YaHei are Windows fonts. The plugin uses `var(--dsw-font-family, sans-serif)`
everywhere; its only explicit stack (`.fm-running-dash`, `src/client/styles.ts:52`)
already lists `'Segoe UI'`.
Scrollbars: the official theme installs a global 5px `::-webkit-scrollbar` style
(`/tmp/dsh-0.2.2/.../dsh-client-ui-theme/lib/client.js`, theme CSS), so Windows does not
fall back to 15px classic scrollbars; `.fm-body` (overflow-y:auto) gets the same 5px
gutter on both OSes. Minor half-scrollbar centering shift only.

### W20 — Minimum window 520×600 is usable with the reserved band (verified)

At 520×600 Windows markers: overlay `0,0,520,600`; topbar `y=60..109`; body `491px`
tall; title row `x=16..260`, exit `x=401..504, y=70..98` (no caption-zone intersection);
borrowed official composer lifts to `x=24, w=472, bottom=20px` (`z 2147483200`, above the
overlay); dock bottom 18px, reply toast bottom 84px. `.fm-inner` width 464, no content
overflow; the only horizontal overflow inside the overlay is the pair of zero-width
`.fm-width-handle` elements at `x=-144 / 664` (`overlay.scrollWidth 683` vs
`clientWidth 520`) — invisible, non-interactive at this size, no document scrollbar
(`document.scrollWidth = 520`). Benign; optionally clamp `WidthHandle` display below
`CONTENT_MIN + budget`.
No Windows-specific layout defect beyond W4/W5.

### W21 — DPI / zoom (cannot verify on this host; low risk)

- The shell sets `titleBarOverlay.height:40` and the preload writes a literal
  `40px` CSS variable; Windows DPI scaling is in DIPs, so 40 DIP = 40 CSS px at the
  100% zoom the app runs at. Multi-monitor scale changes do not change CSS layout.
- The 0.2.2 renderer has no zoom control (`setZoomFactor`/`zoomIn` not present in the
  client packages; the Windows application menu is reduced to a hidden F12 devtool
  accelerator, `/tmp/dsh-desktop-shell/lib/main.js:21000-21034`), so browser-zoom-induced
  viewports below the 520 CSS-px minimum should not occur. If a future build enables
  zoom, verify the overlay at ~120–150% (topbar, exit button, caption zone, min-size
  520 DIP → smaller CSS width).
- Real Windows font rasterization / ClearType and the `–` en dash in the running
  indicator are unverified; CSS uses px line-heights and the official font stack, so no
  layout assumption depends on OS fonts.

### W22 — Rendering z-order of official surfaces (verified as far as possible)

- The overlay (inside `overlayLayer` z20) hides the official frame, sidebar, header and
  right sidebar **below** z20. Verified live.
- The borrowed official composer (`.fm-lift`, z2147483200 in the root stacking context)
  paints above the overlay, as designed; measured lift geometry at 520×600 above.
- The mandatory-update surface is in-page at `position:fixed; top:40px;
  z-index:2147483647` appended to `<html>` (`/tmp/dsh-desktop-shell/lib/preload-app.cjs:1760-1788`)
  → always above the overlay; its window-capture key blocker is registered in the
  preload before the client bundle, so F/Esc are swallowed while it blocks
  (`:1817-1821`) — focus mode cannot act behind it. Verified by code.
- Update dialogs / Platform login / welcome are separate BrowserWindows above the main
  window; no z-index interaction.

---

## 5. Native integration collisions

| Area | Evidence | Finding |
|---|---|---|
| Electron context menu | `main.js:20182-20203` | Selection → native Copy menu; editable → undo/redo/cut/copy/paste/select-all with localized labels, accelerators cleared for popups. Plugin has no custom context menu; right-click copy in the overlay works and does not conflict. No Windows-specific action. |
| `shell.openExternal` vs plugin file open | `main.js:20204-20213`; plugin `FocusView.tsx:655-667` | Official navigation handler opens http(s) externally and blocks other protocols; the plugin never calls `openExternal`, it opens files in-app through `sidebarRight.openResource`. No collision; Windows path support is W9/W10. |
| Caption menu labels/accelerators | `preload-app.cjs:1541-1655`; `main.js:21051-21082` | Application/Edit menus; edit actions are dispatched via `sendEditingKey` (Ctrl+Z/Y/…), labels localized. The plugin registers no accelerators → no collision. Popup x/y are multiplied by `webContents.getZoomFactor()` (zoom is not user-reachable, W21). |
| Desktop shortcut interception | `main.js:19293-19460` | The shell's `before-input-event` only intercepts assignable desktop commands (fixed bindings such as Enter/Escape are excluded from `keys`, only used for conflict checks). Plain `F`/`Escape` reach the page. Windows app menu = hidden F12 only; tray = open/quit (`main.js:20953-21014`, `:21020-21046`) → no collision with the F hotkey or Esc. |
| Maximize / restore / snap | `createWindow` `main.js:20101-20130`; WCO | Maximize is native, no `data-*` attr; geometry (padding 60, topbar 60) is CSS-var driven and unaffected by the state. Drag strip double-click maximize, drag-to-snap and Snap Layouts hover are standard `-webkit-app-region:drag`/native-WCO behaviours — **verify on Windows** (checklist). |
| Fullscreen transitions | `main.js:20144-20148`; official CSS | `data-fullscreen` toggles synchronously; the plugin's CSS reacts (`20px`). On Windows the state is currently unreachable via UI (W7). |
| Tray/background close while focused | `main.js:21020-21127` | Native X hides the window (background notice on Windows); the renderer keeps focus mode open in memory, next show shows the overlay — acceptable; Esc/退出 exits. No blocking issue. |
| Mandatory update overlay | `preload-app.cjs:1740-1835` | Covers the focus overlay (top:40px, int32 max z) and swallows input while policy blocks. No collision; verified by code. |

---

## Risk summary

| ID | Area | Risk | Status |
|---|---|---|---|
| W4 | New-session titlebar button paints above overlay (Windows, sidebar collapsed) | **Major** (must fix or explicitly accept) | **open** |
| W11 | `chatFileMentions.forClosing` owner shape on 0.2.2 → all file mentions/open dead | **Major** (cross-platform; blocks Windows path validation) | **open** (contract fix, Lead/task-1) |
| W7 | Windows fullscreen caption overlap if fullscreen ever reachable | minor (inference) | verify on Windows |
| W6 | Caption-button background color seam | minor (visual, official-consistent) | optional |
| W12 | File open in focus mode has no visible effect; silent failure | minor | decide |
| W13 | Unit-test Windows gaps | minor | add cases |
| W16 | Character-based F hotkey on non-Latin layouts | minor | optional patch |
| W17 | Tab escapes to background chrome | minor (pre-existing) | note |
| W18 | Ctrl+Enter sends in fallback composer, differs from official | minor | optional |
| W20 | Zero-width width handles overflow scrollWidth at 520 | minor (benign) | optional |
| W1/W2/W3/W5/W9/W10/W14/W15/W19/W21/W22 | frame geometry, drag strip, toggle fix, menubar, paths, IME guards, layout, z-order | OK | no action |

**Must-fix beyond the already-landed toggle rule: W4 (one CSS sweep / one selector), and
W11 for the file-open feature (contract adaptation). No other Windows blocker found.**

### Harness gap (verifier)

`tests/e2e/desktop-frame.mjs` runs the Windows mode at 1280×820 with the sidebar
expanded, so it cannot catch W4. Add one Windows case at **520×600** (or with the sidebar
collapsed before `clickFocus()`) and assert the z-leak scan is clean there too — that is
exactly where `kB3qhq_newSession(z=30)` appears above the overlay.

---

## Windows release checklist (real machine required)

Window frame / chrome
- [ ] Resize to 520×600 and to snapped half-screen; open focus mode with sidebar
      **expanded** and **collapsed**: no official button floats over the overlay
      (W4), no focusable control under the caption zone.
- [ ] Drag the window by the reserved top band; double-click maximizes; drag-to-snap and
      Snap Layouts (hover maximize) work; resize borders work.
- [ ] Minimize, maximize, restore while focus mode is open → layout/topbar stays at 60px,
      exit button stays clear; no state stuck.
- [ ] Native min/max/close buttons are clickable while focus mode is open (they are above
      web content — W8) and clicking them does not trigger overlay controls.
- [ ] Caption menubar (Application/Edit) visible and opens its native menus in focus mode;
      after Esc it is unchanged; menu popup anchors correctly (W5).
- [ ] Light and dark themes: caption-button background seam acceptable (W6); titlebar band
      colors.
- [ ] (If fullscreen is reachable) enter/leave fullscreen with focus open: topbar at 20px,
      no caption buttons, no overlap (W7).

Paths / file open
- [ ] Mention chips render in focus mode (after W11) and clicking one opens the file in
      the right sidebar with a `C:\…` workspace, a `D:\…` workspace, a UNC workspace
      (`\\server\share\…`), a path with spaces/#/?/CJK, and an absolute path outside the
      workspace root.
- [ ] Path display/tooltip is readable for long Windows paths (chips `title`).
- [ ] After opening, the user can see the opened tab (decide W12 behaviour first).

Input / IME
- [ ] Microsoft Pinyin: type Chinese in the fallback composer (borrow off) and in the
      borrowed official composer; commit with Space/Enter; Esc cancels composition
      without closing focus or collapsing the input bar; no dropped characters, caret
      stays in the textarea after composition end.
- [ ] `Ctrl+Z/Y/X/C/V/A`, select-all and context-menu copy in the overlay (composer and
      reading text).
- [ ] F hotkey with a Chinese IME active (outside inputs) and with a non-Latin keyboard
      layout (W16); Ctrl+F/Ctrl+Alt+F/AltGr+F must not enter focus mode.
- [ ] Typing `f` in the main composer does not enter focus mode; Esc while the slash/@
      popup is open closes only the popup.

Rendering
- [ ] Display scaling 100% / 125% / 150% / mixed-DPI two monitors: topbar/exit/caption
      geometry, no clipped text, no mis-sized scrollbar gutter.
- [ ] Long transcripts and the turn rail scroll smoothly at 520px width; reply toast /
      jump-to-bottom don't collide with the dock.
- [ ] System sleep/resume, window hide-to-tray then reopen with focus mode open: state is
      consistent.

---

## What cannot be verified on this macOS host (simulated-marker test limits)

The e2e/simulation applies `data-windows-titlebar` + `--dsh-windows-titlebar-height:40px`
(+ `data-platform=win32`, `data-fullscreen`) **after boot**; it proves:

- CSS-variable resolution and the official layout rules for the Windows marker;
- the plugin's own geometry (overlay padding, topbar/exit positions, strip height,
  drag-region computed style, no focusables in the band);
- DOM paint order among web elements (overlayLayer z-20 vs `[data-sidebar-toggle]` z-30,
  `[data-windows-menu]` z-1100 mock, fixed titlebar controls);
- keyboard-guard logic and synthetic composition sequencing in the same renderer.

It does **not** prove (needs a Windows machine):

1. Native caption button geometry/hit-testing above web content; the 138×40 reference
   size; whether a 60px drag region overlapping the WCO leaves min/max/close clickable.
2. Real window dragging, double-click maximize, drag-to-snap, Snap Layouts and resize
   borders through `-webkit-app-region:drag`.
3. `titleBarOverlay` background/symbol color sync and its visual seam over the overlay.
4. Real Windows IME (Microsoft Pinyin and others): candidate window, `keyCode 229`
   timing, focus retargeting during the shared-draft echo, Esc during composition.
5. Actual Windows Chromium text rendering/scrollbars/DPI scaling.
6. The Windows caption menubar is mocked (DOM structure/styling copied from
   `preload-app.cjs`, but the real host is created by the preload and its native menu
   popup path goes through `dsh-desktop:windows-menu`).
7. Windows fullscreen state and caption-button behaviour in fullscreen (unreachable in
   the current shell, so behavioural risk is low but unproven).
8. The shell's `before-input-event` shortcut interception and the mandatory-update key
   blocker as actually installed in Electron — verified by source reading only.
9. The real Windows file-open end-to-end (W11 must land first; then the W9 address
   builder and Host resolution can be exercised on a Windows workspace).
