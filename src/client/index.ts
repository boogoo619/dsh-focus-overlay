/**
 * Focus Mode, browser half: a full-screen reading overlay in `shell.overlay`
 * (additive, never replaces shipped UI), a "专注" button in the session header
 * action row, and a settings section. Rendering reuses the official
 * `@deepseek-ai/dsh-client-ui-primitives` Markdown/MessageText/Tooltip/Button
 * components and the conversation service's image resolver.
 */
import { createElement } from 'react'
import { FocusOverlay, FocusSettings, FocusToggle } from './FocusView'
import { FOCUS_CSS } from './styles'
import { zh, en } from './locales'

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
