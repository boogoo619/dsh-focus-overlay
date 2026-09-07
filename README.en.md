<h1 align="center">dsh-focus-overlay</h1>

<p align="center">
  <a href="README.md">中文</a> | English
</p>

<p align="center">
  A <b>focus mode</b> for the DeepSeek Harness (DSH) web GUI: one click to a full-screen reading overlay that hides the header, composer and sidebars, folding the AI tool-call flow into official-style count summaries — leaving only the conversation between you and the AI.<br>
  Text, images, the turn rail, width handles and the answer card all reuse or 1:1 replicate official components, matching the chat view's look.
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/dsh-focus-overlay" alt="npm version">
  <img src="https://img.shields.io/npm/dm/dsh-focus-overlay" alt="npm downloads (monthly)">
  <img src="https://badgen.net/badge/license/MIT/green" alt="license">
  <img src="https://badgen.net/badge/dsh/%3E%3D0.1.2-rc.1/blue" alt="dsh version">
</p>

## Features

- **Full-screen reading** — an overlay registered additively into `shell.overlay`, covering header / composer / sidebars, giving all vertical space to the conversation
- **Folded tool calls** — an assistant turn collapses into one official TurnProcess-style count line, clickable to expand the full work detail
- **Turn navbar** — a right-side rail 1:1 replicating the official TurnNavigator: one mark per turn, hover previews, click to jump
- **Bottom dock** — a compact input bar appears at the live edge and shares the main composer's draft; AI questions and approvals expand into an in-place answer card, so you never leave focus to reply
- **Auto-focus & reminders** — after a reply completes normally, optionally auto-enter focus at your question; while in focus, get a toast for a new reply or when the AI is waiting on you
- **Width handles** — draggable strips beside the content column (official WidthHandle replica) that resize the reading column live and persist
- **Hotkey F** — press `F` anywhere to enter focus mode instantly (toggleable in settings); typing in an input never triggers it

These features are designed to give **small screens** more content space: tucking away the persistent header/composer and tool steps lets the conversation use as much of the screen as possible.

## Screenshots

**Off — the normal chat view**

![Off: the normal chat view](screenshots/before.png)

**On — focus mode**

![On: focus mode](screenshots/after.png)

<!-- Drop your screenshots into screenshots/:
     - before.png — the normal chat view (header / composer / tool cards)
     - after.png  — focus mode (full-screen overlay + summary line + right-side navbar + bottom dock)
     Optionally add navbar.png / card.png as navbar and answer-card close-ups. -->

Once in focus mode, an assistant turn no longer shows every step — it folds into a single official-style count line:

> 12 tool calls · 4 messages · 1 subagent

Click the line to expand that turn's full work detail (per-category one-line summaries: commands, edits, searches, reads, and more).

## Capabilities

| Feature | Description |
| --- | --- |
| Full-screen overlay | Registered into `shell.overlay` (additive, `replaceRisk: none`) — covers header / composer / sidebar; the thin top bar keeps only the session title and an exit button |
| Official rendering primitives | Assistant text through official `MarkdownText` (GFM + code highlighting + TeX + code copy buttons + footnotes); user messages through `MessageText`; buttons, modals and icons are all official primitives |
| Image resolution | Assistant `image` blocks resolve through `uiConversation.imageUrl` (the dsh 0.1.2+ session-authorized image cache), falling back to the legacy resolver on older dsh |
| Tool-call folding | Follows the official "transcript view" preference (normal / compact); compact mode folds each turn's work part into a "N tool calls · M messages · K subagents" disclosure line ("Thought for a while" when nothing is countable), clickable to expand the full detail; steering messages always stay top-level, never buried; the last turn stays unfolded while streaming |
| Categorized summaries | The expanded detail counts tools by family: commands / edits / searches / reads / directory listings / subagents / todos / goals / workflows / skills / questions / plans / background jobs / context injections |
| Full-history load | dsh 0.1.2 pages history by turns; opening focus drives `loadOlder` to the session start (bounded, aborted on unmount) for a complete reading view |
| Precise scroll preservation | Opens at the message you're reading in the chat (chat anchor key → `seq`); an anti-drift corrector re-steadies the position against history prepends and async layout shifts |
| Turn navbar (TurnRail) | A 1:1 replica of the official TurnNavigator: one mark per turn, the active mark follows scroll, a hover/focus preview card (1-line prompt + 3-line response), click to jump, 24px fade bands at each end, `prefers-reduced-motion` support; auto-hidden under 2 turns |
| Width handles (WidthHandle) | A drag strip on each side of the column, 1:1 replica of the official WidthHandle: symmetric on both sides (2× outward), rAF-throttled live drag, pointer glow indicator, commit-on-release persisted; 640px floor + 88px edge budget per side |
| Back to latest | A centered "↓" floating button when you scroll away from the bottom with no draft |
| Bottom dock | Five mutually exclusive forms decided by one pure selector: answer card / waiting toast / input bar / collapsed pill / jump-to-bottom; the compact bar appears when you reach the bottom (48px hysteresis band) |
| Shared draft | The bar wires the official per-session input machine (`conversation.input.for`): text typed before entering focus is already here, and text typed here is still in the main composer after leaving; on older dsh without the input service it degrades to a plugin-local draft |
| Input bar details | `Enter` sends (queue delivery — queued while the AI runs, with a "Queued N" badge), `Shift+Enter` newlines, IME-composition safe, auto-growing; send failures surface an error line; a draft containing references/commands warns to edit outside focus mode; with a draft, clicking the conversation folds the bar into a blue-dot pill, one click back with the caret in place |
| Reveal-on-send | After sending a long message from the live edge, the view scrolls up just enough to fully reveal the row — never hidden behind the dock; sending from up in history never scrolls |
| Answer card (pending interaction) | Built on the dsh 0.1.2 `uiSession` pending-interactions service: the question card replicates the official QuestionComposer (numbered single-select / checkbox multi-select, a "Recommended" badge, custom answers, one batched submit, an "answer everything" nudge); the approval card replicates the PlanReviewPanel warn strip (allow / deny, showing tool name and reason); a rejection keeps its error on the card; older dsh falls back through a legacy adapter |
| Auto-enter focus | After a reply **completes normally**, auto-open focus at your question; abnormal endings (stop / error / max-tokens / interrupt) never fire — the judgement waits for a stable snapshot (streaming tail drained) first |
| Reply / waiting reminders | In focus, a one-shot "New reply ready + View" toast on completion (auto-dismissed after 6s); a question/approval raises "AI is waiting for your reply + Answer", whose button expands the in-place answer card — auto-cleared once answered, never leaving focus |
| F hotkey | Press `F` anywhere to enter focus mode instantly (default on, toggleable in settings); never fires while typing in an input or editable element, modifiers and auto-repeat ignored |
| Esc peels layer by layer | Answer card → input bar → focus mode, one layer per press; Esc mid-IME-composition cancels the composition first |
| i18n | Chinese / English copy registered under the `focus` namespace, follows the UI language |
| Plugin configuration card | A collapsible card under "Settings → Plugins → Plugin configuration", preferences persisted to `localStorage`; the Node half registers the same settings namespace (schemastery schema) so the tab dispatches it |
| First-run onboarding | After installing, the welcome page shows a one-time "Focus Mode" intro (feature overview + in-place configuration) as a `settings.onboarding` step with its own versioned seen-flag |
| Official preference sync | Reads the official "transcript view" preference (normal / compact); flipping it applies immediately |
| Render error boundary | The overlay content is wrapped in an error boundary: one render crash never bricks the Focus button — the next open retries |
| DSH-better-sidebar compatibility | While in focus, a `<body>` marker makes the package stylesheet hide better-sidebar's top-right panel toggles and any open right/bottom panels (and release the squeezed layout); restored on exit |
| Legacy compatibility mode | On dsh < 0.1.2 missing the new services, the overlay degrades gracefully (legacy snapshot adapters) with a one-time console notice — no crash |

## Install

Requires the `dsh` CLI (`>= 0.1.2-rc.1`) and Node `>= 22.19.0`.

**From npm (recommended)**

```sh
dsh plugin --profile web add dsh-focus-overlay
dsh web
```

> If `add` doesn't install the latest version, pnpm's `minimumReleaseAge` (minimum release age) security policy is at work: by default it won't resolve a version as `latest` within **24 hours** of publication, falling back to the previous stable release. To install the latest immediately, pin the version explicitly:
>
> ```sh
> dsh plugin --profile web add dsh-focus-overlay@<version>
> ```
>
> Or wait 24 hours, then re-run the plain `add` command.

**From GitHub**

```sh
dsh plugin --profile web add github:boogoo619/dsh-focus-overlay
dsh web
```

> A git install pulls the **source** and builds it in place via the `prepare` script. pnpm ≥10 refuses to run `prepare` until you allow it; the first `add` fails, then follow the `dsh` hint and add the exact package key to that profile's `pnpm-workspace.yaml`:
>
> ```yaml
> allowBuilds:
>   dsh-focus-overlay: true
> ```
>
> Then re-run `add`. **This authorization lets the package's code run on your machine at install time** — only grant it to sources you trust, and pin the commit (`github:boogoo619/dsh-focus-overlay#<sha>`).

Restart `dsh web` after install.

> **First run**: after restarting, the welcome page shows a one-time "Focus Mode" intro that explains the features and lets you configure them in place; all of these settings can be changed anytime in "Settings → Plugins → Plugin configuration".

## Usage

1. Open a session and click the **"Focus"** button in the session header action row (or press `F` — toggleable in settings).
2. You enter the full-screen focus view: the thin top bar keeps only the session title and exit, the conversation only, with tool steps folded into count summary lines; history pages in automatically for the full session.
3. Hover the right-side navbar to preview and click to jump; drag the strips beside the column to resize it live. The compact input bar appears when you reach the very bottom (a "↓" button shows when you scroll away with no draft).
4. Reply right in the bar: `Enter` sends, `Shift+Enter` newlines (queued while the AI runs), drafts shared with the main composer; clicking the conversation folds it into a blue-dot pill. AI questions/approvals raise an "Answer" button that expands the in-place card for options, free text, or approvals.
5. `Esc` peels back layer by layer (answer card → input bar → focus mode); or click "Exit focus" to return — the original UI is untouched.

> **Compatibility note**: if [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) is also installed, entering focus mode auto-hides its top-right panel toggle buttons and any open right/bottom panels (releasing the squeezed layout); they're restored as they were on exit, without touching that plugin's layout state.

## Settings

In the sidebar "Settings → Plugins → Plugin configuration", expand the "Focus Mode" card:

| Option | Description |
| --- | --- |
| Auto-enter focus mode when the AI finishes a reply | On a normal completion: auto-open at your question when closed, or a "New reply ready" toast when open (default off) |
| Press F to enter focus mode | Press `F` anywhere to enter focus mode instantly; never fires while typing in an input (default on) |
| Sync the current reading position when entering focus mode | Open at the message you're reading; off opens at your most recent question (default on) |
| Show right-side turn navbar | One rail mark per user message (turn) — hover to preview, click to jump (default on) |

> **Text width** is not in the settings card: drag the handles beside the content column while in focus mode to resize it live; the value persists on release (default 760px, minimum 640px).

## License

[MIT](./LICENSE)
