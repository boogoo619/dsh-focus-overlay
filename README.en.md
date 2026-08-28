<h1 align="center">dsh-focus-overlay</h1>

<p align="center">
  <a href="README.md">中文</a> | English
</p>

<p align="center">
  A <b>focus mode</b> for the DeepSeek Harness (DSH) web GUI: one click to a full-screen reading view that hides the header and composer and folds the AI tool-call flow into a one-line summary — leaving only the conversation between you and the AI.<br>
  Text and image rendering reuse the official primitives, matching the chat view 1:1.
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/dsh-focus-overlay" alt="npm version">
  <img src="https://img.shields.io/npm/dm/dsh-focus-overlay" alt="npm downloads (monthly)">
  <img src="https://badgen.net/badge/license/MIT/green" alt="license">
  <img src="https://badgen.net/badge/dsh/%3E%3D0.1.0-rc.5/blue" alt="dsh version">
</p>

## Features

- **Full-screen display** — covers the whole UI, giving all vertical space to the conversation
- **Hide the header and composer** — a thin top bar remains, the input area is tucked away
- **Fold tool calls** — an assistant turn collapses into a one-line summary
- **Quick navigation** — a right-side node navbar with hover preview and click-to-jump
- **In-focus composer** — a compact input dock appears at the live edge and shares the main composer's draft; click away and it folds into a dot, one click back; AI questions and approvals expand into an in-place answer card, so you never leave focus to reply
- **Auto-focus & reminders** — after a reply completes, optionally auto-enter focus at your question; while in focus, get a toast for a new reply or when the AI is waiting on you
- **Hotkey F** — press `F` anywhere to enter focus mode instantly (toggleable in settings); typing in an input never triggers it

These features are designed to give **small screens** more content space: tucking away the persistent header/composer and tool steps lets the conversation use as much of the screen as possible.

## Screenshots

**Off — the normal chat view**

![Off: the normal chat view](screenshots/before.png)

**On — focus mode**

![On: focus mode](screenshots/after.png)

<!-- Drop your screenshots into screenshots/:
     - before.png — the normal chat view (header / composer / tool cards)
     - after.png  — focus mode (full-screen overlay + summary line + right-side navbar)
     Optionally add navbar.png as a navbar close-up. -->

Once in focus mode, an assistant turn no longer shows every step — it folds into a single summary line:

> ran 2 commands, edited 3 files, read 5 files, ran 1 search

## Capabilities

| Feature | Description |
| --- | --- |
| Full-screen overlay | Registered into `shell.overlay` (additive, `replaceRisk: none`) — covers header / composer / sidebar, giving all vertical space to the conversation |
| Official rendering | Assistant text through official `MarkdownText` (GFM + code highlighting + TeX); user messages through `MessageText`; user bubble uses the official blue, borderless style |
| Image resolution | Assistant `image` blocks resolve through `conversation.resolveImage`, rendering session-authorized images 1:1 |
| Tool-call folding | Tool calls / commands / context injections fold into a categorized summary line (commands / edits / searches / reads / directory listings / subagents / todos / goals / workflows / skills / questions / plans / background jobs) |
| Precise scroll preservation | Opens at the message you're reading in the chat (aligned by `seq`), not from the top |
| Right-side node navbar | One dot per user message; active pill follows scroll, hover preview, click to jump, auto-hidden under 2 messages |
| Back to latest | A centered "↓" floating button when you scroll away from the bottom with no draft |
| In-focus composer | The compact input bar appears at the live edge and shares the main composer's draft — `Enter` sends (queued while the AI runs); with a draft, clicking the conversation folds it into a blue-dot pill, one click to expand |
| File mentions | Wires `chatFileMentions`, turning inline-code tokens that name real files into clickable links |
| i18n | Chinese / English copy, follows the UI language |
| Plugin configuration card | A collapsible card under "Settings → Plugins → Plugin configuration": navbar toggle, open-position strategy, text-area width — persisted to `localStorage` |
| Auto-enter focus | After a reply **completes normally**, auto-open focus at your question; abnormal endings (stop / error / max-tokens / interrupt) never fire |
| F hotkey | Press `F` anywhere to enter focus mode instantly (default on, toggleable in settings); never fires while typing in an input, auto-repeat ignored |
| Reply / waiting reminders | In focus, a "New reply ready + View" toast on completion; a question/approval raises "AI is waiting for your reply + Answer", expanding an in-place answer card (options / free text / allow / deny) — auto-cleared once answered, never leaving focus |
| DSH-better-sidebar compatibility | While in focus, auto-hide its top-right panel toggle buttons and any open right/bottom panels (and release the squeezed layout); restored on exit |

## Install

Requires the `dsh` CLI (`>= 0.1.0-rc.5`).

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
2. You enter the full-screen focus view: a thin top bar (session title + exit) and the conversation only, with tool steps folded into summary lines.
3. Hover the right-side dots to preview, click to jump; the compact input bar appears when you reach the very bottom (a "↓" button shows when you scroll away with no draft).
4. Reply right in the bar: `Enter` sends, `Shift+Enter` newlines (queued while the AI runs), drafts shared with the main composer; clicking the conversation folds it into a blue-dot pill. AI questions/approvals raise an "Answer" card for in-place options, free text, or approvals.
5. `Esc` peels back layer by layer (answer card → input bar → focus mode); or click "Exit focus" to return — the original UI is untouched.

> **Compatibility note**: if [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) is also installed, entering focus mode auto-hides its two top-right panel toggle buttons and any open right/bottom panels (releasing the squeezed layout); they're restored as they were on exit, without touching that plugin's layout state.

## Settings

In the sidebar "Settings → Plugins → Plugin configuration", expand the "Focus Mode" card:

| Option | Description |
| --- | --- |
| Auto-enter focus mode when the AI finishes a reply | On a normal completion: auto-open at your question when closed, or a "New reply ready" toast when open (default off) |
| Press F to enter focus mode | Press `F` anywhere to enter focus mode instantly; never fires while typing in an input (default on) |
| Sync the current reading position when entering focus mode | Open at the message you're reading; off opens at your most recent question (default on) |
| Show right-side turn navbar | One navigation dot per user message (turn) — hover to preview, click to jump (default on) |
| Text width | 480–1200px slider for the reading column (default 760px) |

## License

[MIT](./LICENSE)
