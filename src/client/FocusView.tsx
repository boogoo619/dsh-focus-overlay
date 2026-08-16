import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownText, MessageText, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { usePrefs, prefsStore } from './settings'
import type { FocusTranslate } from './locales'

// ---- shared focus state (module scope; the overlay and the header toggle read it) ----
let focusOn = false
let pendingAnchorKey: string | null = null
const focusListeners: Array<() => void> = []
const focusStore = {
  get: () => focusOn,
  set: (v: boolean) => { focusOn = !!v; for (const l of focusListeners) l() },
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
}
function useFocus(): boolean {
  const [v, setV] = useState<boolean>(focusStore.get)
  useEffect(() => focusStore.subscribe(() => setV(focusStore.get)), [])
  return v
}

// ---- scroll/anchor ledger (module scope; refs populate while the overlay is mounted) ----
let bodyEl: HTMLElement | null = null
const anchors: Record<string, HTMLElement> = {}

// ---- text helpers ----
function flattenText(content: any): string {
  if (!content || !content.length) return ''
  let out = ''
  for (const b of content) {
    if (b && b.type === 'text' && typeof b.text === 'string') out += b.text
  }
  return out
}

// ---- semantic summary: classify hidden steps by tool name ----
const METRIC: Record<string, string> = {
  bash: 'commands', pwsh: 'commands', sh: 'commands', cmd: 'commands', terminal: 'commands', shell: 'commands',
  write: 'edits', save: 'edits', edit: 'edits', replace: 'edits', patch: 'edits', apply_patch: 'edits', str_replace_editor: 'edits',
  web_search: 'searches', grep: 'searches', search: 'searches',
  read: 'files', read_image: 'files',
  glob: 'dirs',
  subagent: 'subagents', subagent_fork: 'subagents',
  todo_write: 'todos',
  create_goal: 'goals', update_goal: 'goals', get_goal: 'goals',
  workflow: 'workflows', ralph: 'workflows',
  skill: 'skills',
  ask_user_question: 'questions',
  plan: 'plans',
  job_output: 'jobs', job_kill: 'jobs', job_list: 'jobs',
}
const METRIC_ORDER = ['context', 'commands', 'edits', 'searches', 'files', 'dirs', 'subagents', 'todos', 'goals', 'workflows', 'skills', 'questions', 'plans', 'jobs', 'others']
const METRIC_KEY: Record<string, string> = {
  context: 'sum.context', commands: 'sum.commands', edits: 'sum.edits', searches: 'sum.searches',
  files: 'sum.files', dirs: 'sum.dirs', subagents: 'sum.subagents', todos: 'sum.todos',
  goals: 'sum.goals', workflows: 'sum.workflows', skills: 'sum.skills', questions: 'sum.questions',
  plans: 'sum.plans', jobs: 'sum.jobs', others: 'sum.others',
}
function addMetric(metrics: Record<string, number>, name: string) {
  const fam = METRIC[name] || 'others'
  metrics[fam] = (metrics[fam] || 0) + 1
}
function summarySegments(t: FocusTranslate, metrics: Record<string, number>): string[] {
  const segs: string[] = []
  for (const fam of METRIC_ORDER) {
    const n = metrics[fam]
    if (!n) continue
    const key = METRIC_KEY[fam]
    segs.push((key === 'sum.todos' || key === 'sum.goals') ? t(key) : t(key, { n }))
  }
  return segs
}

type FocusItem =
  | { kind: 'user'; text: string; seq: number }
  | { kind: 'steering'; text: string; seq: number }
  | { kind: 'assistant'; blocks: any[]; seq: number; turn: number; step: number }
  | { kind: 'hidden'; text: string }
  | { kind: 'error'; text: string }

function hasAssistantContent(blocks: any[]): boolean {
  for (const b of blocks || []) {
    if (b && (b.kind === 'text' || b.kind === 'image')) return true
  }
  return false
}

function buildItems(nodes: any[], runningCalls: any[], t: FocusTranslate): FocusItem[] {
  const items: FocusItem[] = []
  let metrics: Record<string, number> = {}
  const flush = () => {
    const segs = summarySegments(t, metrics)
    if (segs.length) items.push({ kind: 'hidden', text: segs.join('，') })
    metrics = {}
  }
  const accountNode = (n: any) => {
    if (n.kind === 'tool-result') {
      addMetric(metrics, (n.call && n.call.name) ? n.call.name : '')
    } else if (n.kind === 'context' || n.kind === 'compaction') {
      metrics.context = (metrics.context || 0) + 1
    } else if (n.kind === 'command') {
      metrics.commands = (metrics.commands || 0) + 1
    } else {
      metrics.others = (metrics.others || 0) + 1
    }
  }
  for (const n of nodes) {
    if (!n) continue
    switch (n.kind) {
      case 'user': {
        const text = flattenText(n.content)
        if (text.trim() !== '') { flush(); items.push({ kind: 'user', text, seq: n.seq }) }
        break
      }
      case 'steering': {
        const text = flattenText(n.content)
        if (text.trim() !== '') { flush(); items.push({ kind: 'steering', text, seq: n.seq }) }
        break
      }
      case 'assistant':
        if (hasAssistantContent(n.blocks)) { flush(); items.push({ kind: 'assistant', blocks: n.blocks, seq: n.seq, turn: n.turn, step: n.step }) }
        break
      case 'turn-error':
        flush(); items.push({ kind: 'error', text: n.message || 'turn-error' }); break
      case 'turn-max-tokens':
        flush(); items.push({ kind: 'error', text: 'turn-max-tokens' }); break
      default:
        accountNode(n); break
    }
  }
  if (runningCalls && runningCalls.length) {
    for (const rc of runningCalls) addMetric(metrics, (rc && rc.name) ? rc.name : '')
  }
  flush()
  return items
}

function resolveAnchorSeq(chat: any, key: string | null): number | null {
  if (!key || !chat || !chat.nodes) return null
  try {
    const node = chat.nodes.get(key)
    if (!node) return null
    const d = node.data || node.node || node
    return (d && typeof d.seq === 'number') ? d.seq : null
  } catch { return null }
}

function findSeqIndex(items: FocusItem[], seq: number): number {
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if ((it.kind === 'user' || it.kind === 'steering') && it.seq === seq) return i
  }
  return -1
}

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

  const nav = (prefs.navbar && navKeys.length >= 2)
    ? (
      <div className="fm-nav">
        {navKeys.map((k) => (
          <button
            key={k}
            type="button"
            aria-label={navPreviews[k]}
            className={'fm-nav-dot' + (activeKey === k ? ' fm-nav-dot-active' : '')}
            onClick={() => scrollToKey(k, true)}
          >
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

  return (
    <div className="fm-overlay" tabIndex={-1} autoFocus onKeyDown={(e) => { if (e && e.key === 'Escape') focusStore.set(false) }}>
      <div className="fm-topbar">
        <div className="fm-title">{title}</div>
        <Button variant="outline" size="sm" onClick={() => focusStore.set(false)}>{t('exit')}</Button>
      </div>
      <div className="fm-body" ref={(el) => { bodyEl = el }} onScroll={handleScroll}>{body}</div>
      {nav}
      {toBottom}
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

export function FocusSettings({ t }: { t: FocusTranslate }) {
  const prefs = usePrefs()
  return (
    <div className="fm-settings">
      <label className="fm-setting-row">
        <input type="checkbox" checked={prefs.navbar} onChange={(e) => prefsStore.update({ navbar: e.target.checked })} />
        <span>{t('settings.navbar')}</span>
      </label>
      <label className="fm-setting-row">
        <input type="checkbox" checked={prefs.scroll === 'preserve'} onChange={(e) => prefsStore.update({ scroll: e.target.checked ? 'preserve' : 'bottom' })} />
        <span>{t('settings.scrollPreserve')}</span>
      </label>
      <div className="fm-setting-row">
        <span>{t('settings.width')}</span>
        <input type="range" min={480} max={1200} step={40} value={prefs.width} onChange={(e) => prefsStore.update({ width: Number(e.target.value) })} />
        <span>{prefs.width}px</span>
      </div>
    </div>
  )
}
