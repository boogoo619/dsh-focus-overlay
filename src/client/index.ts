/**
 * Focus Mode, browser half: a full-screen reading overlay in `shell.overlay`
 * (additive, never replaces shipped UI), a "专注" button in the session header
 * action row, and a collapsible plugin card in the Plugins settings tab
 * (`settings.plugin.item`). Rendering reuses the official
 * `@deepseek-ai/dsh-client-ui-primitives` Markdown/MessageText/Tooltip/Button
 * components and the conversation service's image resolver.
 */
import { createElement } from 'react'
import { FocusOverlay, FocusSettingsCard, FocusToggle, focusStore } from './FocusView'
import { FOCUS_CSS } from './styles'
import { zh, en } from './locales'
import { prefsStore } from './settings'
import { detectSettledCompletion } from './model'

const NS = 'focus'

export default {
  name: 'dsh-focus-overlay-client',
  inject: ['slots', 'sessions', 'locale', 'workspaces'],
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

    // Auto-focus: watch the *current* session's running bit. When a reply
    // settles normally (running true → false + finalized, non-interrupted
    // assistant node), either open focus mode scrolled to the question, or —
    // if focus is already open — raise a one-shot "new reply ready" reminder.
    // Abnormal endings (stop / error / max-tokens / interrupt) never fire.
    //
    // The "AI is waiting for your reply" case (ask_user_question / approval) is
    // NOT handled here: it is a live state (`snapshot.pending`), not an event,
    // so the overlay renders it directly and it clears the moment the user
    // answers — no edge detection needed.
    ctx.effect(() => {
      let currentId: any = undefined
      let unsubSession: (() => void) | null = null
      let prevRunning = false
      let pendingSettle = false

      const watch = (id: any) => {
        if (unsubSession) { unsubSession(); unsubSession = null }
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
          if (pendingSettle && !running) {
            const outcome = detectSettledCompletion(snap)
            if (outcome.settled) {
              pendingSettle = false
              if (outcome.completed && prefsStore.get().autoFocus) {
                if (focusStore.get()) focusStore.notifyDone()
                else { focusStore.setAutoAnchor(outcome.anchorSeq); focusStore.set(true) }
              }
            }
            // Not settled yet: keep `pendingSettle` armed. The `turn/end` frame
            // that lands the final node also triggers this subscription, so the
            // next snapshot re-evaluates against the complete node list.
          }
          prevRunning = running
        }
        onSnap()
        unsubSession = face.subscribe(onSnap)
      }

      const onList = () => {
        const ls = sessions.list.getSnapshot()
        const next = ls ? ls.current : undefined
        if (next !== currentId) { currentId = next; watch(next) }
      }
      onList()
      const unsubList = sessions.list.subscribe(onList)

      return () => { if (unsubList) unsubList(); if (unsubSession) unsubSession() }
    })

    ctx.slots.inject('shell.overlay', () => ctx.slots.register(
      { name: 'shell.overlay', id: 'focus-mode-overlay', order: 1000 },
      (props: any) => createElement(FocusOverlay, { ...props, sessions, workspaces, conversation, chatFileMentions, t }),
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
  },
}
