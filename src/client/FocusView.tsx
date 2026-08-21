import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownText, MessageText, Button, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { usePrefs, prefsStore } from './settings'
import type { FocusTranslate } from './locales'
import { buildItems, resolveAnchorSeq, findSeqIndex, lastUserIndex, hasPendingInteraction } from './model'

// ---- shared focus state (module scope; the overlay and the header toggle read it) ----
let focusOn = false
let pendingAnchorKey: string | null = null
let pendingAutoSeq: number | null = null
let donePing = 0
const focusListeners: Array<() => void> = []
const notify = () => { for (const l of focusListeners) l() }
export const focusStore = {
  get: () => focusOn,
  set: (v: boolean) => { focusOn = !!v; notify() },
  subscribe: (l: () => void) => { focusListeners.push(l); return () => { const i = focusListeners.indexOf(l); if (i >= 0) focusListeners.splice(i, 1) } },
  // Capture the topmost visible user/steering row's chat anchor key so the
  // overlay can open at the same message (precise scroll preservation).
  captureChatAnchor: () => {
    pendingAnchorKey = null
    try {
      const scrollport = document.querySelector('[data-conversation-scroll]')
      if (!scrollport) return
      const vp = scrollport.getBoundingClientRect()
      const rows = scrollport.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]')
      for (const row of rows) {
        const r = (row as HTMLElement).getBoundingClientRect()
        if (r.bottom > vp.top + 8) {
          pendingAnchorKey = (row as HTMLElement).dataset.chatAnchorKey || null
          return
        }
      }
    } catch { /* ignore */ }
  },
  consumeAnchorKey: () => { const k = pendingAnchorKey; pendingAnchorKey = null; return k },
  // Auto-focus target: the seq of the user message that started the just-finished
  // turn (consumed by the overlay's mount effect to scroll to the question).
  setAutoAnchor: (seq: number | null) => { pendingAutoSeq = seq },
  consumeAutoSeq: () => { const s = pendingAutoSeq; pendingAutoSeq = null; return s },
  // One-shot "new reply ready" ping (shown only while focus is already open;
  // cleared when the overlay closes so it never re-shows on the next open).
  getDonePing: () => donePing,
  notifyDone: () => { donePing++; notify() },
  clearDonePing: () => { donePing = 0 },
}
function useFocus(): boolean {
  const [v, setV] = useState<boolean>(focusStore.get)
  useEffect(() => focusStore.subscribe(() => setV(focusStore.get)), [])
  return v
}
function useDonePing(): number {
  const [v, setV] = useState<number>(focusStore.getDonePing)
  useEffect(() => focusStore.subscribe(() => setV(focusStore.getDonePing())), [])
  return v
}

// ---- scroll/anchor ledger (module scope; refs populate while the overlay is mounted) ----
let bodyEl: HTMLElement | null = null
const anchors: Record<string, HTMLElement> = {}

function useSessionSnapshot(sessions: any, sessionId: any): any {
  const [snap, setSnap] = useState<any>(() => {
    if (!sessionId || !sessions) return null
    const b = sessions.binding(sessionId)
    return b ? b.session.getSnapshot() : null
  })
  useEffect(() => {
    if (!sessionId || !sessions) { setSnap(null); return }
    const b = sessions.binding(sessionId)
    if (!b) { setSnap(null); return }
    setSnap(b.session.getSnapshot())
    return b.session.subscribe(() => setSnap(b.session.getSnapshot()))
  }, [sessions, sessionId])
  return snap
}

function SessionImage({ attachment, loadImage }: { attachment: any; loadImage: (a: any) => Promise<string> }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    loadImage(attachment).then((u) => { if (alive) setSrc(u) }).catch(() => {})
    return () => { alive = false }
  }, [attachment, loadImage])
  if (!src) return null
  return <img className="fm-image" src={src} alt="" />
}

function AssistantItem({ blocks, loadImage, fileMentions }: { blocks: any[]; loadImage: (a: any) => Promise<string>; fileMentions: any }) {
  const text = (blocks || []).filter((b) => b && b.kind === 'text').map((b) => b.text).join('')
  const images = (blocks || []).filter((b) => b && b.kind === 'image')
  return (
    <div className="fm-msg fm-assistant">
      {text ? <MarkdownText text={text} fileMentions={fileMentions} /> : null}
      {images.map((b, i) => <SessionImage key={i} attachment={b.attachment} loadImage={loadImage} />)}
    </div>
  )
}

function FocusContent(props: any) {
  const { useSessions, sessions, workspaces, conversation, chatFileMentions, t } = props
  const prefs = usePrefs()
  const listState = useSessions((s: any) => s)
  const currentId = listState ? listState.current : undefined
  const snap = useSessionSnapshot(sessions, currentId)
  const items = useMemo(() => (snap ? buildItems(snap.nodes || [], snap.runningCalls, t) : []), [snap, t])

  const navKeys: string[] = []
  const navPreviews: Record<string, string> = {}
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'user' || it.kind === 'steering') {
      const k = 'fm-' + i
      navKeys.push(k)
      navPreviews[k] = it.text.replace(/\s+/g, ' ').trim().slice(0, 80)
    }
  }

  const [activeKey, setActiveKey] = useState<string | null>(navKeys.length ? navKeys[navKeys.length - 1] : null)
  const [atBottom, setAtBottom] = useState<boolean>(true)
  const rafId = useRef<number | null>(null)

  const computeActive = () => {
    if (!bodyEl) return null
    let cur: string | null = null
    for (const k of navKeys) {
      const el = anchors[k]
      if (!el) continue
      const top = el.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top
      if (top <= 96) cur = k
      else break
    }
    return cur
  }
  const isNearBottom = () => {
    if (!bodyEl) return true
    return bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 48
  }
  const handleScroll = () => {
    if (rafId.current !== null) return
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null
      setActiveKey(computeActive())
      setAtBottom(isNearBottom())
    })
  }
  const scrollToKey = (key: string, smooth: boolean) => {
    const el = anchors[key]
    if (!el || !bodyEl) return
    const top = el.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top + bodyEl.scrollTop
    bodyEl.scrollTo({ top: top - 16, behavior: smooth ? 'smooth' : 'auto' })
  }
  const scrollToBottom = () => { if (bodyEl) bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'smooth' }) }

  useEffect(() => {
    // Auto-focus: jump to the user question that started the just-finished turn.
    const autoSeq = focusStore.consumeAutoSeq()
    if (autoSeq != null) {
      const idx = findSeqIndex(items, autoSeq)
      if (idx >= 0) {
        scrollToKey('fm-' + idx, false)
        setActiveKey('fm-' + idx)
      } else if (bodyEl) {
        bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'auto' })
        setActiveKey(navKeys.length ? navKeys[navKeys.length - 1] : null)
      }
      return
    }
    // Manual open: preserve the chat position captured from the underlying view.
    const anchorKey = focusStore.consumeAnchorKey()
    const seq = resolveAnchorSeq(snap && snap.chat, anchorKey)
    const idx = seq != null ? findSeqIndex(items, seq) : -1
    if (prefs.scroll === 'preserve' && idx >= 0) {
      scrollToKey('fm-' + idx, false)
      setActiveKey('fm-' + idx)
    } else if (bodyEl) {
      bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'auto' })
      setActiveKey(navKeys.length ? navKeys[navKeys.length - 1] : null)
    }
  }, [])

  const loadImage = useCallback((attachment: any): Promise<string> => {
    if (!conversation || !currentId) return Promise.reject(new Error('dsh-focus-overlay: conversation service unavailable'))
    return conversation.resolveImage(currentId, attachment)
  }, [conversation, currentId])

  const fileMentionsFor = useCallback((node: any): any => {
    if (!chatFileMentions) return undefined
    try {
      return chatFileMentions.forClosing({
        turn: { turn: node.turn, step: node.step },
        seq: node.seq,
        openFile: (path: string) => { if (workspaces) workspaces.openPath(path).catch(() => {}) },
      })
    } catch { return undefined }
  }, [chatFileMentions, workspaces])

  let title = 'Focus Mode'
  if (currentId && listState && listState.byId && listState.byId[currentId]) {
    const row = listState.byId[currentId]
    if (row && row.displayTitle) title = row.displayTitle
  }

  let body: any
  if (!currentId) {
    body = <div className="fm-empty">{t('empty')}</div>
  } else if (snap === null) {
    body = <div className="fm-empty">{t('loading')}</div>
  } else {
    const partial = snap.partial
    const partialBlocks = partial ? partial.blocks : []
    const running = !!snap.running
    const kids: any[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const key = 'fm-' + i
      if (it.kind === 'user') {
        kids.push(
          <div key={key} className="fm-msg fm-user-msg" ref={(el) => { if (el) anchors[key] = el; else delete anchors[key] }}>
            <div className="fm-user"><MessageText text={it.text} /></div>
          </div>,
        )
      } else if (it.kind === 'steering') {
        kids.push(
          <div key={key} className="fm-msg fm-user-msg" ref={(el) => { if (el) anchors[key] = el; else delete anchors[key] }}>
            <div className="fm-user fm-steering"><MessageText text={it.text} /></div>
          </div>,
        )
      } else if (it.kind === 'assistant') {
        kids.push(<AssistantItem key={key} blocks={it.blocks} loadImage={loadImage} fileMentions={fileMentionsFor(it)} />)
      } else if (it.kind === 'hidden') {
        kids.push(<div key={key} className="fm-hidden">· {it.text} ·</div>)
      } else if (it.kind === 'error') {
        kids.push(<div key={key} className="fm-msg fm-error">{it.text}</div>)
      }
    }
    if (partialBlocks.length) {
      kids.push(<AssistantItem key="fm-partial" blocks={partialBlocks} loadImage={loadImage} fileMentions={undefined} />)
    }
    if (running) {
      kids.push(<div key="fm-running" className="fm-running">{t('running')}</div>)
    }
    body = <div className="fm-inner" style={{ maxWidth: prefs.width }}>{kids}</div>
  }

  const activeIndex = activeKey ? navKeys.indexOf(activeKey) : -1
  const navHeight = (navKeys.length - 1) * 14 + 22
  const dotTop = (i: number) => i * 14 + 11 + (i < activeIndex ? -7 : i > activeIndex ? 7 : 0)

  const nav = (prefs.navbar && navKeys.length >= 2)
    ? (
      <div className="fm-nav" style={{ height: navHeight }}>
        {navKeys.map((k, i) => (
          <button
            key={k}
            type="button"
            aria-label={navPreviews[k]}
            className={'fm-nav-dot' + (activeKey === k ? ' fm-nav-dot-active' : '')}
            style={{ top: dotTop(i) }}
            onClick={() => scrollToKey(k, true)}
          >
            <span className="fm-nav-dot-core" />
            <span className="fm-nav-tip">{navPreviews[k]}</span>
          </button>
        ))}
      </div>
    )
    : null

  const toBottom = (!atBottom)
    ? (
      <div className="fm-tobottom-wrap">
        <Button variant="outline" size="sm" className="fm-tobottom" title={t('backToLatest')} onClick={scrollToBottom}>↓</Button>
      </div>
    )
    : null

  // "AI is waiting for your reply" — a live state derived from the session's
  // pending interactions. It shows while any question/approval is unanswered
  // and clears by itself the moment the user answers (pending empties).
  const waiting = hasPendingInteraction(snap)

  // "New reply ready" — a one-shot ping, cleared when the overlay closes so it
  // never re-appears on the next open.
  const donePing = useDonePing()
  const [showDoneNotice, setShowDoneNotice] = useState<boolean>(false)
  useEffect(() => {
    if (!donePing) return
    setShowDoneNotice(true)
    const id = setTimeout(() => setShowDoneNotice(false), 6000)
    return () => clearTimeout(id)
  }, [donePing])
  useEffect(() => () => focusStore.clearDonePing(), [])

  const jumpToLatestQuestion = () => {
    const idx = lastUserIndex(items)
    if (idx >= 0) { scrollToKey('fm-' + idx, true); setActiveKey('fm-' + idx) }
    else scrollToBottom()
  }

  const replyNotice = waiting
    ? (
      <div className="fm-reply-toast">
        <span className="fm-reply-toast-dot" />
        <span className="fm-reply-toast-text">{t('reply.waiting')}</span>
        <Button variant="primary" size="sm" onClick={() => focusStore.set(false)}>{t('reply.respond')}</Button>
      </div>
    )
    : showDoneNotice
      ? (
        <div className="fm-reply-toast">
          <span className="fm-reply-toast-dot" />
          <span className="fm-reply-toast-text">{t('reply.ready')}</span>
          <Button variant="primary" size="sm" onClick={() => { setShowDoneNotice(false); jumpToLatestQuestion() }}>{t('reply.view')}</Button>
        </div>
      )
      : null

  return (
    <div className="fm-overlay" tabIndex={-1} autoFocus onKeyDown={(e) => { if (e && e.key === 'Escape') focusStore.set(false) }}>
      <div className="fm-topbar">
        <div className="fm-title">{title}</div>
        <Button variant="outline" size="sm" onClick={() => focusStore.set(false)}>{t('exit')}</Button>
      </div>
      <div className="fm-body" ref={(el) => { bodyEl = el }} onScroll={handleScroll}>{body}</div>
      {nav}
      {toBottom}
      {replyNotice}
    </div>
  )
}

export function FocusOverlay(props: any) {
  const on = useFocus()
  if (!on) return null
  return <FocusContent {...props} />
}

export function FocusToggle({ t }: { t: FocusTranslate }) {
  return (
    <Button variant="ghost" size="sm" title={t('toggle.title')} onClick={() => { focusStore.captureChatAnchor(); focusStore.set(true) }}>
      {t('toggle')}
    </Button>
  )
}

export function FocusSettingsCard({ t }: { t: FocusTranslate }) {
  const prefs = usePrefs()
  const [open, setOpen] = useState(false)
  const title = t('settings.label')
  return (
    <li className={'fm-plugin-card' + (open ? ' fm-plugin-card-open' : '')}>
      <button
        type="button"
        className="fm-plugin-card-header"
        aria-expanded={open}
        aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
        onClick={() => setOpen(!open)}
      >
        <span className="fm-plugin-card-headtext">
          <span className="fm-plugin-card-name">{title}</span>
          <span className="fm-plugin-card-desc">{t('settings.description')}</span>
        </span>
        <IconChevronDownOutline14 className={'fm-plugin-card-chevron' + (open ? ' fm-plugin-card-chevron-open' : '')} />
      </button>
      {open ? (
        <div className="fm-plugin-card-body">
          <div className="fm-plugin-field">
            <label className="fm-plugin-check">
              <input type="checkbox" checked={prefs.navbar} onChange={(e) => prefsStore.update({ navbar: e.target.checked })} />
              <span className="fm-plugin-check-label">{t('settings.navbar')}</span>
            </label>
            <p className="fm-plugin-field-hint">{t('settings.navbar.hint')}</p>
          </div>
          <div className="fm-plugin-field">
            <label className="fm-plugin-check">
              <input type="checkbox" checked={prefs.scroll === 'preserve'} onChange={(e) => prefsStore.update({ scroll: e.target.checked ? 'preserve' : 'bottom' })} />
              <span className="fm-plugin-check-label">{t('settings.scrollPreserve')}</span>
            </label>
            <p className="fm-plugin-field-hint">{t('settings.scrollPreserve.hint')}</p>
          </div>
          <div className="fm-plugin-field">
            <label className="fm-plugin-check">
              <input type="checkbox" checked={prefs.autoFocus} onChange={(e) => prefsStore.update({ autoFocus: e.target.checked })} />
              <span className="fm-plugin-check-label">{t('settings.autoFocus')}</span>
            </label>
            <p className="fm-plugin-field-hint">{t('settings.autoFocus.hint')}</p>
          </div>
          <div className="fm-plugin-field">
            <div className="fm-plugin-field-head">
              <span className="fm-plugin-field-label">{t('settings.width')}</span>
              <span className="fm-plugin-field-value">{prefs.width}px</span>
            </div>
            <input type="range" className="fm-plugin-range" min={480} max={1200} step={40} value={prefs.width} onChange={(e) => prefsStore.update({ width: Number(e.target.value) })} />
            <p className="fm-plugin-field-hint">{t('settings.width.hint')}</p>
          </div>
        </div>
      ) : null}
    </li>
  )
}
