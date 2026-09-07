/**
 * Focus Mode, browser half: a full-screen reading overlay in `shell.overlay`
 * (additive, never replaces shipped UI), a "专注" button in the session header
 * action row, and a collapsible plugin card in the Plugins settings tab
 * (`settings.plugin.item`). Rendering reuses the official client UI primitives
 * module (`@deepseek-ai/dsh-client-ui-primitives` runtime id) — Markdown /
 * MessageText / Tooltip / Button — plus the conversation service's composer
 * registry and the uiSession pending-interaction service (dsh 0.1.2).
 */
import { createElement } from 'react'
import { FocusOverlay, FocusSettingsCard, FocusToggle, FocusOnboarding, focusStore } from './FocusView'
import { FOCUS_CSS } from './styles'
import { zh, en } from './locales'
import { prefsStore } from './settings'
import { detectSettledCompletion, hotkeyShouldEnter, legacySliceOf } from './model'

const NS = 'focus'

// One-time notice when the dsh 0.1.2+ services are absent so the degraded
// legacy-compatibility mode is visible in the console instead of silent.
let warnedLegacy = false
function warnLegacyOnce() {
  if (warnedLegacy) return
  warnedLegacy = true
  console.warn('[dsh-focus-overlay] dsh 0.1.2+ ui services not found — running in legacy compatibility mode')
}

export default {
  name: 'dsh-focus-overlay-client',
  inject: ['slots', 'sessions', 'locale', 'workspaces', 'uiSession', 'uiConversation', 'settingsScope'],
  apply(ctx: any) {
    // Package-owned stylesheet (removed with the plugin on unload).
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'dsh-focus-overlay')
    style.textContent = FOCUS_CSS
    ctx.effect(() => {
      document.head.appendChild(style)
      return () => { style.remove() }
    })

    // DSH-better-sidebar compatibility: mark the body while focus is on so the
    // package stylesheet hides better-sidebar's floating panel host (top-right
    // toggle cluster + right/bottom panels) and neutralizes its #root layout
    // push. Its host lives outside #root at z-index 40/45 — above shell.overlay's
    // z-20 layer — so this overlay alone cannot cover it. Every focus entry/exit
    // path (header toggle, exit button, Esc, auto-focus, reply toast) funnels
    // through focusStore.set(), so one subscription covers them all.
    ctx.effect(() => {
      const sync = () => {
        if (focusStore.get()) document.body.setAttribute('data-fm-focus', '')
        else document.body.removeAttribute('data-fm-focus')
      }
      sync()
      const unsub = focusStore.subscribe(sync)
      return () => { unsub(); document.body.removeAttribute('data-fm-focus') }
    })

    // i18n dictionaries + bound translate.
    ctx.effect(() => ctx.locale.register(NS, { zh, en }))
    const t = ctx.locale.bind(NS)

    const sessions = ctx.sessions
    const workspaces = ctx.workspaces
    const conversation = ctx.get('conversation')
    const chatFileMentions = ctx.get('chatFileMentions')
    // dsh 0.1.2: pending user interactions (question / plan review / approval)
    // moved from the session snapshot into this root-level uiSession service,
    // and conversation content into the uiConversation chat view assembly.
    const uiSession = ctx.get('uiSession')
    const uiConversation = ctx.get('uiConversation')
    if (!uiSession || !uiConversation) warnLegacyOnce()
    // Official "对话显示" preference (ui-chat.transcriptView): bind the same
    // settings scope the chat target's TranscriptViewPolicy binds.
    let settingsScope: any = null
    try {
      const binder = ctx.get('settingsScope')
      settingsScope = binder && typeof binder.bind === 'function' ? binder.bind({ namespace: 'ui-chat' }) : null
    } catch { settingsScope = null }

    // Auto-focus: watch the *current* session's running bit. When a reply
    // settles normally (running true → false + finalized, non-interrupted
    // assistant node), either open focus mode scrolled to the question, or —
    // if focus is already open — raise a one-shot "new reply ready" reminder.
    // Abnormal endings (stop / error / max-tokens / interrupt) never fire.
    //
    // The "AI is waiting for your reply" case (ask_user_question / approval) is
    // NOT handled here: it is a live state (the uiSession pending-interactions
    // map on dsh 0.1.2+, the session snapshot's flat `pending` array on older
    // builds), so the overlay renders it directly and it clears the moment the
    // user answers — no edge detection needed.
    ctx.effect(() => {
      let currentId: any = undefined
      let unsubSession: (() => void) | null = null
      let unsubChat: (() => void) | null = null
      let chatSlice: any = null
      let prevRunning = false
      let pendingSettle = false

      const judge = () => {
        if (!pendingSettle) return
        const snap = chatSlice
        const outcome = detectSettledCompletion({ partial: snap ? snap.partial : null, nodes: snap ? snap.nodes : [], runningCalls: snap && snap.runningCalls ? snap.runningCalls : [] })
        if (outcome.settled) {
          pendingSettle = false
          if (outcome.completed && prefsStore.get().autoFocus) {
            if (focusStore.get()) focusStore.notifyDone()
            else { focusStore.setAutoAnchor(outcome.anchorSeq); focusStore.set(true) }
          }
        }
        // Not settled yet: keep `pendingSettle` armed. The `turn/end` frame
        // that lands the final node also triggers these subscriptions, so the
        // next snapshot re-evaluates against the complete node list.
      }

      const watch = (id: any) => {
        if (unsubSession) { unsubSession(); unsubSession = null }
        if (unsubChat) { unsubChat(); unsubChat = null }
        chatSlice = null
        prevRunning = false
        pendingSettle = false
        if (id == null) return
        const binding = sessions.binding(id)
        if (!binding) return
        const face = binding.session
        const onSnap = () => {
          const snap = face.getSnapshot()
          if (!snap) return
          const running = !!snap.running
          // A turn just finished: arm the settle judgement. Do NOT judge here —
          // the tail may still be streaming into `partial` (its final node has
          // not landed yet), so we wait for a stable snapshot instead.
          if (prevRunning && !running) pendingSettle = true
          if (running) pendingSettle = false
          judge()
          prevRunning = running
        }
        onSnap()
        unsubSession = face.subscribe(onSnap)
        // dsh 0.1.2: the content slice lives in the uiConversation chat view;
        // subscribing also activates the target so the slice materializes even
        // if the official conversation view never mounted it for us.
        if (uiConversation) {
          try {
            const convBinding = uiConversation.binding(id)
            const chatSource = convBinding.target('chat')
            const onChat = () => { chatSlice = legacySliceOf(chatSource.getSnapshot(), face.getSnapshot()); judge() }
            onChat()
            unsubChat = chatSource.subscribe(onChat)
          } catch { /* older dsh: face snapshot carries the slice itself */ }
        }
        if (!unsubChat) chatSlice = legacySliceOf(null, face.getSnapshot())
      }

      const onList = () => {
        const ls = sessions.list.getSnapshot()
        const next = ls ? ls.current : undefined
        if (next !== currentId) { currentId = next; watch(next) }
      }
      onList()
      const unsubList = sessions.list.subscribe(onList)

      return () => { if (unsubList) unsubList(); if (unsubSession) unsubSession(); if (unsubChat) unsubChat() }
    })

    // F hotkey: enter focus mode from anywhere. The guard rails (pref on, no
    // modifiers, no auto-repeat, not typing in an editable element, focus not
    // already open) live in the pure `hotkeyShouldEnter` decision so they are
    // unit-testable. The listener runs in the capture phase like the overlay's
    // Esc handler, so it fires regardless of where keyboard focus sits, but it
    // only preventDefault()s when it actually enters focus mode — typing an "f"
    // in the composer is never swallowed. Exiting stays on Esc inside the
    // overlay. The pref is read reactively inside the handler, so toggling the
    // setting applies immediately without re-registering.
    ctx.effect(() => {
      const onKey = (e: KeyboardEvent) => {
        const el = e.target as HTMLElement | null
        const tag = el ? el.tagName : ''
        const typing = !!el && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable)
        if (!hotkeyShouldEnter(e, { enabled: prefsStore.get().hotkey, typing, focusOn: focusStore.get() })) return
        e.preventDefault()
        focusStore.captureChatAnchor()
        focusStore.set(true)
      }
      window.addEventListener('keydown', onKey, true)
      return () => window.removeEventListener('keydown', onKey, true)
    })

    ctx.slots.inject('shell.overlay', () => ctx.slots.register(
      { name: 'shell.overlay', id: 'focus-mode-overlay', order: 1000 },
      (props: any) => createElement(FocusOverlay, { ...props, sessions, workspaces, conversation, chatFileMentions, uiSession, uiConversation, settingsScope, t }),
    ))

    ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
      { name: 'conversation.session.header.actions', id: 'focus-mode-toggle', order: 1000, label: () => t('toggle') },
      () => createElement(FocusToggle, { t }),
    ))

    // `settings.plugin.item` changed shape between dsh 0.1.0-rc.6 and rc.7: it
    // was a *list* slot (options `id`/`order`) before, and became a *keyed* slot
    // (option `key`, the settings namespace) from rc.7 onward. `SlotCore.register`
    // only requires the option its `kind` names and ignores the rest, so we
    // register both shapes at once: `key` satisfies the keyed tab (it must equal
    // the namespace the Node half serves), while `id`/`order` keep the card
    // rendering on the older list-slot dsh.
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: 'dsh-focus-overlay',
        id: 'dsh-focus-overlay',
        order: 1000,
      },
      () => createElement(FocusSettingsCard, { t }),
    ))

    // First-run onboarding: on the empty hero (no/blank session) show a one-time
    // intro — feature overview + the same prefs as the settings card — and let
    // the user jump straight to "Settings → Plugins → Plugin configuration".
    // The step persists its own "seen" flag (localStorage); the coordinator's
    // completed set is component-local, so the step skips itself via complete()
    // once seen. On dsh versions without `settings.onboarding` the inject never
    // fires and the intro simply never appears (no crash).
    ctx.slots.inject('settings.onboarding', () => ctx.slots.register(
      {
        name: 'settings.onboarding',
        id: 'dsh-focus-overlay',
        order: 10,
      },
      (props: any) => createElement(FocusOnboarding, { ...props, t }),
    ))
  },
}
