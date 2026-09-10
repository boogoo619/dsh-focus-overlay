import { useCallback, useEffect, useMemo, useRef, useState, Component, type ReactNode } from 'react'
import { MarkdownText, MessageText, Button, Modal, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { usePrefs, prefsStore, onboardingStore, statsStore, useEntryCount, useStarred } from './settings'
import type { FocusTranslate } from './locales'
import { markdownLabels } from './locales'
import { buildItems, resolveAnchorSeq, findSeqIndex, lastUserIndex, lastPromptSeq, shouldRevealSentPrompt, REVEAL_RESERVE_PX, bottomForm, bottomZoneAfter, activeNavIndex, legacySliceOf, pendingInteractionOf, legacyPendingOf, processLabel, decideOpenScroll, shouldLiftOfficialComposer, LIFT_MAX_WIDTH, shouldShowStar } from './model'
import { FocusBottomDock, useInputFace, useInputState } from './Composer'
import { celebrateThenOpen } from './celebrate'
import { TurnRail, type RailItem } from './TurnRail'
import { WidthHandles, CONTENT_MIN, CONTENT_EDGE_BUDGET } from './WidthHandle'

// ---- shared focus state (module scope; the overlay and the header toggle read it) ----
let focusOn = false
let pendingAnchorKey: string | null = null
let pendingAutoSeq: number | null = null
let donePing = 0
const focusListeners: Array<() => void> = []
// One listener throwing must not leave `focusOn` and the rendered state
// disagreeing (that would brick the toggle: set(true) dead, overlay gone).
const notify = () => { for (const l of focusListeners) { try { l() } catch (err) { console.error('[dsh-focus-overlay] focus listener failed', err) } } }
export const focusStore = {
  get: () => focusOn,
  // Every entry path funnels through set(), so the false→true edge here is the
  // one place the persisted open-counter can be bumped — a re-set while focus
  // is already open never counts, an exit + re-entry always does.
  set: (v: boolean) => {
    const next = !!v
    if (next && !focusOn) statsStore.bumpEntries()
    focusOn = next
    notify()
  },
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

/** The session's pending user interaction (question / plan review / approval),
 *  read from the uiSession pending-interactions map — dsh 0.1.2 moved the old
 *  snapshot `pending` array into this root-level observable. When the service
 *  is absent (older dsh), falls back to the session snapshot's flat `pending`
 *  array through the `legacyPendingOf` adapter. Returns null when this session
 *  has nothing pending. */
function usePendingInteraction(uiSession: any, sessionId: any, snap: any): any {
  const source = uiSession && uiSession.pendingInteractions
  const read = () => { try { return source ? source.getSnapshot() : null } catch { return null } }
  const [map, setMap] = useState<any>(read)
  useEffect(() => {
    if (!source) { setMap(null); return }
    setMap(source.getSnapshot())
    try { return source.subscribe(() => setMap(source.getSnapshot())) } catch { return }
  }, [source])
  const modern = pendingInteractionOf(map, sessionId)
  return modern || legacyPendingOf(snap)
}

/** The session's Chat view snapshot (dsh 0.1.2 `ChatSnapshot`) from the
 *  uiConversation assembly — the first subscriber activates the chat target,
 *  so this hook must stay subscribed for the view to materialize its legacy
 *  slice. Null when the service is absent (older dsh). */
function useChatView(uiConversation: any, sessionId: any): any {
  const [chat, setChat] = useState<any>(null)
  useEffect(() => {
    if (!uiConversation || sessionId == null) { setChat(null); return }
    let unsub: (() => void) | null = null
    try {
      const binding = uiConversation.binding(sessionId)
      const source = binding.target('chat')
      setChat(source.getSnapshot() || null)
      unsub = source.subscribe(() => setChat(source.getSnapshot() || null))
    } catch { setChat(null) }
    return () => { if (unsub) unsub() }
  }, [uiConversation, sessionId])
  return chat
}

/** The official "对话显示" preference (`ui-chat.transcriptView`, values
 *  normal | compact), read reactively from the settings scope the official
 *  TranscriptViewPolicy binds. Defaults to compact — the official default —
 *  when the scope or the section has not arrived yet. */
function useTranscriptViewMode(settingsScope: any): 'normal' | 'compact' {
  const source = settingsScope
  const read = (): 'normal' | 'compact' => {
    try {
      const section = source ? source.getSnapshot().value : null
      const mode = section ? section.transcriptView : null
      return mode === 'normal' ? 'normal' : 'compact'
    } catch { return 'compact' }
  }
  const [mode, setMode] = useState<'normal' | 'compact'>(read)
  useEffect(() => {
    if (!source) { setMode('compact'); return }
    setMode(read())
    try { return source.subscribe(() => setMode(read())) } catch { return }
  }, [source])
  return mode
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

/** Re-exported from ./locales (moved there so the Composer's answer card can
 *  share it without FocusView ↔ Composer importing each other). */
export { markdownLabels }

function AssistantItem(props: { blocks: any[]; loadImage: (a: any) => Promise<string>; fileMentions: any; labels: any }) {
  const { blocks, loadImage, fileMentions, labels } = props
  const text = (blocks || []).filter((b) => b && b.kind === 'text').map((b) => b.text).join('')
  const images = (blocks || []).filter((b) => b && b.kind === 'image')
  return (
    <div className="fm-msg fm-assistant">
      {text ? <MarkdownText text={text} labels={labels} fileMentions={fileMentions} /> : null}
      {images.map((b, i) => <SessionImage key={i} attachment={b.attachment} loadImage={loadImage} />)}
    </div>
  )
}

/** The main view's composer seat — the DOM node the borrow path CSS-lifts
 *  above the overlay. ONE selector shared by the probe, the lift, the focus
 *  bridge, and the Esc peel, so they can never disagree on WHAT they lift. */
function composerSeat(): HTMLElement | null {
  return document.querySelector('[data-composer-seat]')
}

/** The official editor's editable surface inside the seat. The SAME node the
 *  availability probe verifies and the pill→bar handoff focuses: probe
 *  success therefore implies a focusable editor. If a dsh update moves either
 *  surface, the probe fails → the dock degrades to the built-in textarea bar
 *  — never to a silently un-focusable lifted composer. */
function composerEditable(seat: HTMLElement | null): HTMLElement | null {
  return seat ? seat.querySelector('[contenteditable="true"]') : null
}

function FocusContent(props: any) {
  const { useSessions, sessions, workspaces, conversation, chatFileMentions, uiSession, uiConversation, settingsScope, t } = props
  const prefs = usePrefs()
  const listState = useSessions((s: any) => s)
  const currentId = listState ? listState.current : undefined
  const snap = useSessionSnapshot(sessions, currentId)
  // dsh 0.1.2: conversation content lives in the chat view's legacy slice;
  // the session snapshot itself keeps only lifecycle/control state.
  const chatView = useChatView(uiConversation, currentId)
  const transcriptView = useTranscriptViewMode(settingsScope)
  const legacy = useMemo(() => legacySliceOf(chatView, snap), [chatView, snap])
      // `stable` = the streaming tail has drained (partial null): only a stable
    // snapshot lets the LAST turn fold — while streaming it stays normal-form.
    const stable = legacy.partial == null
  const mdLabels = useMemo(() => markdownLabels(t), [t])
    const items = useMemo(
      () => (snap ? buildItems(legacy.nodes, legacy.runningCalls, t, transcriptView, stable) : []),
      [snap, legacy, t, transcriptView, stable],
    )
  // User toggle state per process segment (keyed by the segment's turn seq —
  // stable across snapshot rebuilds and history prepends, unlike an index
  // key): overrides the mode-derived default. Reset whenever the setting
  // flips, so the view always starts from the official presentation after a
  // change.
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  useEffect(() => { setExpanded(new Set()) }, [transcriptView])
  const wait = usePendingInteraction(uiSession, currentId, snap)
  // Latest-items mirror: the anti-drift corrector below runs on a timer across
  // many renders, so it must read items through a ref — a closed-over `items`
  // would go stale on the next snapshot rebuild / history prepend.
  const itemsRef = useRef(items)
  itemsRef.current = items

  // ---- full-history load (dsh 0.1.2) ----
  // The conversation is paged by turns now: a fresh binding only materializes
  // the tail window, so a full-session reading view must page back to the
  // start itself. While the overlay is open, drive the session face's
  // loadOlder() until `hasMore` clears (bounded; aborted on unmount). The
  // same pagination the official "加载更早" button drives — the overlay just
  // runs it to completion.
  const snapRef = useRef<any>(null)
  snapRef.current = snap
  useEffect(() => {
    let alive = true
    const b = (sessions && currentId != null) ? sessions.binding(currentId) : null
    const face = b && b.session
    if (!face || typeof face.loadOlder !== 'function') return
    const load = async () => {
      let pages = 0
      while (alive && pages < 500) {
        const s: any = snapRef.current
        if (!s || !s.hasMore || s.openState !== 'open') break
        if (s.loadingOlder) { await new Promise((r) => setTimeout(r, 60)); continue }
        try { await face.loadOlder() } catch { break }
        pages++
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    load()
    return () => { alive = false }
  }, [sessions, currentId])

  // Turn rail (official TurnNavigator replica): one mark per known turn,
  // driven by the chat view's turn navigation index. Each mark's anchor seq
  // resolves to its focus-item index — the overlay scroll target — and the
  // previews reuse the official bounded prompt/response strings.
  const rail: RailItem[] = useMemo(() => {
    if (!chatView || !chatView.navigation || !chatView.navigation.items) return []
    const out: RailItem[] = []
    const used = new Set<number>()
    let navItems: any[] = []
    try { navItems = chatView.navigation.items() || [] } catch { navItems = [] }
    for (const it of navItems) {
      if (!it) continue
      let seq: number | null = null
      try {
        const node = chatView.nodes && chatView.nodes.get ? chatView.nodes.get(it.anchorKey) : null
        if (node && typeof node.anchorSeq === 'number') seq = node.anchorSeq
      } catch { /* defensive */ }
      let idx = seq != null ? findSeqIndex(items, seq) : -1
      // Turn-process control nodes anchor at a FRACTIONAL seq (an insertion
      // point between messages), which never equals a content seq — exact
      // matching drops the turn's mark exactly while it streams (the state a
      // reader is most likely looking at). Fall back to the nearest user row
      // at or below the anchor: a turn-process anchor sits inside its own
      // turn, so that row is the turn's own prompt.
      if (idx < 0 && seq != null && Number.isFinite(seq)) {
        for (let i = items.length - 1; i >= 0; i--) {
          const row = items[i]
          if ((row.kind === 'user' || row.kind === 'steering') && row.seq <= seq) { idx = i; break }
        }
      }
      // A turn whose prompt row is not loaded yet also falls back onto an
      // earlier row that already has its own mark — dedupe keeps the real one.
      if (idx < 0 || used.has(idx)) continue
      used.add(idx)
      out.push({
        turn: it.turn,
        prompt: (it.prompt || '').replace(/\s+/g, ' ').trim(),
        response: (it.response || '').replace(/\s+/g, ' ').trim(),
        idx,
      })
    }
    return out
  }, [chatView, items])

  const navKeys: string[] = []
  const navPreviews: Record<string, string> = {}
  for (const r of rail) {
    const k = 'fm-' + r.idx
    navKeys.push(k)
    navPreviews[k] = r.prompt
  }

  const [activeKey, setActiveKey] = useState<string | null>(navKeys.length ? navKeys[navKeys.length - 1] : null)
  // Bottom-zone membership with hysteresis (see bottomZoneAfter): true while
  // the reader sits at the live edge — the position the dock offers the bar.
  const [zone, setZone] = useState<boolean>(true)
  const rafId = useRef<number | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  // Bottom dock state: answer-card open (the waiting toast morphed in place),
  // textarea focus (the guard that keeps an empty-but-focused bar up), the
  // one-render pill→bar handoff (engaged: focus not landed yet), and the
  // plugin-local fallback draft for dsh builds without the input service.
  const [cardOpen, setCardOpen] = useState<boolean>(false)
  const [dockFocused, setDockFocused] = useState<boolean>(false)
  const [engaged, setEngaged] = useState<boolean>(false)
  const [localDraft, setLocalDraft] = useState<string>('')
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const focusBarOnce = useRef<boolean>(false)
  // Send-reveal ledger (refs, not state — they bookkeep between renders and
  // must never trigger one): a send issued while the reader sits in the bottom
  // zone arms the reveal, and `seenPromptSeq` remembers the newest prompt
  // row's seq so the reveal effect can tell "the sent row just rendered"
  // apart from ordinary streaming snapshots.
  const revealArmed = useRef<boolean>(false)
  const seenPromptSeq = useRef<number | null>(null)

  // Measurement only: collect the anchors' viewport-relative tops (a stale key
  // keeps its slot as Infinity so indices stay aligned with navKeys) and hand
  // the decision to activeNavIndex, which force-lights the last dot near the
  // scroll end — a short final turn can never push its anchor up to the top
  // line on its own. A bottom-forced index is mapped back to the nearest
  // anchor that still exists.
  const computeActive = () => {
    if (!bodyEl) return null
    const bodyTop = bodyEl.getBoundingClientRect().top
    const tops = navKeys.map((k) => {
      const el = anchors[k]
      return el ? el.getBoundingClientRect().top - bodyTop : Number.POSITIVE_INFINITY
    })
    const i = activeNavIndex(tops, bottomDistance())
    for (let j = i; j >= 0; j--) { if (anchors[navKeys[j]]) return navKeys[j] }
    return null
  }
  const bottomDistance = () => {
    if (!bodyEl) return Number.POSITIVE_INFINITY
    return bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight
  }
  // The single recompute path — nav highlight and dock zone together, coalesced
  // to one run per frame. Scroll, resize, and content updates all land here so
  // the two never disagree about where the reader is.
  const scheduleRecompute = () => {
    if (rafId.current !== null) return
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null
      const c = computeActive()
      // computeActive() measures anchor geometry; during the frame right after
      // a positioning scroll (or while rows are still registering) it can
      // return null even though the reader IS on a turn. Overwriting the
      // highlight with null would make the active mark fall back to the LAST
      // rail dot (activeIndex -1 → rail[rail.length-1]). Keep the previous
      // highlight until geometry reports a real anchor again.
      if (c !== null) setActiveKey(c)
      setZone((prev) => bottomZoneAfter(prev, bottomDistance()))
    })
  }
  // Long-lived listeners (the resize observer below) must reach the LATEST
  // closure — navKeys is rebuilt per render — so they read through this ref.
  const scheduleRef = useRef<() => void>(scheduleRecompute)
  useEffect(() => { scheduleRef.current = scheduleRecompute })
  const scrollToKey = (key: string, smooth: boolean) => {
    const el = anchors[key]
    if (!el || !bodyEl) return
    const top = el.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top + bodyEl.scrollTop
    bodyEl.scrollTo({ top: top - 16, behavior: smooth ? 'smooth' : 'auto' })
  }
  const scrollToBottom = () => { if (bodyEl) bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'smooth' }) }

  // ---- open positioning (pending-target model) ----
  // dsh 0.1.2 pages history in asynchronously AND assembles the chat target
  // lazily (the snapshot is empty right after activation), so neither the
  // anchor seq nor the item list exists at mount. Keep the entry intent in a
  // ref and resolve it lazily on every pass until the anchor materializes —
  // with a deadline that falls back to the classic behaviors.
  const entryRef = useRef<{ kind: 'auto'; seq: number } | { kind: 'anchor'; key: string } | { kind: 'lastUser' } | undefined>(undefined)
  const positionedRef = useRef<boolean>(false)
  const positionDeadlineRef = useRef<number>(0)
  // One-shot anti-drift correction: after the loader finishes, re-anchor the
  // saved reading position (prepend shifts it by the loaded height).
  const correctionRef = useRef<{ seq: number; top: number } | null>(null)

  useEffect(() => {
    if (entryRef.current !== undefined) return
    positionDeadlineRef.current = Date.now() + 6000
    const autoSeq = focusStore.consumeAutoSeq()
    if (autoSeq != null) { entryRef.current = { kind: 'auto', seq: autoSeq }; return }
    const anchorKey = focusStore.consumeAnchorKey()
    if (prefs.scroll === 'preserve' && anchorKey) { entryRef.current = { kind: 'anchor', key: anchorKey }; return }
    entryRef.current = { kind: 'lastUser' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (positionedRef.current || entryRef.current === undefined) return
    const entry = entryRef.current
    // Wait for the history loader to finish first: pages PREPEND above the
    // anchor, so positioning mid-load would drift as later pages land. The
    // pure decision below repeats this rule so the two can never disagree.
    let seq: number | null = null
    if (entry.kind === 'auto') seq = entry.seq
    else if (entry.kind === 'anchor') {
      // dsh 0.1.2: the chat view's node store is the authoritative key → seq
      // map (the session snapshot carries only lifecycle state). Resolve from
      // the assembled chat view when it exists; while it is still being
      // assembled the uiConversation target snapshot is the same store, so
      // reading through the service keeps the anchor resolvable even on the
      // mount render where the local chatView state has not landed yet.
      let nodes = chatView && chatView.nodes
      if (!nodes && uiConversation && currentId != null) {
        try { nodes = uiConversation.binding(currentId).target('chat').getSnapshot()?.nodes } catch { /* defensive */ }
      }
      seq = resolveAnchorSeq(nodes, entry.key)
    }
    const decision = decideOpenScroll({
      kind: entry.kind,
      seq,
      items,
      hasMore: !!(snap && snap.hasMore),
      deadlinePassed: Date.now() >= positionDeadlineRef.current,
    })
    if (decision.action === 'wait') return
    if (decision.action === 'scroll') {
      scrollToKey('fm-' + decision.index, false)
      setActiveKey('fm-' + decision.index)
      // A TRUE target scroll (the anchor's own seq matched a row) arms the
      // anti-drift corrector: pages PREPEND above the anchor while the loader
      // walks back and async content (images, highlight) shifts layout
      // afterwards, which drifts the anchored row. Fallback scrolls (seq null)
      // carry no target to hold steady.
      const el = anchors['fm-' + decision.index]
      if (decision.seq != null && el && bodyEl) {
        correctionRef.current = {
          seq: decision.seq,
          top: el.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top + bodyEl.scrollTop,
        }
      }
      positionedRef.current = true
      return
    }
    // bottom
    if (bodyEl) bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'auto' })
    setActiveKey(navKeys.length ? navKeys[navKeys.length - 1] : null)
    positionedRef.current = true
  }, [items, snap, chatView])

  // Anti-drift convergence: async content (images, code highlight, late
  // prepends) keeps shifting the anchored row after the initial scroll. For a
  // short window, re-measure and nudge the scrollport back until the anchor
  // holds steady at its recorded offset.
  useEffect(() => {
    const c = correctionRef.current
    if (!c) return
    let tries = 0
    const timer = setInterval(() => {
      tries++
      // Read through the ref: `items` rebuilds on every snapshot (streaming
      // tail, prepends), so the render-time closure is stale by design.
      const items = itemsRef.current
      const idx = findSeqIndex(items, c.seq)
      const el = idx >= 0 ? anchors['fm-' + idx] : undefined
      if (!el || !bodyEl) { if (tries > 40) { clearInterval(timer); correctionRef.current = null } return }
      const now = el.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top + bodyEl.scrollTop
      const delta = now - c.top
      if (Math.abs(delta) <= 2 || tries > 40) { clearInterval(timer); correctionRef.current = null; return }
      bodyEl.scrollTop += delta
    }, 150)
    return () => clearInterval(timer)
    // Runs once per positioned open; items are read via itemsRef, which
    // always mirrors the latest render.
  }, [])
  // Zone seed: runs after the mount-positioning effect above (effects fire in
  // declaration order), so the dock's first form matches wherever the overlay
  // actually opened — at the live edge or up in the history. Seeded with
  // prev=false so "in zone" at mount means genuinely within the 48px enter
  // threshold, not merely inside the hysteresis band.
  useEffect(() => {
    setZone(bodyEl ? bottomZoneAfter(false, bottomDistance()) : true)
  }, [])

  // Layout changes that never fire scroll must still recompute: a window
  // resize reshapes the scrollport, a width-pref change reflows the content,
  // and a streaming snapshot swaps messages out from under a stale highlight.
  // All of it funnels through the same rAF-coalesced path as scrolling.
  useEffect(() => {
    const el = bodyEl
    if (!el || typeof ResizeObserver === 'undefined') return
    setViewportW(el.clientWidth)
    const ro = new ResizeObserver(() => {
      setViewportW(el.clientWidth)
      scheduleRef.current()
    })
    ro.observe(el)
    return () => ro.disconnect()
    // scheduleRef is read through the ref — safe to run once.
  }, [])
  useEffect(() => { scheduleRef.current() }, [snap, prefs.width])

  // Reveal-on-send: while the reader sits at the live edge, a prompt sent from
  // the dock must land fully on screen. The scrollport keeps its scrollTop
  // while the new row grows the document below the fold, so a long multi-line
  // message would end up half hidden behind the dock and half past the
  // viewport's bottom edge. The send path arms the reveal (bottom zone only);
  // this effect fires it on the snapshot where the newest prompt seq actually
  // advances, scrolling the minimum distance that lifts the row's bottom clear
  // of the dock reserve — then disarms, so later snapshots (streaming growth)
  // never scroll again.
  useEffect(() => {
    const seq = lastPromptSeq(items)
    if (seq != null && shouldRevealSentPrompt({ armed: revealArmed.current, prevSeq: seenPromptSeq.current, nextSeq: seq })) {
      revealArmed.current = false
      const idx = findSeqIndex(items, seq)
      const el = idx >= 0 ? anchors['fm-' + idx] : undefined
      if (el && bodyEl) {
        const limit = bodyEl.getBoundingClientRect().bottom - REVEAL_RESERVE_PX
        const hidden = el.getBoundingClientRect().bottom - limit
        if (hidden > 0) bodyEl.scrollBy({ top: hidden, behavior: 'smooth' })
      }
    }
    seenPromptSeq.current = seq
  }, [items])

  // A scroll scheduled for after unmount must not touch removed state.
  useEffect(() => () => {
    if (rafId.current !== null) { cancelAnimationFrame(rafId.current); rafId.current = null }
  }, [])

  useEffect(() => { overlayRef.current?.focus() }, [])

  // Esc peels one layer at a time (window capture, so it fires regardless of
  // where keyboard focus sits): the answer card closes first (back to the
  // waiting toast — the pending is still there), then an in-use input bar
  // collapses (blur = collapse: the draft folds into the pill), and only an
  // Esc with nothing engaged exits focus mode. The handler re-registers on the
  // facts it reads so the peel order always matches the live dock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Mid-IME-composition Esc cancels the composition, not the dock layer.
      // Safari reports the composition-committing key with isComposing=false
      // + keyCode 229, so guard both (official composer precedent).
      if ((e as any).isComposing || (e as any).keyCode === 229) return
      // The host composer's own popup (slash/@ menu) is open inside the
      // lifted seat: let the host close IT first — swallowing the Esc here
      // would collapse the bar out from under the open menu. The next Esc
      // (menu gone) peels the bar as usual.
      if (composerSeat()?.querySelector('[role="listbox"]')) return
      e.preventDefault()
      e.stopPropagation()
      if (cardOpen) { setCardOpen(false); return }
      if (dockFocused || engaged) { hideBar(); return }
      focusStore.set(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // hideBar touches only setters and refs — safe to omit from deps.
  }, [cardOpen, dockFocused, engaged])

  const loadImage = useCallback((attachment: any): Promise<string> => {
    // dsh 0.1.2: the conversation controller's resolveImage gave way to the
    // uiConversation assembly's session-authorized image cache. Both the sync
    // throw and the async rejection fall through to the legacy resolver; a
    // falsy result (imageUrl returned undefined) does too.
    const modern = uiConversation && currentId
      ? (async () => {
        const url = await uiConversation.imageUrl(currentId, attachment)
        if (url) return url
        throw new Error('no url')
      })()
      : null
    if (modern) return modern.catch(() => legacyResolve(attachment))
    return legacyResolve(attachment)
  }, [uiConversation, conversation, currentId])
  // legacyResolve closes over the useCallback deps; defined via a helper so
  // both paths share it. eslint-disable not needed (no hook deps lint here).
  function legacyResolve(attachment: any): Promise<string> {
    if (conversation && typeof conversation.resolveImage === 'function') {
      return conversation.resolveImage(currentId, attachment)
    }
    return Promise.reject(new Error('dsh-focus-overlay: image resolver unavailable'))
  }

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

  // ---- bottom dock wiring ----
  // The bar shares the MAIN composer's draft through the official per-session
  // input machine (conversation.input.for(binding.ctx)): text typed before
  // entering focus mode is already in the bar, and text typed here is still in
  // the main composer after leaving. Without the input service the bar falls
  // back to a plugin-local draft sent through the session face's prompt verb.
  const binding = useMemo(() => (sessions && currentId != null) ? sessions.binding(currentId) : undefined, [sessions, currentId])
  const inputFace = useInputFace(conversation, binding && binding.ctx)
  const inputState = useInputState(inputFace)
  const draftValue = inputFace ? (inputState && typeof inputState.draft === 'string' ? inputState.draft : '') : localDraft
  const draftEmpty = draftValue.trim() === ''
  // `wait` comes from the uiSession pending-interactions hook above (dsh 0.1.2
  // shape: one PendingQuestion / PendingApproval per session).
  const pending = !!wait

  const onDraftChange = (v: string) => {
    if (inputFace) {
      try { inputFace.setDraft(v); return } catch { /* fall through */ }
    }
    setLocalDraft(v)
  }
  const send = () => {
    const text = draftValue
    if (text.trim() === '') return
    // Sending from the live edge: arm the send-reveal so the row scrolls fully
    // into view once delivery renders it (see the reveal-on-send effect).
    // Sends from up in the history never arm — the reader's place is sacred.
    if (zone) revealArmed.current = true
    if (inputFace) {
      // Official pipeline: adjudication, queue delivery, failure into the
      // snapshot's promptError, draft handling — all the main composer gets.
      try { inputFace.submit('queue'); return } catch { /* fall through */ }
    }
    const face = binding && binding.session
    if (face) {
      face.prompt([{ type: 'text', text }], 'queue')
        .then((r: any) => { if (r && r.ok) setLocalDraft('') })
        .catch(() => { /* failure lands in promptError */ })
    }
  }
  const hideBar = () => {
    // Esc peel for an in-use bar: blurring the input surface IS the collapse
    // (a blurred bar with a draft folds into the pill via bottomForm), and the
    // explicit flag clear covers a focus that never landed. Covers both input
    // surfaces: the fallback textarea and the borrowed official composer.
    try {
      if (taRef.current) taRef.current.blur()
      const seat = composerSeat()
      const active = document.activeElement
      if (seat && active && seat.contains(active)) (active as HTMLElement).blur()
    } catch { /* ignore */ }
    setEngaged(false)
    setDockFocused(false)
  }
  const expandBar = () => { focusBarOnce.current = true; setEngaged(true) }
  const onDockFocusChange = (f: boolean) => {
    setDockFocused(f)
    if (!f) setEngaged(false)
  }

  const queueCount = snap && snap.queue ? snap.queue.length : 0
  const occCount = inputState && inputState.occurrences ? inputState.occurrences.length : 0
  const promptErr = snap && snap.promptError && snap.promptError.op === 'send' ? snap.promptError.error : null
  const errorLine = promptErr ? (promptErr.message || promptErr.code || 'send failed') : null
  const form = bottomForm({ pending, cardOpen, draftEmpty, inZone: zone, focused: dockFocused, engaged })

  // ---- official-composer borrow (the preferred input bar) ----
  // Instead of mirroring the shared draft into our own textarea (which must
  // fight the host Lexical editor's synchronous focus-stealing commits — see
  // the echo/caret machinery in Composer.tsx), the focus bar BORROWS the
  // official composer itself: the main view's [data-composer-seat] element is
  // CSS-lifted above the overlay (position:fixed + a z just above .fm-overlay)
  // whenever the dock wants the bar form. It IS the official editing surface,
  // so slash commands, @ references, chips, images and IME behave exactly as
  // in the main view — one editor, no echo, no focus theft to undo. Probe
  // first: when the seat or its editable surface is missing (older dsh, host
  // DOM drift), borrowAvailable stays false and the dock falls back to the
  // built-in textarea bar, which the e2e caret loop keeps correct.
  const [borrowAvailable, setBorrowAvailable] = useState<boolean>(false)
  const borrowWanted = prefs.borrow && !!currentId && snap !== null
  const borrowedBar = shouldLiftOfficialComposer({ wanted: borrowWanted, available: borrowAvailable, form })
  useEffect(() => {
    if (!borrowWanted) { setBorrowAvailable(false); return }
    let tries = 0
    let timer: any = null
    const probe = () => {
      // Probe the SAME editable surface the pill→bar handoff focuses (see
      // composerEditable) — never a parallel selector that can drift apart.
      if (composerEditable(composerSeat())) { setBorrowAvailable(true); return }
      if (++tries > 30) return // ~3s of retries, then stay on the fallback bar
      timer = setTimeout(probe, 100)
    }
    probe()
    return () => { if (timer) clearTimeout(timer) }
  }, [borrowWanted])

  // Focus bridge: focusin/focusout on the lifted seat drive the same
  // dock-focused state the textarea's onFocus/onBlur does. A focus move that
  // STAYS inside the seat (the slash/@ menus live in the composer card) is
  // not a blur; anything else collapses the bar exactly like a textarea blur.
  // Declared BEFORE the lift effect so its listeners are already attached
  // when the handoff below focuses the editor inside the same effect flush.
  useEffect(() => {
    if (!borrowedBar) return
    const seat = composerSeat()
    if (!seat) return
    const inSeat = (t: EventTarget | null): boolean => t instanceof Node && seat.contains(t)
    const onFocusIn = (e: FocusEvent) => { if (inSeat(e.target)) onDockFocusChange(true) }
    const onFocusOut = (e: FocusEvent) => {
      if (inSeat(e.relatedTarget)) return
      setTimeout(() => { if (!inSeat(document.activeElement)) onDockFocusChange(false) }, 0)
    }
    seat.addEventListener('focusin', onFocusIn)
    seat.addEventListener('focusout', onFocusOut)
    return () => {
      seat.removeEventListener('focusin', onFocusIn)
      seat.removeEventListener('focusout', onFocusOut)
      onDockFocusChange(false)
    }
    // onDockFocusChange only touches setters — safe to hold from first render.
  }, [borrowedBar])

  // Lift/unlift the seat with the bar form. The cleanup ALWAYS strips the
  // class — including the unmount-while-lifted path (focus mode exiting with
  // the bar in use), where a leaked .fm-lift would keep the main composer
  // floating over the normal view after the overlay is gone.
  useEffect(() => {
    const seat = composerSeat()
    if (!seat) return
    if (!borrowedBar) return
    seat.style.setProperty('--fm-lift-width', `${Math.min(prefs.width, LIFT_MAX_WIDTH)}px`)
    seat.classList.add('fm-lift')
    // Pill → bar handoff: land the caret in the official editor surface and
    // set the dock-focused flag SYNCHRONOUSLY from the DOM outcome — the
    // focusin listener may not have observed this focus, and clearing
    // `engaged` without focused set would collapse the bar back to the pill
    // in the very next render. If the editable surface the probe verified is
    // suddenly gone (selector drift mid-session), degrade to the built-in
    // textarea bar — availability flips off, this effect's cleanup unlifts,
    // and the handoff flag stays armed for the textarea focus path.
    if (focusBarOnce.current) {
      const editable = composerEditable(seat)
      if (!editable) {
        // Keep `engaged` and the handoff flag armed: the dock lands on the
        // built-in textarea bar this render and the focus-once effect puts
        // the caret there — the pill click still gets its bar, just ours.
        setBorrowAvailable(false)
        setDockFocused(false)
      } else {
        focusBarOnce.current = false
        let landed = false
        try { editable.focus(); landed = seat.contains(document.activeElement) } catch { /* ignore */ }
        onDockFocusChange(landed)
        setEngaged(false)
      }
    }
    return () => {
      seat.classList.remove('fm-lift')
      seat.style.removeProperty('--fm-lift-width')
    }
  }, [borrowedBar, prefs.width])

  // Sends made through the OFFICIAL composer (its own Enter/submit gesture)
  // never pass through our send() — arm the send-reveal from the draft's
  // non-empty → empty edge instead, so a row sent from focus mode still
  // scrolls clear of the dock. Our own send() arming stays as-is.
  const prevDraftRef = useRef(draftValue)
  useEffect(() => {
    if (prevDraftRef.current !== '' && draftValue === '' && zone) revealArmed.current = true
    prevDraftRef.current = draftValue
  }, [draftValue, zone])

  // The answer card lives only while its pending wait does — answered (even
  // from elsewhere) the region falls back to the normal forms. A pending
  // takeover also replaces the bar, whose textarea unmounts without blurring,
  // so the focus/handoff flags are cleared explicitly — including the
  // focus-once ref, or a pill click cancelled by this takeover would
  // auto-focus the textarea unprompted when the bar next renders.
  useEffect(() => {
    if (!pending) { if (cardOpen) setCardOpen(false); return }
    focusBarOnce.current = false
    setDockFocused(false)
    setEngaged(false)
  }, [pending, cardOpen])

  // Expand-on-click focus (fallback textarea path; the borrowed composer's
  // handoff lives in the lift effect above): landing the caret straight in
  // the textarea saves a click for the pill → bar path. `engaged` is the
  // one-render handoff only — once focus lands (or fails), focused-or-not
  // takes over.
  useEffect(() => {
    if (form === 'bar' && !borrowedBar && focusBarOnce.current) {
      focusBarOnce.current = false
      try { taRef.current && taRef.current.focus() } catch { /* ignore */ }
      setEngaged(false)
    }
  }, [form, borrowedBar])

  let title = 'Focus Mode'
  if (currentId && listState && listState.byId && listState.byId[currentId]) {
    const row = listState.byId[currentId]
    if (row && row.displayTitle) title = row.displayTitle
  }

  // Content width: the overlay's own draggable column (official WidthHandle
  // replica). It does NOT inherit the main view's width — the overlay manages
  // its own preference, dragged live via the side handles and persisted in the
  // plugin prefs. `dragWidth` holds the in-flight value so the column tracks
  // the pointer in real time; commit persists it into the prefs store.
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [viewportW, setViewportW] = useState<number>(0)
  const width = dragWidth ?? prefs.width
  const clampWidth = useCallback((w: number) => {
    const vw = bodyEl ? bodyEl.clientWidth : viewportW
    const max = Math.max(CONTENT_MIN, vw - CONTENT_EDGE_BUDGET)
    return Math.round(Math.min(Math.max(w, CONTENT_MIN), max))
  }, [viewportW])
  const onWidthStart = useCallback(() => clampWidth(prefs.width), [clampWidth, prefs.width])
  const onWidthDrag = useCallback((w: number) => setDragWidth(clampWidth(w)), [clampWidth])
  const onWidthCommit = useCallback((w: number) => {
    const clamped = clampWidth(w)
    setDragWidth(null)
    if (clamped !== prefs.width) prefsStore.update({ width: clamped })
  }, [clampWidth, prefs.width])
  const onWidthEnd = useCallback(() => setDragWidth(null), [])

  let body: any
  if (!currentId) {
    body = <div className="fm-empty">{t('empty')}</div>
  } else if (snap === null) {
    body = <div className="fm-empty">{t('loading')}</div>
  } else {
    const partial = legacy.partial
    const partialBlocks = partial ? partial.blocks : []
    const running = !!snap.running
    const kids: any[] = []
    if (snap.hasMore) {
      // History still paging in (dsh 0.1.2 turn pagination): a quiet marker
      // above the transcript while the loader walks back to the start.
      kids.push(<div key="fm-history" className="fm-hidden">{t('loading')}</div>)
    }
    // One item renderer, used at top level (user rows register chat anchors
    // for position sync and the nav rail) and recursively inside an expanded
    // turn-process segment (nested rows never register anchors).
    const renderItem = (it: any, key: string, registerAnchor: boolean): any => {
      if (it.kind === 'user') {
        return (
          <div key={key} className="fm-msg fm-user-msg" ref={(el) => { if (registerAnchor) { if (el) anchors[key] = el; else delete anchors[key] } }}>
            <div className="fm-user"><MessageText text={it.text} /></div>
          </div>
        )
      }
      if (it.kind === 'steering') {
        return (
          <div key={key} className="fm-msg fm-user-msg" ref={(el) => { if (registerAnchor) { if (el) anchors[key] = el; else delete anchors[key] } }}>
            <div className="fm-user fm-steering"><MessageText text={it.text} /></div>
          </div>
        )
      }
      if (it.kind === 'assistant') {
        return <AssistantItem key={key} blocks={it.blocks} loadImage={loadImage} fileMentions={fileMentionsFor(it)} labels={mdLabels} />
      }
      if (it.kind === 'error') {
        return <div key={key} className="fm-msg fm-error">{it.text}</div>
      }
      if (it.kind === 'hidden') {
        return <div key={key} className="fm-hidden">· {it.text} ·</div>
      }
      if (it.kind === 'turnProcess') {
        const open = !it.collapsed || expanded.has(it.seq)
        const toggle = () => setExpanded((prev) => {
          const next = new Set(prev)
          if (next.has(it.seq)) next.delete(it.seq)
          else next.add(it.seq)
          return next
        })
        return (
          <div key={key}>
            {it.collapsed ? (
              <button
                type="button"
                className="fm-process-root"
                data-open={open || undefined}
                aria-expanded={open}
                onClick={toggle}
              >
                <span className="fm-process-label">{processLabel(it.counts, t)}</span>
                <IconChevronDownOutline14 className="fm-process-chevron" />
              </button>
            ) : null}
            {open ? it.workItems.map((wi: any, wi2: number) => renderItem(wi, key + '-w' + wi2, false)) : null}
          </div>
        )
      }
      return null
    }
    for (let i = 0; i < items.length; i++) {
      const rendered = renderItem(items[i], 'fm-' + i, true)
      if (rendered) kids.push(rendered)
    }
    if (partialBlocks.length) {
      kids.push(<AssistantItem key="fm-partial" blocks={partialBlocks} loadImage={loadImage} fileMentions={undefined} labels={mdLabels} />)
    }
    if (running) {
      kids.push(
        <div key="fm-running" className="fm-running" role="status">
          <span className="fm-running-text"><span className="fm-running-dash" aria-hidden="true">–</span>{t('running')}<span className="fm-running-dash" aria-hidden="true">–</span></span>
        </div>,
      )
    }
    body = <div className="fm-inner" style={{ maxWidth: width, '--fm-content-width': `${width}px` } as React.CSSProperties}>{kids}</div>
  }

  const activeIndex = activeKey ? navKeys.indexOf(activeKey) : -1
  // The active mark's turn number — the rail highlights marks by turn, the
  // overlay's scroll logic speaks in focus-item keys.
  const activeTurn = rail.length
    ? (activeIndex >= 0 && rail[activeIndex] ? rail[activeIndex].turn : rail[rail.length - 1].turn)
    : null

  const nav = (prefs.navbar && rail.length >= 2)
    ? (
      <TurnRail
        items={rail}
        activeTurn={activeTurn}
        onNavigate={(item) => scrollToKey('fm-' + item.idx, true)}
        label={t('nav.label')}
        jumpLabel={(turn) => t('nav.jump', { n: turn })}
        turnLabel={(turn) => t('nav.turn', { n: turn })}
      />
    )
    : null

  // "AI is waiting for your reply" — a live state derived from the session's
  // pending interactions. It shows while any question/approval is unanswered,
  // and its button now morphs it into the in-place answer card instead of
  // exiting focus mode. It hides while the card is open (the card IS the
  // reply surface then) and clears by itself once the user answers.
  const waiting = pending && !cardOpen

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
        <Button variant="primary" size="sm" onClick={() => setCardOpen(true)}>{t('answer.open')}</Button>
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
    <div className="fm-overlay" ref={overlayRef} tabIndex={-1}>
      <div className="fm-topbar">
        <div className="fm-title">{title}</div>
        <Button variant="outline" size="sm" onClick={() => focusStore.set(false)}>{t('exit')}</Button>
      </div>
      <div className="fm-body-wrap">
        <div className="fm-body" ref={(el) => { bodyEl = el }} onScroll={scheduleRecompute}>{body}</div>
        {currentId && snap !== null ? (
          <WidthHandles
            width={width}
            onStart={onWidthStart}
            onDrag={onWidthDrag}
            onCommit={onWidthCommit}
            onEnd={onWidthEnd}
          />
        ) : null}
      </div>
      {nav}
      {currentId && snap !== null ? (
        <div className="fm-dock">
          <FocusBottomDock
            t={t}
            width={prefs.width}
            form={form}
            borrowed={borrowedBar}
            wait={wait}
            onCardClose={() => setCardOpen(false)}
            draft={draftValue}
            queueCount={queueCount}
            occCount={occCount}
            errorLine={errorLine}
            textareaRef={taRef}
            onFocusChange={onDockFocusChange}
            onDraftChange={onDraftChange}
            onSend={send}
            onExpand={expandBar}
            onJumpBottom={scrollToBottom}
          />
        </div>
      ) : null}
      {replyNotice}
    </div>
  )
}

/** Error boundary around the overlay content: a render crash would otherwise
 *  unmount the slot subtree and every later entry would crash again — the
 *  toggle would look permanently dead. The boundary logs, renders nothing for
 *  the failed pass, and re-arms on the next open (keyed by open count). */
class FocusErrorBoundary extends Component<{ resetKey: number; children: ReactNode }, { error: any }> {
  state = { error: null as any }
  static getDerivedStateFromError(error: any) { return { error } }
  componentDidUpdate(prev: { resetKey: number }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }
  render() {
    if (this.state.error) {
      console.error('[dsh-focus-overlay] overlay render failed; it will retry on the next open', this.state.error)
      return null
    }
    return this.props.children
  }
}

export function FocusOverlay(props: any) {
  const on = useFocus()
  // Count false→true transitions so the boundary re-arms every fresh open.
  const opens = useRef(0)
  if (!on) { opens.current++; return null }
  return <FocusErrorBoundary resetKey={opens.current}><FocusContent {...props} /></FocusErrorBoundary>
}

export function FocusToggle({ t }: { t: FocusTranslate }) {
  return (
    <Button variant="ghost" size="sm" title={t('toggle.title')} onClick={() => { focusStore.captureChatAnchor(); focusStore.set(true) }}>
      {t('toggle')}
    </Button>
  )
}

function FocusPrefsFields({ t }: { t: FocusTranslate }) {
  const prefs = usePrefs()
  return (
    <>
      <div className="fm-plugin-field">
        <label className="fm-plugin-check">
          <input type="checkbox" checked={prefs.autoFocus} onChange={(e) => prefsStore.update({ autoFocus: e.target.checked })} />
          <span className="fm-plugin-check-label">{t('settings.autoFocus')}</span>
        </label>
        <p className="fm-plugin-field-hint">{t('settings.autoFocus.hint')}</p>
      </div>
      <div className="fm-plugin-field">
        <label className="fm-plugin-check">
          <input type="checkbox" checked={prefs.hotkey} onChange={(e) => prefsStore.update({ hotkey: e.target.checked })} />
          <span className="fm-plugin-check-label">{t('settings.hotkey')}</span>
        </label>
        <p className="fm-plugin-field-hint">{t('settings.hotkey.hint')}</p>
      </div>
      <div className="fm-plugin-field">
        <label className="fm-plugin-check">
          <input type="checkbox" checked={prefs.borrow} onChange={(e) => prefsStore.update({ borrow: e.target.checked })} />
          <span className="fm-plugin-check-label">{t('settings.borrow')}</span>
        </label>
        <p className="fm-plugin-field-hint">{t('settings.borrow.hint')}</p>
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
          <input type="checkbox" checked={prefs.navbar} onChange={(e) => prefsStore.update({ navbar: e.target.checked })} />
          <span className="fm-plugin-check-label">{t('settings.navbar')}</span>
        </label>
        <p className="fm-plugin-field-hint">{t('settings.navbar.hint')}</p>
      </div>
    </>
  )
}

/** The settings card's bottom row: the persisted focus-entry counter, and —
 *  once the count passes the threshold — a nudge to star the repo. */
const REPO_URL = 'https://github.com/boogoo619/dsh-focus-overlay'

function FocusEntryStat({ t }: { t: FocusTranslate }) {
  const entries = useEntryCount()
  const starred = useStarred()
  const star = shouldShowStar(entries)
  return (
    <div className="fm-plugin-field fm-plugin-field-stat">
      {/* One row (existing horizontal head class): counter text left, button right — the row keeps a single line's height. */}
      <div className="fm-plugin-field-head">
        <span className="fm-plugin-field-label">{t(star ? 'settings.entries.cheer' : 'settings.entries', { n: entries })}</span>
        {star ? (starred ? (
          // Already starred once (persisted): a plain jump, no celebration.
          <Button
            variant="outline"
            size="sm"
            onClick={() => { try { window.open(REPO_URL, '_blank', 'noopener') } catch { /* ignore */ } }}
          >
            {t('settings.entries.repo')}
          </Button>
        ) : (
          // First time: the show runs first — celebrateThenOpen waits for the
          // fireworks to end before the new tab takes focus — and the starred
          // flag persists, so the card never asks for a star twice.
          <Button
            variant="primary"
            size="sm"
            onClick={() => { statsStore.markStarred(); celebrateThenOpen(REPO_URL) }}
          >
            {t('settings.entries.star')}
          </Button>
        )) : null}
      </div>
    </div>
  )
}

export function FocusSettingsCard({ t }: { t: FocusTranslate }) {
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
          <FocusPrefsFields t={t} />
          <FocusEntryStat t={t} />
        </div>
      ) : null}
    </li>
  )
}

export function FocusOnboarding(props: any) {
  const { complete, openSection, t } = props
  const [done, setDone] = useState<boolean>(() => onboardingStore.isDone())
  const finished = useRef(false)
  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    complete()
  }, [complete])

  // Skip silently once the intro has already been seen (the coordinator's
  // completed set is component-local, so the step must self-advance here).
  useEffect(() => { if (done) finish() }, [done, finish])

  // Keep the app root inert while the intro modal is up (same discipline as the
  // shipped onboarding modal), so the page behind is non-interactive.
  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (!appRoot) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [])

  if (done) return null

  const dismiss = () => { onboardingStore.markDone(); setDone(true); finish() }
  // Dismiss first (removes #root inert) and then open the Plugins section, so the
  // settings panel is not rendered inert behind this modal.
  const goSettings = () => { onboardingStore.markDone(); setDone(true); finish(); openSection('plugins') }
  const features = ['fullscreen', 'fold', 'navbar', 'autoFocus', 'hotkey']

  return (
    <Modal open title={t('onboarding.title')} onClose={dismiss} headless className="fm-onboard">
      <div className="fm-onboard-content">
        <h2 className="fm-onboard-title">{t('onboarding.title')}</h2>
        <p className="fm-onboard-intro">{t('onboarding.intro')}</p>
        <h3 className="fm-onboard-subtitle">{t('onboarding.features.title')}</h3>
        <ul className="fm-onboard-features">
          {features.map((f) => <li key={f}>{t('onboarding.feature.' + f)}</li>)}
        </ul>
        <h3 className="fm-onboard-subtitle">{t('onboarding.configure.title')}</h3>
        <FocusPrefsFields t={t} />
        <p className="fm-onboard-note">{t('onboarding.laterNote')}</p>
        <div className="fm-onboard-actions">
          <Button variant="outline" size="sm" onClick={goSettings}>{t('onboarding.openSettings')}</Button>
          <Button variant="primary" size="sm" onClick={dismiss}>{t('onboarding.done')}</Button>
        </div>
      </div>
    </Modal>
  )
}
