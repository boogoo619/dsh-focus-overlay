/**
 * The focus-mode bottom dock: the compact composer region that replaces the
 * old lone "jump to bottom" button at the bottom center of the overlay.
 *
 * Forms (mutually exclusive, decided by the pure `bottomForm` selector):
 * - `bar`      the compact input bar — the shared official draft, Enter sends
 * - `pill`     the collapsed affordance after a manual hide (blue dot = draft)
 * - `tobottom` the classic jump-to-bottom button
 * - `card`     the pending answer card (options / free text / approve-deny),
 *              opened in place from the waiting toast
 * (`toast` is decided here too, but rendered by the overlay's toast element.)
 *
 * The bar shares the MAIN composer's draft through the official per-session
 * input machine (`conversation.input.for(binding.ctx)`): setDraft / submit are
 * the same public action face every session-scope component gets, so whatever
 * the user typed before entering focus mode is already here, and whatever they
 * type here is still in the main composer after leaving — one draft, both
 * views, persisted by the host like always. When the input service is absent
 * (older dsh), the bar degrades to a plugin-local draft sent through the
 * session face's `prompt` verb — the same wire call the official default sink
 * makes.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject, ChangeEvent as ReactChangeEvent, CompositionEvent as ReactCompositionEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Button, IconCheckOutline14, IconChevronDownOutline14, IconEditOutline16, IconSendOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from './locales'
import { allAnswered, encodeAnswer, parseRecommendedLabel, type AnswerDraft } from './model'

// ---- the official per-session input machine (shared-draft path) ----

/** Resolve the per-session input facade for a session's agent scope. Returns
 *  null when the conversation service (or its input registry) is absent so the
 *  caller can fall back to a plugin-local draft. Pure resolution, memoized per
 *  binding — the registry hands back the same stable facade every time. */
export function useInputFace(conversation: any, actx: any): any {
  return useMemo(() => {
    try {
      if (conversation && conversation.input && actx) return conversation.input.for(actx)
    } catch { /* degrade to the local-draft path */ }
    return null
  }, [conversation, actx])
}

/** Subscribe to the input machine's published state (draft, queue, reference
 *  occurrences). Mirrors the overlay's session-snapshot hook: read once, then
 *  re-read on every store flush. */
export function useInputState(input: any): any {
  const [snap, setSnap] = useState<any>(() => {
    try { return input && input.state ? input.state.getSnapshot() : null } catch { return null }
  })
  useEffect(() => {
    if (!input || !input.state) { setSnap(null); return }
    try {
      setSnap(input.state.getSnapshot())
      return input.state.subscribe(() => setSnap(input.state.getSnapshot()))
    } catch { return }
  }, [input])
  return snap
}

// ---- the answer card (question / approval takeover) ----

function OptionRow(props: {
  t: FocusTranslate
  index: number
  label: string
  description?: string
  multi: boolean
  on: boolean
  onToggle: () => void
}) {
  const { t, index, label, description, multi, on, onToggle } = props
  const parsed = parseRecommendedLabel(label)
  // Mirrors the official QuestionComposer row: single-select numbers its
  // options (1/2/3…), multi-select uses a checkbox; hover/selected tint with
  // the interactive-hover token and the "Recommended" suffix becomes a badge.
  return (
    <button type="button" className={'fm-opt' + (on ? ' fm-opt-on' : '')} onClick={onToggle} aria-pressed={on}>
      {multi ? (
        <span className={'fm-opt-check' + (on ? ' fm-opt-check-on' : '')}>{on ? <IconCheckOutline14 /> : null}</span>
      ) : (
        <span className="fm-opt-num">{index + 1}</span>
      )}
      <span className="fm-opt-copy">
        <span className="fm-opt-line">
          <span className="fm-opt-label">{parsed.label}</span>
          {parsed.recommended ? <span className="fm-opt-badge">{t('answer.recommended')}</span> : null}
        </span>
        {description ? <span className="fm-opt-desc">{description}</span> : null}
      </span>
    </button>
  )
}

function AnswerCard(props: {
  t: FocusTranslate
  width: number
  wait: any
  onClose: () => void
}) {
  const { t, width, wait, onClose } = props
  // dsh 0.1.2 pending-interaction carriers: PendingQuestion (`kind` is
  // 'question' or 'plan-review', questions on `wait.questions`, answers via
  // `wait.answer({ answers })`) and PendingApproval (`kind: 'approval'`,
  // toolName/reason on the carrier, decisions via `wait.answer(outcome)`).
  const isApproval = wait.kind === 'approval'
  const isQuestion = !isApproval
  const questions: any[] = isQuestion && Array.isArray(wait.questions) ? wait.questions : []
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = (id: string, next: Partial<AnswerDraft>) => setDrafts((prev) => {
    const cur = prev[id] || { selected: [], custom: '' }
    return { ...prev, [id]: { ...cur, ...next } }
  })
  const toggle = (qid: string, multi: boolean, label: string) => setDrafts((prev) => {
    const cur = prev[qid] || { selected: [], custom: '' }
    if (multi) {
      // Multi-select toggles membership; custom may accompany it on the wire.
      const selected = cur.selected.includes(label) ? cur.selected.filter((l) => l !== label) : [...cur.selected, label]
      return { ...prev, [qid]: { ...cur, selected } }
    }
    // Single-select mirrors the official choose(): picking an option always
    // sets it (never toggles off) and supersedes the custom text — the wire
    // carries either the option or the custom answer, never both.
    return { ...prev, [qid]: { selected: [label], custom: '' } }
  })

  // One carrier, one receipt: `wait.answer()` resolves the Host waterfall
  // directly (dsh 0.1.2 replaced the old respond() envelope; the legacy
  // adapter shims respond() behind the same answer face and rejects with a
  // `rejected` marker when the old receipt says the answer was refused).
  // Success needs no local state — the interaction leaves the pending map,
  // the form flips, and this card unmounts. A rejection or transport failure
  // stays on the card with `busy` released.
  const respond = async (p: Promise<any>) => {
    setBusy(true)
    setError(null)
    try {
      const receipt = await p
      if (receipt && receipt.accepted === false) {
        setError(t('answer.rejected') + (receipt.reason ? `: ${receipt.reason}` : ''))
        setBusy(false)
      }
    } catch (err) {
      const rej = err as any
      setError(rej && rej.rejected
        ? t('answer.rejected') + (rej.reason ? `: ${rej.reason}` : '')
        : (err instanceof Error ? err.message : String(err)))
      setBusy(false)
    }
  }
  const submitAnswers = () => {
    if (!allAnswered(questions, drafts)) { setError(t('answer.incomplete')); return }
    respond(wait.answer(encodeAnswer(questions, drafts)))
  }
  const decide = (outcome: 'allowed-once' | 'rejected') =>
    respond(wait.answer(outcome))

  return (
    // Official card language: a question takes the QuestionComposer shape
    // (eyebrow + title header), an approval takes the PlanReviewPanel shape
    // (warn strip). Both share the input-major card, 20px radius, shadow-lv2.
    <div className={'fm-card' + (isQuestion ? '' : ' fm-card-approval')} style={{ maxWidth: Math.min(width, 748) }}>
      {isQuestion ? (
        <div className="fm-card-head">
          <div className="fm-card-heading">
            <p className="fm-card-eyebrow">{t('reply.waiting')}</p>
            <h3 className="fm-card-title">{t('answer.title')}</h3>
          </div>
          <button type="button" className="fm-card-close" title={t('answer.close')} aria-label={t('answer.close')} onClick={onClose}>
            <IconChevronDownOutline14 />
          </button>
        </div>
      ) : (
        <div className="fm-card-head">
          <span className="fm-card-dot" />
          <span className="fm-card-strip-title">{t('answer.approvalTitle')}</span>
          <button type="button" className="fm-card-close" title={t('answer.close')} aria-label={t('answer.close')} onClick={onClose}>
            <IconChevronDownOutline14 />
          </button>
        </div>
      )}
      <div className="fm-card-body">
        {isQuestion ? questions.map((q, i) => {
          const d = drafts[q.id] || { selected: [], custom: '' }
          return (
            <div key={q.id} className="fm-card-q">
              <div className="fm-card-q-text">
                {questions.length > 1 ? `${i + 1}. ` : ''}{q.question}
              </div>
              {q.detail ? <div className="fm-card-detail">{q.detail}</div> : null}
              {q.options && q.options.length ? (
                <div className="fm-card-opts" role={q.multiSelect ? 'group' : 'radiogroup'}>
                  {q.options.map((o: any, oi: number) => (
                    <OptionRow
                      key={o.label}
                      t={t}
                      index={oi}
                      label={o.label}
                      description={o.description}
                      multi={!!q.multiSelect}
                      on={d.selected.includes(o.label)}
                      onToggle={() => toggle(q.id, !!q.multiSelect, o.label)}
                    />
                  ))}
                </div>
              ) : null}
              <div className="fm-card-custom">
                <input
                  className="fm-card-field"
                  type="text"
                  value={d.custom}
                  placeholder={t('answer.custom')}
                  onChange={(e) => patch(q.id, { custom: e.target.value })}
                />
              </div>
            </div>
          )
        }) : (
          <div className="fm-card-q">
            {wait.reason ? <div className="fm-card-q-text">{wait.reason}</div> : null}
            {wait.toolName ? (
              <div className="fm-card-detail">{wait.toolName}</div>
            ) : null}
          </div>
        )}
      </div>
      <div className="fm-card-foot">
        <span className="fm-card-err">{error}</span>
        <div className="fm-card-actions">
          {isQuestion ? (
            // Enabled while incomplete on purpose: the click surfaces the
            // "answer every question" error instead of a mute disabled button.
            <Button variant="primary" size="sm" disabled={busy} onClick={submitAnswers}>
              {t('answer.submit')}
            </Button>
          ) : (
            <>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => decide('allowed-once')}>{t('answer.allow')}</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => decide('rejected')}>{t('answer.reject')}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- the compact input bar ----

function InputBar(props: {
  t: FocusTranslate
  width: number
  value: string
  queueCount: number
  occCount: number
  errorLine: string | null
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  onFocusChange: (focused: boolean) => void
  onChange: (v: string) => void
  onSend: () => void
}) {
  const { t, width, value, queueCount, occCount, errorLine, textareaRef, onFocusChange, onChange, onSend } = props

  // ---- IME composition shield ----
  // An IME composition needs UNBROKEN focus on this textarea. But every
  // shared-draft echo (onChange → inputFace.setDraft) makes the main composer's
  // hidden Lexical editor commit a discrete selection update that steals DOM
  // focus — killing the composition session outright (the candidate window
  // vanishes and only raw latin reaches the draft). So while composing, edits
  // stay in a local override and are NOT echoed to the store; the whole final
  // text is flushed once on compositionend (or on send/blur safety flushes).
  const composingRef = useRef(false)
  const [pending, setPending] = useState<string | null>(null)
  const shown = pending ?? value
  const empty = shown.trim() === ''

  const flush = (v: string | null) => {
    if (v === null) return
    setPending(null)
    onChange(v)
  }
  const onCompositionStart = () => {
    composingRef.current = true
    setPending(value)
  }
  const onCompositionEnd = (e: ReactCompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false
    // Chrome fires the final input/onChange BEFORE compositionend; e.target
    // carries the committed text either way.
    flush(e.currentTarget.value)
    // The flush echoes to the shared draft, whose Lexical commit steals focus
    // again — the Enter/space that confirmed the candidate would otherwise end
    // in a blur and fold the bar. Restore focus/caret right after the echo.
    refocusAfterEcho(e.currentTarget)
  }

  // Enter sends (queue delivery, the official default busy-Enter behavior);
  // Shift+Enter newlines. Never send mid-IME composition — the keydown is the
  // composer's own, so no window-level guards apply here. Safari reports the
  // composition-committing key with isComposing=false + keyCode 229, so the
  // official guard checks both.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing && (e.nativeEvent as any).keyCode !== 229) {
      e.preventDefault()
      if (!empty) onSend()
    }
  }
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }
  // The shared-draft path (onChange → inputFace.setDraft) rewrites the MAIN
  // composer's Lexical editor. Its discrete commit also moves the DOM text
  // selection into that hidden editor, which BLURS this textarea — so the very
  // first keystroke folded the bar into the pill (blur = collapse via
  // bottomForm). After each echo, restore the caret here if the editor stole
  // it: blur→focus fire inside this one handler, so the dock's focused flag
  // never observes the theft and the bar stays up while the user types.
  // (Mid-IM-composition there is no echo at all — see the composition shield —
  // so focus is never stolen while the candidate window is open.)
  const refocusAfterEcho = (el: HTMLTextAreaElement) => {
    if (document.activeElement === el) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }
  // Re-fit on every value change, not just local edits: the shared draft can
  // arrive pre-filled (typed in the main composer before entering focus mode),
  // and the textarea must size to it without a keystroke.
  useEffect(() => {
    if (textareaRef.current) autoGrow(textareaRef.current)
  }, [shown, textareaRef])

  const handleInput = (e: ReactChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target
    if (composingRef.current) {
      // Composing: shadow the value locally only — the store echo would kill
      // the composition (see the shield note above).
      setPending(el.value)
    } else {
      // Plain typing: echo through; the override must clear so later external
      // draft changes (seed, send-clear) are not shadowed by stale text.
      setPending(null)
      onChange(el.value)
    }
    autoGrow(el)
    refocusAfterEcho(el)
  }

  return (
    // Official InputBar card language: input-major surface, 22px radius,
    // shadow-lv2, 16/24 textarea, and the 34px round info-fill send button
    // with the official up-arrow glyph (IconSendOutline14). No collapse
    // button: a draft-bearing bar folds itself into the pill on blur — the
    // send button swallows its own mousedown so a click never blurs first.
    <div className="fm-bar" style={{ maxWidth: Math.min(width, 680) }}>
      {errorLine ? <div className="fm-bar-note fm-bar-note-error">{errorLine}</div> : null}
      {occCount > 0 ? <div className="fm-bar-note">{t('composer.occurrences')}</div> : null}
      <div className="fm-bar-row">
        <textarea
          ref={textareaRef}
          className="fm-bar-text"
          rows={1}
          value={shown}
          placeholder={t('composer.placeholder')}
          onChange={handleInput}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onKeyDown={onKeyDown}
          onFocus={() => onFocusChange(true)}
          onBlur={() => {
            if (composingRef.current) {
              // Focus stolen mid-composition (echo timing raced the IME): the
              // pending text must not be lost — flush it and take the focus
              // back, or the theft would both eat the draft and fold the bar.
              composingRef.current = false
              flush(shown)
              if (textareaRef.current) refocusAfterEcho(textareaRef.current)
            }
            onFocusChange(false)
          }}
        />
        {queueCount > 0 ? <span className="fm-bar-queue">{t('composer.queued', { n: queueCount })}</span> : null}
        <button
          type="button"
          className="fm-bar-send"
          title={t('composer.send')}
          aria-label={t('composer.send')}
          disabled={empty}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onSend}
        >
          <IconSendOutline14 />
        </button>
      </div>
    </div>
  )
}

// ---- the dock: one switch, one form ----

export function FocusBottomDock(props: {
  t: FocusTranslate
  width: number
  form: 'card' | 'toast' | 'bar' | 'pill' | 'tobottom'
  wait: any
  onCardClose: () => void
  draft: string
  queueCount: number
  occCount: number
  errorLine: string | null
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  onFocusChange: (focused: boolean) => void
  onDraftChange: (v: string) => void
  onSend: () => void
  onExpand: () => void
  onJumpBottom: () => void
}) {
  const { t, width, form, wait, onCardClose, draft, queueCount, occCount, errorLine, textareaRef, onFocusChange, onDraftChange, onSend, onExpand, onJumpBottom } = props
  if (form === 'toast') return null // the overlay's waiting toast owns this moment
  if (form === 'card') return <AnswerCard t={t} width={width} wait={wait} onClose={onCardClose} />
  if (form === 'bar') {
    return (
      <InputBar
        t={t}
        width={width}
        value={draft}
        queueCount={queueCount}
        occCount={occCount}
        errorLine={errorLine}
        textareaRef={textareaRef}
        onFocusChange={onFocusChange}
        onChange={onDraftChange}
        onSend={onSend}
      />
    )
  }
  if (form === 'pill') {
    const hasDraft = draft.trim() !== ''
    return (
      <button type="button" className="fm-pill" title={t('composer.expand')} aria-label={t('composer.expand')} onClick={onExpand}>
        <IconEditOutline16 />
        {hasDraft ? <span className="fm-pill-dot" /> : null}
      </button>
    )
  }
  // The jump-to-bottom button shares the pill's official circular-button
  // look (input-major surface, shadow-lv2) — one visual family for every
  // collapsed dock form; only the glyph differs.
  return (
    <button type="button" className="fm-pill" title={t('backToLatest')} aria-label={t('backToLatest')} onClick={onJumpBottom}>
      <IconChevronDownOutline14 size={16} />
    </button>
  )
}
