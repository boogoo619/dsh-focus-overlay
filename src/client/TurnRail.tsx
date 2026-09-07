/**
 * TurnRail — a 1:1 replica of the official dsh-client-ui-chat TurnNavigator
 * (the conversation view's right-side turn rail), rebuilt for the focus
 * overlay because the official component is internal to the chat view module
 * and not reachable through any runtime module id. Markup, geometry, styling,
 * and motion mirror the official `TurnNavigator.module.css` + `TurnNavigator.js`:
 *
 * - fixed pitch between marks (TURN_SPACING_PX), rail insets, 24px scroll
 *   fade bands via mask-image gradients at each scrollable end;
 * - the frame is vertically centered over the reading band, its height
 *   clamped to `min(natural, band - 64px, 420px)` like the official frame;
 * - a hover/focus preview card (1-line prompt + 3-line response) that maps
 *   the pointer's Y to the nearest mark — including while the inner scroller
 *   has scrolled — and clamps itself inside the rail band;
 * - the active mark keeps itself in view while the pointer is elsewhere;
 * - enter/pulse keyframes and the prefers-reduced-motion opt-out.
 *
 * Differences imposed by the overlay context: every mark is "loaded" (the
 * overlay pages the full history in on open, so there are no unloaded marks
 * to render), and navigation scrolls the overlay's own scrollport instead of
 * the conversation view's DOM anchor.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { injectStyle } from './styles'

/** One rail mark: the overlay's projection of one official TurnRailItem. */
export interface RailItem {
  /** Turn number (official `TurnRailItem.turn`). */
  turn: number
  /** Bounded prompt preview (official `TurnRailItem.prompt`). */
  prompt: string
  /** Bounded response preview (official `TurnRailItem.response`). */
  response: string
  /** The overlay scroll target: focus-item index behind this turn's anchor. */
  idx: number
}

/** Fixed pitch between neighbouring marks; overflow scrolls inside the frame. */
const TURN_SPACING_PX = 10
/** Rail padding above the first mark and below the last one, per end. */
const RAIL_INSET_PX = 6
/** Fade band the mask reserves at a scrollable end. */
const FADE_PX = 24

const RAIL_CSS = `
.fm-rail-slot{position:absolute;inset:0;pointer-events:none;z-index:2}
.fm-rail{--turn-rail-band:calc(var(--dsh-conversation-viewport-height,100dvh) - var(--dsh-composer-height,152px));--turn-preview-height:100px;top:calc(var(--turn-rail-band) / 2);right:12px;width:28px;height:min(var(--turn-natural-height),max(0px,calc(var(--turn-rail-band) - 64px)),420px);cursor:pointer;pointer-events:auto;transition:height .22s cubic-bezier(.2,.8,.2,1);position:absolute;transform:translateY(-50%)}
.fm-rail-scroller{overscroll-behavior:contain;scrollbar-width:none;position:absolute;inset:0;overflow-y:auto}
.fm-rail-scroller::-webkit-scrollbar{display:none}
.fm-rail-fade-top{mask-image:linear-gradient(#0000 0,#000 24px 100%)}
.fm-rail-fade-bottom{mask-image:linear-gradient(#000 0 calc(100% - 24px),#0000 100%)}
.fm-rail-fade-top.fm-rail-fade-bottom{mask-image:linear-gradient(#0000 0,#000 24px calc(100% - 24px),#0000 100%)}
.fm-rail-marks{height:var(--turn-natural-height);position:relative}
.fm-rail-mark-position{top:calc(var(--turn-natural-position) + var(--turn-rail-inset));height:10px;transition:top .22s cubic-bezier(.2,.8,.2,1);animation:.15s ease-out fm-turn-mark-enter;position:absolute;left:0;right:0;transform:translateY(-50%)}
.fm-rail-mark{cursor:pointer;pointer-events:none;background:0 0;border:0;border-radius:8px;width:20px;padding:0;position:absolute;inset:0 0 0 auto}
.fm-rail-mark:before{background:var(--dsw-alias-border-l4);content:"";border-radius:2px;width:12px;height:2px;transition:width .14s,background-color .14s;position:absolute;top:50%;right:0;transform:translateY(-50%)}
.fm-rail-mark-preview:before{background:var(--dsw-alias-label-tertiary);width:18px}
.fm-rail-mark-active:before{background:var(--dsw-alias-label-primary);width:20px}
.fm-rail-mark:focus-visible:before{background:var(--dsw-alias-state-business-primary);width:20px}
.fm-rail-mark:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.fm-rail-preview{top:clamp(0px,calc(var(--turn-natural-position) + var(--turn-rail-inset) - var(--turn-scroll-top,0px) - var(--turn-preview-height) / 2),calc(100% - var(--turn-preview-height)));box-sizing:border-box;width:min(300px,100cqw - 120px);max-height:var(--turn-preview-height);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel,0 4px 16px rgba(0,0,0,.12));pointer-events:none;border:0;border-radius:10px;padding:10px 12px;transition:top .14s cubic-bezier(.2,.8,.2,1);animation:.12s ease-out fm-turn-preview-enter;position:absolute;right:calc(100% + 10px);overflow:hidden}
.fm-rail-preview-prompt,.fm-rail-preview-response{-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}
.fm-rail-preview-prompt{font:var(--dsw-font-xs-strong-13,600 13px/18px var(--dsw-font-family,sans-serif));-webkit-line-clamp:1}
.fm-rail-preview-response{color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxs-12,400 12px/18px var(--dsw-font-family,sans-serif));-webkit-line-clamp:3;margin-top:4px}
@keyframes fm-turn-mark-enter{0%{opacity:0}to{opacity:1}}
@keyframes fm-turn-preview-enter{0%{opacity:0;transform:translate(4px)}to{opacity:1;transform:translate(0)}}
@media (prefers-reduced-motion:reduce){.fm-rail,.fm-rail-scroller,.fm-rail-mark-position,.fm-rail-mark:before,.fm-rail-preview{scroll-behavior:auto;transition:none;animation:none}}
`

// Style injection goes through the shared injectStyle helper (styles.ts):
// deduped by id, disposed by the component's effect cleanup on unmount.

function itemPosition(index: number): Record<string, string> {
  return { '--turn-natural-position': `${index * TURN_SPACING_PX}px` }
}
function frameStyle(count: number, scrollTop: number): Record<string, string> {
  return {
    '--turn-natural-height': `${(count - 1) * TURN_SPACING_PX + 2 * RAIL_INSET_PX}px`,
    '--turn-rail-inset': `${RAIL_INSET_PX}px`,
    '--turn-scroll-top': `${scrollTop}px`,
  }
}
function itemAtPointer(items: RailItem[], frame: HTMLElement, scrollTop: number, clientY: number): RailItem | undefined {
  const offset = clientY - frame.getBoundingClientRect().top + scrollTop - RAIL_INSET_PX
  return items[Math.max(0, Math.min(items.length - 1, Math.round(offset / TURN_SPACING_PX)))]
}

interface RailScrollState { top: number; canScrollUp: boolean; canScrollDown: boolean }
const RAIL_AT_REST: RailScrollState = { top: 0, canScrollUp: false, canScrollDown: false }
function railScrollState(scroller: HTMLElement): RailScrollState {
  const top = scroller.scrollTop
  return { top, canScrollUp: top > 1, canScrollDown: top < scroller.scrollHeight - scroller.clientHeight - 1 }
}
function sameRailScrollState(left: RailScrollState, right: RailScrollState): boolean {
  return left.top === right.top && left.canScrollUp === right.canScrollUp && left.canScrollDown === right.canScrollDown
}

export function TurnRail(props: {
  items: RailItem[]
  activeTurn: number | null
  onNavigate: (item: RailItem) => void
  label: string
  jumpLabel: (turn: number) => string
  turnLabel: (turn: number) => string
}) {
  const { items, activeTurn, onNavigate, label, jumpLabel, turnLabel } = props
  const [previewTurn, setPreviewTurn] = useState<number | null>(null)
  const [scrollState, setScrollState] = useState<RailScrollState>(RAIL_AT_REST)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  // While the pointer works the rail, follow must not move it under the hand.
  const pointerInsideRef = useRef<boolean>(false)
  const previewId = useId()

  useEffect(() => injectStyle('fm-turn-rail', RAIL_CSS), [])

  const syncScrollState = () => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const next = railScrollState(scroller)
    setScrollState((current) => sameRailScrollState(current, next) ? current : next)
  }
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncScrollState)
    observer.observe(scroller)
    return () => { observer.disconnect() }
  }, [])
  useEffect(() => { syncScrollState() }, [items.length])
  useEffect(() => {
    const scroller = scrollerRef.current
    const index = items.findIndex((item) => item.turn === activeTurn)
    if (scroller === null || index < 0 || pointerInsideRef.current) return
    const markTop = index * TURN_SPACING_PX + RAIL_INSET_PX
    const viewTop = scroller.scrollTop
    const viewHeight = scroller.clientHeight
    if (viewHeight <= 0 || (markTop >= viewTop + FADE_PX && markTop <= viewTop + viewHeight - FADE_PX)) return
    const target = Math.max(0, markTop - viewHeight / 2)
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' })
    else scroller.scrollTop = target
    syncScrollState()
  }, [activeTurn, items])

  if (items.length < 2) return null
  const previewIndex = items.findIndex((item) => item.turn === previewTurn)
  const preview = previewIndex < 0 ? undefined : items[previewIndex]
  const previewPosition = previewIndex < 0 ? undefined : itemPosition(previewIndex)
  const previewAtPointer = (event: React.PointerEvent<HTMLElement>) => {
    const scrollTop = scrollerRef.current ? scrollerRef.current.scrollTop : 0
    const item = itemAtPointer(items, event.currentTarget, scrollTop, event.clientY)
    setPreviewTurn(item ? item.turn : null)
  }
  const navigateAtPointer = (event: React.MouseEvent<HTMLElement>) => {
    const scrollTop = scrollerRef.current ? scrollerRef.current.scrollTop : 0
    const item = itemAtPointer(items, event.currentTarget, scrollTop, event.clientY)
    if (item !== undefined) onNavigate(item)
  }
  const fadeClasses = ['fm-rail-scroller']
  if (scrollState.canScrollUp) fadeClasses.push('fm-rail-fade-top')
  if (scrollState.canScrollDown) fadeClasses.push('fm-rail-fade-bottom')
  return (
    <div className="fm-rail-slot">
      <nav
        className="fm-rail"
        style={frameStyle(items.length, scrollState.top)}
        aria-label={label}
        onClick={navigateAtPointer}
        onPointerMove={previewAtPointer}
        onPointerEnter={() => { pointerInsideRef.current = true }}
        onPointerLeave={() => { pointerInsideRef.current = false; setPreviewTurn(null) }}
      >
        <div
          ref={scrollerRef}
          className={fadeClasses.join(' ')}
          onScroll={() => { syncScrollState() }}
        >
          <div className="fm-rail-marks">
            {items.map((item, index) => {
              const active = item.turn === activeTurn
              const showingPreview = item.turn === previewTurn
              const classes = ['fm-rail-mark']
              if (active) classes.push('fm-rail-mark-active')
              else if (showingPreview) classes.push('fm-rail-mark-preview')
              return (
                <div key={item.turn} className="fm-rail-mark-position" style={itemPosition(index)}>
                  <button
                    type="button"
                    className={classes.join(' ')}
                    aria-label={jumpLabel(item.turn)}
                    aria-current={active ? 'true' : undefined}
                    aria-describedby={showingPreview ? previewId : undefined}
                    onClick={(event) => { event.stopPropagation(); onNavigate(item) }}
                    onFocus={() => { setPreviewTurn(item.turn) }}
                    onBlur={() => { setPreviewTurn(null) }}
                  />
                </div>
              )
            })}
          </div>
        </div>
        {preview !== undefined && previewPosition !== undefined ? (
          <div id={previewId} role="tooltip" className="fm-rail-preview" style={previewPosition}>
            <div className="fm-rail-preview-prompt">{preview.prompt || turnLabel(preview.turn)}</div>
            {preview.response !== '' ? <div className="fm-rail-preview-response">{preview.response}</div> : null}
          </div>
        ) : null}
      </nav>
    </div>
  )
}
