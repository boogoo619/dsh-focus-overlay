# dsh-focus-overlay — client contract audit vs DSH desktop 0.2.2-rc.1

Audited by: contract-auditor (team task `task-1`). Date: 2026-11-10 (Asia/Shanghai).
Target: **DSH desktop 0.2.2-rc.1** — app `/Applications/DeepSeek Harness.app`,
runtime `@deepseek-ai/dsh-desktop-runtime@0.2.2-rc.1`, extracted reference tree
`/tmp/dsh-0.2.2/`, Electron shell `/tmp/dsh-desktop-shell/` (macOS + Windows share the same
renderer; only native binaries differ).
Baseline compared against: **DSH CLI 0.2.0-rc.2**, global install
`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` (every
"changed?" below is relative to that tree unless stated).
Plugin state audited: repo `HEAD 9e05d5a` + Lead's uncommitted 0.2.2 fix
(`src/client/primitives.ts`, `projectUserTextCompat`, frame strip); `lib/client.js` rebuilt
by the Lead at 13:38 local. **No `src/` file was modified by this audit.**

## Method / evidence classes

- **code** — read the actual 0.2.2 prebuilt client bundles (prebuilt CJS, source comments
  preserved) at `/tmp/dsh-0.2.2/node_modules/@deepseek-ai/*/lib/client.js`,
  the web-frontend shell bundle
  `/tmp/dsh-0.2.2/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BgUyXZcc.js`
  (which hosts the *static shell modules* incl. `dsh-client-ui-primitives` + the slots core),
  and the generated cordis service/slot catalog in
  `dsh-cordis-client-runner/lib/client.js` (authoritative method/slot signatures generated
  from the 0.2.2 sources).
- **live** — isolated 0.2.2 desktop-runtime web instance on `http://127.0.0.1:3097`
  with `DSH_HOME=/tmp/dsh-home-audit`, profile `fmtest` (plugin linked), plus a throw-away
  probe client plugin (`/tmp/dsh-probe-audit`, added only to the /tmp profile) that
  introspects `ctx` and renders primitives; driven with Playwright
  (`playwright-core` + bundled Chromium), seeded sessions from the real home.
  Live runs: 13:45–14:05. Raw probe JSON: `/tmp/audit-probe/out{,2,3,4,5}.json`.
- **code-verified** = source read only, no live exercise. **inferred** = reasoned from
  naming/structure, explicitly flagged.

---

## 1. Primitive module `@deepseek-ai/dsh-client-ui-primitives`

Status of the module contract itself: on 0.2.2 it is a **static shell module**
(`index-BgUyXZcc.js` module table `YZ()`:
`"@deepseek-ai/dsh-client-ui-primitives": FU`), **not an installable package** any more.
`dsh.client.inject` still resolves it (live boot entries show
`{id:"dsh-focus-overlay", inject:["@deepseek-ai/dsh-client-ui-primitives"]}`; plugin renders).

| Contract | Evidence | Status | Severity | Minimal fix |
|---|---|---|---|---|
| `projectUserText(text, labels)` export | 0.2.2 export table `FU` (`index-BgUyXZcc.js:194`): **absent**; live export dump: `projectUserText: "undefined"` (310 exports). 0.2.0: present (`dsh-client-ui-primitives/lib/index.js`). | **removed** | **blocker** (already fixed by Lead) | Lead's `projectUserTextCompat` (`primitives.ts`) → `UserTextRun`; live overlay renders user text again (probe2: `.fm-user` visible). |
| `MarkdownText` props: `text, streaming, labels, fileMentions, pathImages, variant, omitHtml, textInteractionSource` | impl `F4` at `index-BgUyXZcc.js:179`; labels shape expected `{code:{copyLabel,copiedLabel}, footnotes}` — confirmed by official call sites (`dsh-client-ui-tool/lib/client.js:1199`, `dsh-client-ui-trajectory:4887`). Plugin passes `text/labels/fileMentions` only. | OK | — | none |
| `labels` actually consumed (code block copy button + footnotes node) | live render with plugin's exact `markdownLabels()` shape produced a working code-block `Copy` button and a `footnotes` section (probe `renderProbe.markdown`). | OK (live) | — | none |
| `fileMentions` prop shape `{resolve(value) → {open,label,title,contextMenuProps?}}` | `dsh-client-ui-deliverables/lib/client.js:1275-1300` (`producedFileMentions`), consumed by MarkdownText inline-code path | OK (contract) — but plugin produces it wrongly, see §2.8 | — | see §2.8 |
| `Button` props: `variant` (`ghost` default / `primary` / `outline` / `toolbar`), `size` (`md` default / `sm`), `icon`, rest-spread (`disabled`,`title`,`onClick`,`aria-*`,`id`) | impl `vi` at `index-BgUyXZcc.js:132`; CSS-module keys `k1={button,md,sm,primary,ghost,outline,toolbar,icon}` same line. Live render: `_button_… _primary_… _sm_…` / `_outline_` / `_ghost_`, `disabled`/`title` forwarded. | OK (live) | — | none |
| `Modal` props: `open, onClose, title, closeLabel, description, children, footer, className, contentClassName, onKeyDownCapture, headless, backdropBlur, shortcutModal` | impl `wy` at `index-BgUyXZcc.js:132`. `headless:true` renders `children` directly in the `role="dialog"` node (portal to body). Live: dialog present, no chrome, children render. | OK (live) | — | none |
| Icon set: one `Icon…OutlineRegular` / `…OutlineMedium` component per glyph, props `{size, className}` only (no `id`/rest forwarding); fixed-size `…Outline14/16` variants **gone** | factory `M` at `index-BgUyXZcc.js:132`; export table has **no** `Icon*(14|16|12)` names (live: `oldFixedSizeIcons: []`). Also **absent in 0.2.0** — `icons.ts`'s `…14` fallbacks are dead on both. Live: `<svg width=14 height=14 data-icon="dsw-icon-check-outline-regular">`. | changed (already handled) | — | none; note `Icon…14` first-choice names can never resolve on 0.2.x |
| User-text primitives: `UserTextRun({text})` → `<span class="_plainRun_…">`; `UserMessageBubble` → `<div class="_bubble_…">`; `ReferenceChip({appearance,label,title,onActivate,contextMenuProps})`; `extractMarkdownPlainText(text,{mode})` | `index-BgUyXZcc.js:137`; live render confirmed `_plainRun_`/`_bubble_` classes. The official chip parsing lives in ui-conversation's internal `UserText` + `userText` registry (not exported). | changed (replacement available) | — | Lead's fix is the right shape; user-text `@session`/`/skill` chips are the only cosmetic loss (official renderer keeps them). |
| `ICON_SYMBOLS` sprite (icons are `<use href="#dsw-icon-…">`) | sprite installed by `dsh-client-ui-theme` (`installIconSprite`, `dsh-client-ui-theme/lib/client.js:1424-1468`, prepends `<svg data-dsh-icon-sprite>` to body) | OK (live icons render) | — | none |

---

## 2. Client services

### 2.1 `slots` (cordis client slot system; static shell module `dsh-client-ui-slots`)

Core semantics (`SlotCore`, `index-BgUyXZcc.js:194` region + catalog
`dsh-cordis-client-runner/lib/client.js:1518`, `:4230/:4918/:5656/:5948`):
`ctx.slots.inject(key, cb)` waits for a slot **declaration** and runs `cb` on each declaration
lifetime; `ctx.slots.register(options, component)` requires the slot to be already declared and
enforces per-kind options: `keyed`⇒`key`, `list`⇒`id`, `single`⇒one occupant, `chain`⇒`select`;
`order` sorts list entries; `label` is `string | (() => string)`; both are effects owned by the
caller's fiber. Live: `inject.length === 2`, `register.length === 2`, exactly as called.

| Slot | Kind/scope (live) | Plugin registration | Status | Severity |
|---|---|---|---|---|
| `shell.overlay` | list / root | `{name,id:'focus-mode-overlay',order:1000}` | OK (live entry present; overlay mounts, `z-index:2147483000`, `pointer-events:auto` re-enables the click-through layer) | — |
| `conversation.session.header.actions` | list / session | `{name,id:'focus-mode-toggle',order:1000,label:()=>t('toggle')}` | OK (live entry present; 专注 button renders in the header) | — |
| `settings.plugin.item` | **not declared** (`spec(name) === null`, 0 entries; also absent in 0.2.0) | `inject` waits forever ⇒ callback never runs | OK no-op (dead code, harmless) | — |
| `plugins.bundle.config` | keyed / root | `{name,key:'dsh-focus-overlay'}`; owner passes `{view:'summary'|'page', form?}`; plugin renders only for `view==='page'` | OK (live entry present; `openBundle('dsh-focus-overlay')` live opened the bundle detail page) | — |
| `settings.onboarding` | list / root | `{name,id:'dsh-focus-overlay',order:10}`; owner props `{stepId, explicit?, complete, openSection}` | OK (live entry present alongside `welcome-notice`, `deepseek-official`) | — |

### 2.2 `locale`

`register(ns, dicts)` two-arg typed form (all baseline locales in one call; zh+en required) and
`bind(ns)` both present (catalog `dsh-cordis-client-runner/lib/client.js:1326-1420`;
implementation `dsh-client-locale/lib/client.js`). **Live**: `focus` namespace registered from
the plugin's `{zh, en}` dictionaries; `bind('focus')('toggle') === '专注'`,
`bind('focus')('exit') === '退出专注 (Esc)'`. Status **OK**.

### 2.3 `sessions` (injected `ctx.sessions`)

| Contract | Evidence | Status |
|---|---|---|
| `sessions.list` is a snapshot store `{getSnapshot,subscribe}`; snapshot `{ids, byId, phase, projectionsBySession}` | live topKeys exactly that; catalog type `SessionListState` (`dsh-cordis-client-runner:2337`); projection impl `dsh-api-session-controller/lib/client.js:4165-4215` | OK |
| `list.current` — session selection on the list snapshot | **absent** (live `hasCurrent:false`); already absent in 0.2.0 (no `current` in 0.2.0 controller) | removed in 0.2 (pre-existing) — plugin's fallback chain handles it |
| current selection = `byId[id].retainedBy.mainView > 0` | live: main session row `retainedBy:{mainView:1, sidebarView:1}`; same read used by many official packages (e.g. `dsh-client-ui-session/lib/client.js:933,990`; `dsh-client-ui-workspace:100`) | OK (live) |
| **`byId[id].cwd`** (source for `sessionFileAddressOf`) | live: **53/53** list rows carry a non-empty `cwd`; row shape `{id,displayTitle,running,retainedBy,blank,updatedAt,formatStatus,cwd?,title?,parentId?,origin?}` (`dsh-api-session-controller/lib/client.js:4165`) | **OK — still valid on 0.2.2** |
| `byId[id].displayTitle` (overlay title) | live rows carry it (e.g. “适配最新 Windows 和 Mac 桌面版 dsh”) | OK |
| `sessions.binding(id)` → `{sessionId, session, eventSource, ctx}`; `undefined` when the session is not retained | live: full shape; for an unretained session live returned `undefined` (plugin's `watch()` returns safely) | OK |
| `binding.session` (`SessionFace`): `getSnapshot`, `subscribe`, `loadOlder`, `prompt(content,'queue')`, `updateQueue` | live proto list; `ISession` catalog type (`dsh-cordis-client-runner:2089`) | OK |
| Session snapshot fields — **`running` still there** | live proto/keys: `{sessionId,pendingSubmissions,running,subagent,removed,openState,openError,hasMore,loadingOlder,promptError,blank,lastAgentError,promptAttempted,awaitingFirstTurn}` (`dsh-api-session-controller/lib/client.js:2930-2953`; identical in 0.2.0) | OK |
| Session snapshot `nodes/partial/runningCalls/pending/queue` | **all absent** (live `hasQueue:false, hasPending:false, hasNodes:false,…`). Also absent in 0.2.0's `buildSnapshot()` — so *pre-existing*, not a 0.2.2 regression | changed in 0.2 (plugin already migrated to `uiConversation` legacy slice); only `snap.queue` still read (dead, see §2.9) |
| `snap.promptError` = `{op:'send'|'stop', error}` | live `promptError:null`; type in `dsh-cordis-client-runner:2218`; set at `dsh-api-session-controller:2372/2443` | OK |
| `face.prompt(...)` result `{ok,value}` / `{ok,error}` | `dsh-api-session-controller:2334-2379` | OK (fallback path only) |

### 2.4 `uiSession` (not catalogued = internal; read via `ctx.get('uiSession')`)

Implementation `dsh-client-ui-session/lib/client.js:780-1060`. Live keys: `current`,
`sessionStatus`, `pendingInteractions` absent.

| Contract | Evidence | Status |
|---|---|---|
| `uiSession.current` source: `getSnapshot()/subscribe` → `{key: sessionId, ctx, hooks, keyedHooks, props}` | live snapshot `key:'session-ccb3…'`, `props.sessionId` also present | OK (internal member, no 0.2.2 regression; identical on 0.2.0) |
| `uiSession.sessionStatus` source → `Map<sessionId,{running,pendingInteraction,completionUnread}>` | live: `Map` size 53; entries have exactly `completionUnread,pendingInteraction,running`; `pendingInteraction` is `undefined` when none. Built in `publishStatus()` `dsh-client-ui-session:1000-1024` | OK (matches `pendingInteractionFromStatus`) |
| `uiSession.pendingInteractions` map (0.1.2 shape) | **undefined** (removed/moved before 0.2.0 too); plugin's branch is dormant | OK no-op |

### 2.5 `uiConversation` (internal; `ctx.get('uiConversation')`)

Implementation `dsh-client-ui-conversation/lib/client.js:4067-4263`.

| Contract | Evidence | Status |
|---|---|---|
| `binding(id)` accepts a session id (or binding); throws when unknown/inactive; returns `BoundConversation` with `{target, snapshot, openTurn, viewStore, …}` | live binding proto: `target, activate, dispose, snapshot, openTurn, …`; no `legacy` member on the binding itself | OK (plugin calls `.target('chat')`, and catches) |
| `target('chat')` → `{getSnapshot,subscribe}`; subscribing activates the target | live chat snapshot topKeys `{order,nodes,locations,navigation,timeline,legacy}`; `orderLen:224`, `nodes.values().length:232` | OK (live) |
| chat `legacy` slice `{nodes, turnTimings, turnEnds, partial, runningCalls}` | live `legacyKeys` exactly that; `nodesLen 229, partial null, runningCalls []`; projection `legacyContribution`/`LegacySliceBuilder` `dsh-client-ui-chat/lib/client.js:11220-11400`, snapshot `:11503-11515` | OK (live) |
| legacy node kinds/fields consumed by `buildItems`: `user/steering{content:[{type:'text',text}],seq}`, `assistant{blocks[{kind:'text'|'image'}],turn,step,seq,interrupted?}`, `tool-result{call:{name}},turn-error{message},turn-max-tokens,context/compaction/command` | live legacy kinds `{user:1,context:4,assistant:89,tool-result:134,turn-error:1}`; samples: user `{content:[text],seq,…}`; assistant `{blocks,turn,step,seq,…}`; tool-result `{call:{name:'bash'},…}`; turn-error `{message,…}`. Node builders: `toAssistantBlocks` `dsh-client-ui-chat:9882`, `finalNode` `:10111` (`interrupted:true` flag), `rootResult` `:12302` | OK (live) |
| chat `nodes.get(key)` → node with `anchorSeq`; `navigation.items()` → `[{turn,anchorKey,prompt,response}]` | live node `{key,kind,anchorSeq:17.9,data,location,…}`; item keys exactly those (`turnNavigationItem` `dsh-client-ui-chat:10435`, `items()` `:10832`) | OK (live) |
| `timeline.turns` map of Turn faces `{turn,start,end,status,steps,data}` where `data.get(key)` is the turn data store | live turn face has `data` with `.get` and `status:'closed'` — needed for the §2.8 fix | OK (live) |
| `uiConversation.imageUrl(sessionId, attachment)` (2 args, promise of URL; cache) | `dsh-client-ui-conversation:4189-4200` (`images.resolve`) — **code-verified**, no image attachment in seeded sessions to exercise live | OK (code-verified) |
| `conversation.resolveImage` legacy resolver | `ctx.get('conversation')` live has no `resolveImage` (removed); plugin falls back only when `uiConversation` absent, so unused on 0.2.2 | OK no-op |

### 2.6 `conversation.input.for(actx)`

Implementation `dsh-client-ui-conversation/lib/client.js:16127` (`InputHub.for`) +
`SessionInputShell` `:15357`.

- Signature: `for(sessionScopeCtx)` — resolves the session from the scope ctx and **throws**
  “conversation.input.for requires a retained Session scope” if that context's binding is not
  live. The plugin passes `sessions.binding(id).ctx`, i.e. the Agent-session scope context, and
  wraps in try/catch (falls back to plugin-local draft + `session.prompt`).
- Live: `conversation.input.for(binding.ctx)` returned the facade; facade has
  `setDraft(text)`, `submit(mode='queue', source?)`, `state` store, `notify`, `focus`, `editor`,
  `notices`, `actions`. `state.getSnapshot()` keys: `{draft, attachmentIds, draftRev, phase,
  occurrences, queue}` (`compose()` `dsh-client-ui-conversation:16046-16056`).
- Plugin usage `inputFace.setDraft(v)`, `inputFace.submit('queue')`, `inputFace.state.*` is
  **OK (live)**. Note `submit.length === 0` (default args) but positional `'queue'` is honored.
- Fallback contract `binding.session.prompt([{type:'text',text}], 'queue')` is valid too
  (`ISession`, `dsh-api-session-controller:2334`).

### 2.7 `configForms` (`ctx.get('configForms')`)

Provider `dsh-client-ui-settings/lib/client.js:1267-1340` (`ConfigForms.get(entryId)` returns a
`ConfigFormController` form: `getSnapshot/subscribe/set/unset`; snapshot
`{status,writable,revision,base,user,value}`).
Official precedent for the exact call used by the plugin: `dsh-client-ui-chat:15345`
(`ctx.configForms.get("ui-chat")` then `.getSnapshot().value?...`, `.subscribe`, `.set`).

Live: `get('ui-chat')` → `status:'ready'`, `writable:true`,
`value:{collapseTiming, foldedReplies, linkOpening, performanceUsage}` — **no `transcriptView`
key** (schema is `.loose()` with no default until the user saves one), so the plugin's
`transcriptViewOf` correctly falls back to its own `compact` default.

0.2.2 value domain (`dsh-client-ui-chat:14778-14837`):
`compact | standard | detailed | verbose` (+ legacy saved `normal`→detailed, `expanded`→detailed).
Official desktop default is `standard` (`:15374`, `"dshDesktop" in globalThis`), non-desktop
`detailed`. The plugin maps only literal `'compact'` to its fold mode, everything else to
“normal/expanded”.

Status: **changed (acknowledged, minor)** — the 4-mode enum is new; a user-saved
`standard/detailed/verbose/normal/expanded` now makes the overlay render *expanded*, and the
official desktop `standard` default is not mirrored. Not a break; decide if the overlay should
fold on `standard` too (its own doc says “only compact folds”). Severity **minor/cosmetic**.

### 2.8 `chatFileMentions` (`ctx.get('chatFileMentions')`) — **broken owner shape**

Provider: `dsh-client-ui-deliverables/lib/client.js:2684`:
`ctx.provide("chatFileMentions", { forClosing(owner, _sessionId, getFileTriggerProps) })`.
`forClosing` calls `selectProducedFiles(owner)` → `owner.turn.data.get("deliverables")` (`:1146`)
and `presentedForClosing(owner)` → `owner.turn.data.get(...)` (`:1258`); the official caller is
ui-chat's turn-tail owner `{turn: <Turn face>, seq, openFile}` (`dsh-client-ui-chat:8423`,
wired at `:9285`), where `<Turn face>` is `node.location.turn` from the **Chat** snapshot.

Plugin (`FocusView.tsx::fileMentionsFor`) passes
`{turn: {turn: node.turn, step: node.step}, seq: node.seq, openFile}` — a plain object.

- Live: `chatFileMentions.forClosing(pluginOwner, sessionId)` **throws**
  `TypeError: Cannot read properties of undefined (reading 'get')` at `selectProducedFiles`
  (probe out2/out3; plugin's try/catch swallows it) ⇒ `fileMentions` is always `undefined` on
  0.2.2 ⇒ **inline-code file mentions in assistant rows are not clickable in the overlay**.
- Same failure on 0.2.0 (`dsh-client-ui-deliverables:1148` also uses `owner.turn.data.get`),
  so this is a **pre-existing bug, not a 0.2.2 regression** — but it is a real 0.2.2 behavior
  gap.
- Positive live case not obtained: seeded sessions' turns had `deliverables.produced.length=0`
  (probe out3), so even the official owner returned `undefined` on the sampled sessions.
  Fix is nevertheless unambiguous from the code.

**Minimal fix** (suggested; no src edits made here): inside `fileMentionsFor`, take the Chat
snapshot the overlay already holds and pass the real Turn face:

```ts
const chat = chatSource.getSnapshot()                 // uiConversation.binding(id).target('chat')
const turnFace = chat?.timeline?.turns?.get(node.turn)
const owner = turnFace && turnFace.status === 'closed'
  ? { turn: turnFace, seq: node.seq, openFile: (p, o) => openMentionedFile(p, o) }
  : undefined
return owner ? chatFileMentions.forClosing(owner, currentId) : undefined
```

(3rd arg `getFileTriggerProps` optional — `producedFileMentions` uses `?.` on it.)
Severity: **major-feature-loss / medium** (silently dead affordance, no crash). Does not block
mounting or reading; blocks “click a mentioned file” in the overlay only.

### 2.9 Other services / small contracts

| Contract | Evidence | Status | Severity |
|---|---|---|---|
| `pluginNavigation.openBundle(packageName)` | provider `dsh-client-ui-plugin-manager/lib/client.js:7807` (`ctx.reflect.provide("pluginNavigation", {openList, openBundle})`); live service has both keys and `openBundle('dsh-focus-overlay')` opened the Plugins page on the bundle's detail (`v0.12.4`, description visible) | OK (live) | — |
| `sidebarRight.openResource(address, options{params,destination,kind,…})` | `dsh-client-ui-sidebar-right/lib/client.js:2494/2531`; requires `dsh-resource://` prefix, claims a registered tab type, throws otherwise. Live: opened `package.json` → tab title `package.json`, `[data-textpreview-state=text]`; invalid `/not-a-resource` throws (`no registered tab type claims …`) — plugin's try/catch handles it | OK (live) | — |
| `dsh-resource://file/session/<sessionId>/<path>` address grammar | official builder+parser `dsh-client-ui-sidebar-documentpreview/lib/client.js:35-100` (identical inline copy in `dsh-client-ui-open-in-app:13-80`, `dsh-client-ui-skill:12-65`): `encodeSegment` = `encodeURIComponent` with `%3A`→`:`, backslashes→`/`, leading `./` stripped, workspace-root reduction. **Plugin's `sessionFileAddressOf` is a byte-identical reimplementation** (verified by reading both). `line` travels as `options.params.line` → `navigation.params.line` (`:635/:759`) | OK (live for open; grammar code-verified) | — |
| `workspaces` service `openPath` | **absent** on 0.2.2 (catalog `dsh-cordis-client-runner:1771-1880` lists create/rename/delete/archive/insert…; live keys show `openPath` undefined; also absent in 0.2.0) | removed (pre-existing) — plugin's preferred branch is dead but the `sidebarRight` fallback runs | — |
| `settingsScope` service | live `ctx.get('settingsScope') === undefined`; 0.2 retired it (plugin guarded) | removed — OK no-op | — |
| `snap.queue` read (queued badge) | live session snapshot has **no `queue`**; input facade *does* expose `state.queue` (`dsh-client-ui-conversation:16053`). Same dead read on 0.2.0 | dead read, cosmetic | minor: `const queueCount = inputState?.queue?.length ?? 0` |
| `[data-composer-seat]` / `[contenteditable=true]` / `[data-composer-card]` / `[data-input-scroll]` / `[data-conversation-scroll]` / `[data-chat-flow-kind]` / `[data-slot=…]` | live: seat+editable present; other markers found in `dsh-client-ui-conversation`/`dsh-client-ui-chat` bundles | OK (live for seat/editable; code for the rest) | — |
| `window.__ModuleLoader__` bundle format (`load({id,factory:(require)=>…})`, CJS) | plugin's `lib/client.js` matches; boot manifest lists plugin entry; probes confirm | OK (live) | — |

---

## 3. Auto-focus signal on 0.2.2 (explicit answer)

**The `running` edge is still on the session snapshot; nothing moved.**

- live: `sessions.binding(id).session.getSnapshot()` contains `running` (type boolean),
  plus `hasMore/loadingOlder/openState/promptError/blank/…`; a `true→false` edge can be
  observed through `session.subscribe` exactly as the plugin does.
- Also live: `uiSession.sessionStatus` is a `Map<sessionId,{running,pendingInteraction,
  completionUnread}>` (same bit mirrored, plus pending interaction and unread completion).
  `completionUnread` is only set for sessions that are **not** the main-view session
  (`ui-session:967-976`), so it is *not* a replacement for the main session's running edge —
  the plugin's choice of `binding.session.running` is correct on 0.2.2.
- Settle detection inputs are intact (live): chat `legacy.partial` (null when stable),
  terminal node kinds `assistant` / `turn-error` / `turn-max-tokens`, and the
  `interrupted:true` flag on finalized aborted assistant nodes (`ui-chat:10111-10160`).
- Caveat (unverified end-to-end): no live model run was performed in this audit, so the actual
  `running true→false` edge firing against a **finalized** assistant node is inferred from
  code, not observed. Everything the plugin *reads* was verified to exist with the expected
  shape.

**`byId[id].cwd` for the file-address builder: still valid on 0.2.2** — present on all 53
live list rows, plus `retainedBy.mainView` for current-session resolution.

---

## 4. CSS tokens referenced by `src/client/styles.ts` (+ Turn/Width components)

Probed **computed values at the overlay DOM position** (live overlays mounted; probe element
appended at body level plus reads on `.fm-overlay` / `.fm-body`; theme light, plain browser).
All `--dsw-*` tokens below resolve to concrete 0.2.2 values at the overlay position:

| Token | live value | Status |
|---|---|---|
| `--dsw-alias-bg-base` / `-label-primary` / `-label-secondary` / `-label-tertiary` / `-label-caption` / `-label-dimmed` / `-label-primary-foreground` | `#fff / #0f1115 / #61666b / #81858c / #adb2b8 / #e1e5ee / #fff` | OK |
| `--dsw-alias-border-l1 / -l2 / -l2-darkmode-thin / -l4` | `#0000000a / #0000001a / #0000001a / #00000029` | OK |
| `--dsw-alias-interactive-bg-hover`, `bg-layer-1/2/3`, `bg-overlay`, `brand-primary` | `#2631480f, #fff…, #e9ecf2, #0f1115` | OK |
| `--dsw-alias-button-info-fill/-hover`, `state-business-primary`, `state-error-primary`, `state-warn-primary/-secondary/-tertiary` | `#4176e6 / #7aaaff / #4176e6 / #ec1313 / #f59e0b / #f7ad31 / #fef5e7` | OK |
| `--dsw-alias-scrollbar-bg-l2`, `scrollbar-hover-l1/l2` | `#e5e5e5 / #d4d4d4 / #d4d4d4` | OK |
| `--dsw-elevation-panel`, `--dsw-shadow-lv2` | defined | OK |
| `--dsw-font-family`, `--dsw-font-markdown-base`, `--dsw-font-s-strong-14`, `--dsw-font-xs-strong-13`, `--dsw-font-xxs-12` | defined | OK |
| `--dsw-specific-bubble`, `-input-major`, `-sidebar-nav-item-active-accent`, `--dsw-static-deepseek-200/-500` | `#edf3fe / #fff / #e4edfd / #d3e2ff / #4176e6` | OK |
| `--dsh-content-font-size` (14px), `--dsh-content-font-delta`, `--dsh-content-font-size-secondary`, `--dsh-content-font-delta-secondary` | defined on body | OK |
| `--dsh-scrollbar-thumb`, `--dsh-scrollbar-thumb-hover` | `#e5e5e5 / #d4d4d4` (body) | OK |

**Dead at the overlay DOM position (fallbacks in use):**

| Token | Where used | Status |
|---|---|---|
| `--dsh-chat-flow-gap` | `.fm-inner>*` margin | **dead now and on 0.2.0** — defined only inside the chat column's CSS-module scope (`.flow*` selectors, 12px) and never inherited into `shell.overlay`; overlay silently uses fallback `16px` while official is `12px`. Cosmetic (vertical rhythm slightly larger). Fix (optional): use `12px` fallback / read a token that reaches the layer. |
| `--dsh-conversation-viewport-height` | TurnRail band | **dead at overlay position both generations**: set inline on the conversation scroller element (`dsh-client-ui-conversation:20500`), not inherited by the overlay; TurnRail fallback `100dvh` applies. Pre-existing, cosmetic/fine. |
| `--dsh-composer-height` | TurnRail band | same as above (`:20499`; fallback `152px`). Pre-existing. |

**Desktop frame tokens** (Lead's frame strip) — live-verified with post-boot markers on the
mounted overlay: `--dsh-frame-top-clearance`/`--dsh-frame-overlay-top` come from
`dsh-client-ui-layout` (`lib/client.js:74` CSS: darwin 48px, `html[data-windows-titlebar]` 40px,
`+20px` ⇒ 68/60, fullscreen 20px); live resolved overlay `padding-top`/strip height/topbar top
= **68 / 60 / 20**, plain browser 0 (fallback). `html[data-platform=darwin] [data-window-drag]
{-webkit-app-region:drag}` lives in the shell CSS
`dsh-web-frontend/dist/assets/index-lh_YM6sT.css` (not in the layout plugin); Windows strip gets
drag from the plugin's own CSS rule. Everything the Lead implemented matches the 0.2.2 contract.
No newly dead `--dsw-*` token was found.

---

## 5. Must-fix before desktop release

1. **`projectUserText` removed in 0.2.2** — hard crash of the overlay for any session with a
   user message (React #130 era failure). **Already fixed by the Lead** with runtime-resolved
   `projectUserTextCompat` → `UserTextRun`; live overlay now renders user bubbles on 0.2.2.
   No regression found in the replacement path (plain run keeps `white-space: pre-wrap`; only
   `@session`/`/skill` chips inside user text are lost — cosmetic).
2. **`chatFileMentions.forClosing` owner shape** (§2.8) — no crash (try/catch), but the
   overlay's inline-file-mention click affordance is **silently dead on 0.2.2** (and was
   already dead on 0.2.0). Fix is 5 lines using the Chat snapshot's real Turn face. **This is
   the only surviving real feature break in the audited client contract.** Not a mount
   blocker; decide whether it gates the release (recommend fix now — cheap).

Nothing else blocks the desktop release: no other removed/renamed export, service, slot, or
DTO field used by the plugin was found. No new console errors on 0.2.2 during mount/open/close
cycles in the isolated instance.

## 6. Behavior changes / cosmetic debt (non-blocking)

- **Dead queued-count badge**: `snap.queue` no longer exists (also on 0.2.0) → the
  “已排队 N” badge never shows. Fix: `inputState?.queue?.length`. Cosmetic.
- **`--dsh-chat-flow-gap` dead at overlay position** (pre-existing): overlay uses 16px where
  official chat uses 12px. Cosmetic.
- **`transcriptView` enum widened** to `compact|standard|detailed|verbose` (+legacy
  `normal|expanded`); plugin folds only on literal `compact`, so a user-saved
  `standard/detailed/verbose` shows the overlay expanded, and the official desktop `standard`
  default is not mirrored. Non-blocking; decide intended mapping.
- `--dsh-conversation-viewport-height` / `--dsh-composer-height` never reach the overlay layer
  (TurnRail uses `100dvh/152px` fallbacks) — pre-existing, geometry only.
- Plugin metadata (`package.json#dsh.compatibility.dshReleases`) still ends at
  `0.2.0-rc.2`; consider adding `0.2.2-rc.1: compatible` (metadata only, no runtime effect).
- `icons.ts` tries `Icon…Outline14/16` names first; those variants do not exist in 0.2.x
  (already gone in 0.2.0) — the `…Regular` fallbacks carry the load. No action needed.
- `settings.plugin.item` registration/inject is dead code on 0.2.x (slot not declared); the
  dsh 0.2 `plugins.bundle.config` surface is the live one and works (live bundle page opened).
- `snap.pending` / `uiSession.pendingInteractions` legacy answer-card carriers are dormant
  (pre-0.1.2 only); 0.2.2 answer card path via `sessionStatus.pendingInteraction` is correct.

## 7. What was NOT verified (be explicit)

- **Auto-focus end-to-end**: not exercised with a live model run; the existence/shape of every
  signal the code reads is verified, but the actual `running:true→false` + finalized-node edge
  is inferred from source (and from the plugin's own unit tests, not run here).
- **`uiConversation.imageUrl`**: code-verified only — no image attachment in the seeded
  sessions to load live.
- **`MarkdownText` `fileMentions` clicking**: resolver shape code-verified; a live positive
  case (a turn whose `deliverables.produced` is non-empty) was not found in the seeded
  sessions, so the mention-click path was not exercised end-to-end even for the official
  owner shape.
- Windows: audit driven on macOS with the same renderer; simulated `data-windows-titlebar`
  markers only (frame tokens/strip verified live, native caption zone/titlebar overlay cannot
  be exercised here — see `docs/windows-desktop-audit.md`, task-2).
- Real desktop GUI on `:55674` was not touched (isolated `:3097` instance only).
