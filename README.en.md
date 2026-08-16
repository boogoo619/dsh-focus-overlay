<h1 align="center">dsh-focus-overlay</h1>

<p align="center">
  <a href="README.md">中文</a> | English
</p>

<p align="center">
  A <b>focus mode</b> for the DeepSeek Harness (DSH) web GUI: one click to a full-screen reading view that hides the header and composer and folds the AI tool-call flow into a one-line summary — leaving only the conversation between you and the AI.<br>
  Text and image rendering reuse the official primitives, matching the chat view 1:1.
</p>

<p align="center">
  <img src="https://badgen.net/npm/v/dsh-focus-overlay" alt="npm version">
  <img src="https://badgen.net/badge/license/MIT/green" alt="license">
  <img src="https://badgen.net/badge/dsh/%3E%3D0.1.0-rc.5/blue" alt="dsh version">
</p>

## Features

- **Full-screen display** — covers the whole UI, giving all vertical space to the conversation
- **Hide the header and composer** — a thin top bar remains, the input area is tucked away
- **Fold tool calls** — an assistant turn collapses into a one-line summary
- **Quick navigation** — a right-side node navbar with hover preview and click-to-jump

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
| Back to latest | A centered "↓ back to latest" floating button appears when you scroll away from the bottom |
| File mentions | Wires `chatFileMentions`, turning inline-code tokens that name real files into clickable links |
| i18n | Chinese / English copy, follows the UI language |
| Settings page | Navbar toggle, open-position strategy, text-area width — persisted to `localStorage` |

## Install

Requires the `dsh` CLI (`>= 0.1.0-rc.5`).

**From npm (recommended)**

```sh
dsh plugin --profile web add dsh-focus-overlay
dsh web
```

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

**Local directory / tarball**

```sh
dsh plugin --profile web add ./dsh-focus-overlay                  # local directory
dsh plugin --profile web add ./dsh-focus-overlay-0.1.0.tgz        # tarball
```

Restart `dsh web` after install.

## Usage

1. Open a session and click the **"Focus"** button in the session header action row.
2. You enter the full-screen focus view: a thin top bar (session title + exit) and the conversation only, with tool steps folded into summary lines.
3. Hover the right-side dots to preview, click to jump; a centered "↓ back to latest" button appears when you're not at the bottom.
4. Press `Esc` or click "Exit focus" to return — the original UI is untouched.

## Settings

Sidebar "Settings → Focus Mode":

| Option | Description |
| --- | --- |
| Show right-side navbar | Toggle the nav dots (default on) |
| Preserve chat position on open | Open at your current reading position; off opens at the latest (default on) |
| Text width | 480–1200px slider for the reading column (default 760px) |

## License

[MIT](./LICENSE)
