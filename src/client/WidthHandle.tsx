/**
 * WidthHandle — a 1:1 replica of the official dsh-client-ui-conversation
 * transcript width handle (the drag strip beside the content column), rebuilt
 * for the focus overlay because the official component is internal to the
 * conversation module and not reachable through any runtime module id.
 *
 * Interaction model mirrors the official `WidthHandle` exactly:
 * - pointer capture on the strip; both sides write the ONE centered width, so
 *   outward travel widens by 2× the pointer distance;
 * - rAF-throttled drag updates (live resize while the pointer moves);
 * - pointermove publishes the pointer's Y as a CSS variable so the glow
 *   indicator rides it (48px falloff gradient, 3px core line);
 * - commit on release (only when the pointer actually moved), cancel on
 *   pointer cancel / lost capture.
 *
 * Clamping constants mirror the official `resolveContentWidth`: a 640px floor
 * and a 176px edge budget per viewport (88px per side keeps the handles
 * placeable — a wider column would push its own handles off-screen).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { injectStyle } from './styles'

/** Floor for a dragged content width; matches the official layout minimum. */
const CONTENT_MIN = 640
/** Column budget the content must leave free (88px per side). */
const CONTENT_EDGE_BUDGET = 176

const HANDLE_CSS = `
.fm-width-handles{position:absolute;top:0;bottom:0;left:0;right:0;pointer-events:none}
.fm-width-handle{z-index:8;width:min(40px,calc((100% - var(--fm-content-width,748px)) / 2 - 24px - 24px));cursor:col-resize;pointer-events:auto;position:absolute;top:0;bottom:0}
.fm-width-handle[data-side=left]{right:calc(50% + var(--fm-content-width,748px) / 2 + 24px)}
.fm-width-handle[data-side=right]{left:calc(50% + var(--fm-content-width,748px) / 2 + 24px)}
.fm-width-handle:after{content:"";background:linear-gradient(to bottom,transparent calc(var(--dsh-width-handle-pointer-y,50%) - 52px),var(--dsw-alias-scrollbar-hover-l1,rgba(0,0,0,.18)) calc(var(--dsh-width-handle-pointer-y,50%) - 12px),var(--dsw-alias-scrollbar-hover-l1,rgba(0,0,0,.18)) calc(var(--dsh-width-handle-pointer-y,50%) + 12px),transparent calc(var(--dsh-width-handle-pointer-y,50%) + 52px));opacity:0;pointer-events:none;border-radius:3px;width:3px;position:absolute;top:0;bottom:0}
.fm-width-handle[data-side=left]:after{right:16px}
.fm-width-handle[data-side=right]:after{left:16px}
.fm-width-handle:hover:after,.fm-width-handle[data-dragging]:after{opacity:1}
@media (prefers-reduced-motion:reduce){.fm-width-handle:after{transition:none}}
`

// Style injection goes through the shared injectStyle helper (styles.ts):
// deduped by id, disposed by the component's effect cleanup on unmount.

function WidthHandle(props: {
  side: 'left' | 'right'
  width: number
  onStart: () => number
  onDrag: (width: number) => void
  onCommit: (width: number) => void
  onEnd: () => void
}) {
  const [dragging, setDragging] = useState<boolean>(false)
  const base = useRef<number>(0)
  const origin = useRef<number>(0)
  const latest = useRef<number>(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props
  const outwardWidth = () => {
    const dx = latest.current - origin.current
    const outward = callbacks.current.side === 'right' ? dx : -dx
    return base.current + outward * 2
  }
  const cancelFrame = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    base.current = callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--dsh-width-handle-pointer-y', `${e.clientY - box.top}px`)
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(outwardWidth())
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    cancelFrame()
    latest.current = e.clientX
    if (latest.current !== origin.current) callbacks.current.onCommit(outwardWidth())
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  const onPointerCancel = useCallback(() => {
    cancelFrame()
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  return (
    <div
      className="fm-width-handle"
      data-side={props.side}
      data-dragging={dragging || undefined}
      style={{ '--fm-content-width': `${props.width}px` } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    />
  )
}

export function WidthHandles(props: {
  width: number
  onStart: () => number
  onDrag: (width: number) => void
  onCommit: (width: number) => void
  onEnd: () => void
}) {
  useEffect(() => injectStyle('fm-width-handle', HANDLE_CSS), [])
  return (
    <div className="fm-width-handles">
      <WidthHandle {...props} side="left" />
      <WidthHandle {...props} side="right" />
    </div>
  )
}

export { CONTENT_MIN, CONTENT_EDGE_BUDGET }
