/**
 * Focus Mode, browser half: a full-screen reading overlay in `shell.overlay`
 * (additive, never replaces shipped UI), a "专注" button in the session header
 * action row, and a settings section. Rendering reuses the official
 * `@deepseek-ai/dsh-client-ui-primitives` Markdown/MessageText/Tooltip/Button
 * components and the conversation service's image resolver.
 */
import { createElement } from 'react'
import { FocusOverlay, FocusSettings, FocusToggle, focusStore } from './FocusView'
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

      const watch = (id: any) => {
        if (unsubSession) { unsubSession(); unsubSession = null }
        prevRunning = false
        if (id == null) return
        const binding = sessions.binding(id)
        if (!binding) return
        const face = binding.session
        const onSnap = () => {
          const snap = face.getSnapshot()
          if (!snap) return
          const running = !!snap.running
          if (prevRunning && !running) {
            const outcome = detectSettledCompletion(snap)
            if (outcome.completed && prefsStore.get().autoFocus) {
              if (focusStore.get()) focusStore.notifyDone()
              else { focusStore.setAutoAnchor(outcome.anchorSeq); focusStore.set(true) }
            }
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

    ctx.slots.inject('settings.section', () => ctx.slots.register(
      { name: 'settings.section', id: 'focus-mode-settings', order: 100, label: () => t('settings.label') },
      () => createElement(FocusSettings, { t }),
    ))
  },
}
