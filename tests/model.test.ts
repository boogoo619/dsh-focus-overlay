import { describe, it, expect } from 'vitest'
import {
  flattenText,
  hasAssistantContent,
  addMetric,
  summarySegments,
  processLabel,
  buildItems,
  findSeqIndex,
  resolveAnchorSeq,
  lastUserSeq,
  lastUserIndex,
  lastPromptSeq,
  detectSettledCompletion,
  hasPendingInteraction,
  legacySliceOf,
  pendingInteractionOf,
  legacyPendingOf,
  onboardingSeen,
  hotkeyShouldEnter,
  decideOpenScroll,
} from '../src/client/model'

// Minimal translate stub: renders the key plus the interpolated `n` so tests
// can assert on metric classification without depending on real dictionaries.
const t = (key: string, params?: Record<string, unknown>) => {
  const n = params && typeof params.n === 'number' ? params.n : null
  return n === null ? key : `${key}:${n}`
}

describe('flattenText', () => {
  it('concatenates text blocks and ignores non-text/empty', () => {
    expect(flattenText([
      { type: 'text', text: 'a' },
      { type: 'image', text: 'b' },
      { type: 'text', text: 'c' },
      null,
    ])).toBe('ac')
  })
  it('returns empty string for missing/empty content', () => {
    expect(flattenText([])).toBe('')
    expect(flattenText(undefined)).toBe('')
  })
})

describe('hasAssistantContent', () => {
  it('detects text and image blocks', () => {
    expect(hasAssistantContent([{ kind: 'text', text: 'x' }])).toBe(true)
    expect(hasAssistantContent([{ kind: 'image', attachment: {} }])).toBe(true)
  })
  it('ignores reasoning/tool-call and empty blocks', () => {
    expect(hasAssistantContent([{ kind: 'reasoning', text: 'x' }])).toBe(false)
    expect(hasAssistantContent([])).toBe(false)
  })
})

describe('summarySegments', () => {
  it('classifies by tool name and orders by metric family', () => {
    const m: Record<string, number> = {}
    addMetric(m, 'bash')
    addMetric(m, 'bash')
    addMetric(m, 'edit')
    addMetric(m, 'read')
    addMetric(m, 'unknown-tool')
    expect(summarySegments(t, m)).toEqual([
      'sum.commands:2',
      'sum.edits:1',
      'sum.files:1',
      'sum.others:1',
    ])
  })
  it('renders todos/goals without a count', () => {
    expect(summarySegments(t, { todos: 3, goals: 1 })).toEqual(['sum.todos', 'sum.goals'])
  })
})

describe('buildItems', () => {
  const nodes = [
    { kind: 'user', seq: 1, content: [{ type: 'text', text: 'hi' }] },
    { kind: 'tool-result', seq: 2, call: { name: 'bash' } },
    { kind: 'assistant', seq: 3, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'intermediate note' }] },
    { kind: 'tool-result', seq: 4, call: { name: 'read' } },
    { kind: 'assistant', seq: 5, turn: 1, step: 2, blocks: [{ kind: 'text', text: 'final answer' }] },
    { kind: 'user', seq: 6, content: [{ type: 'text', text: 'next' }] },
    { kind: 'assistant', seq: 7, turn: 2, step: 1, blocks: [{ kind: 'text', text: 'second answer' }] },
  ]

  it('normal mode keeps the classic per-segment metric folding', () => {
    const items = buildItems(nodes, [], t, 'normal')
    expect(items.map((i) => i.kind)).toEqual(['user', 'hidden', 'assistant', 'hidden', 'assistant', 'user', 'assistant'])
    expect((items[1] as { text: string }).text).toContain('sum.commands:1')
  })

  it('compact mode folds each turn into work part + conclusion', () => {
    const items = buildItems(nodes, [], t, 'compact')
    expect(items.map((i) => i.kind)).toEqual(['user', 'turnProcess', 'assistant', 'user', 'assistant'])
    const seg = items[1] as { kind: 'turnProcess'; collapsed: boolean; workItems: any[] }
    expect(seg.collapsed).toBe(true)
    // work part: tool calls folded (hidden) + intermediate assistant text,
    // but NOT the closing answer
    expect(seg.workItems.map((w) => w.kind)).toEqual(['hidden', 'assistant', 'hidden'])
    expect((seg.workItems[1] as { text?: string; blocks?: any[] }).blocks?.[0].text).toBe('intermediate note')
    // conclusion: the last content assistant of the turn
    expect((items[2] as { blocks: any[] }).blocks[0].text).toBe('final answer')
  })

  it('compact counts reflect the work part', () => {
    const items = buildItems(nodes, [], t, 'compact')
    const seg = items[1] as { counts: { tools: number; messages: number } }
    expect(seg.counts.tools).toBe(2)
    expect(seg.counts.messages).toBe(1)
  })

  it('leaves the streaming tail unfolded while unstable (normal form)', () => {
    const open = nodes.slice(0, 5) // last turn, tail still streaming
    const items = buildItems(open, [], t, 'compact', false)
    expect(items.map((i) => i.kind)).toEqual(['user', 'hidden', 'assistant', 'hidden', 'assistant'])
  })

  it('folds the last turn once the snapshot is stable', () => {
    const open = nodes.slice(0, 5) // same nodes, reply settled (partial drained)
    const items = buildItems(open, [], t, 'compact', true)
    expect(items.map((i) => i.kind)).toEqual(['user', 'turnProcess', 'assistant'])
  })

  it('skips empty user and non-content assistant nodes', () => {
    const ns = [
      { kind: 'user', seq: 1, content: [{ type: 'image' }] },
      { kind: 'assistant', seq: 2, turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'think' }] },
    ]
    expect(buildItems(ns, [], t)).toEqual([])
  })

  it('emits an error item for turn-error', () => {
    const items = buildItems([{ kind: 'turn-error', seq: 1, message: 'boom' }], [], t)
    expect(items).toEqual([{ kind: 'error', text: 'boom' }])
  })

  it('accounts for running tool calls', () => {
    const items = buildItems([], [{ name: 'bash' }, { name: 'bash' }], t)
    expect(items).toHaveLength(1)
    expect((items[0] as { text: string }).text).toBe('sum.commands:2')
  })
})

describe('findSeqIndex', () => {
  const items = [
    { kind: 'user', text: 'a', seq: 10 },
    { kind: 'steering', text: 'b', seq: 20 },
    { kind: 'process', collapsed: true, counts: { tools: 0, messages: 0, subagents: 0 }, rows: [] },
  ] as any
  it('finds user/steering by seq', () => {
    expect(findSeqIndex(items, 20)).toBe(1)
  })
  it('returns -1 when not found', () => {
    expect(findSeqIndex(items, 999)).toBe(-1)
  })
})

describe('resolveAnchorSeq', () => {
  it('resolves seq from the chat node store', () => {
    const chat = { nodes: { get: () => ({ data: { seq: 42 } }) } }
    expect(resolveAnchorSeq(chat, 'k')).toBe(42)
  })
  it('returns null defensively', () => {
    expect(resolveAnchorSeq(undefined, 'k')).toBe(null)
    expect(resolveAnchorSeq({ nodes: { get: () => undefined } }, 'k')).toBe(null)
    expect(resolveAnchorSeq({ nodes: { get: () => ({ data: {} }) } }, 'k')).toBe(null)
    expect(resolveAnchorSeq(null, null)).toBe(null)
  })
})

describe('decideOpenScroll', () => {
  const userItems = [
    { kind: 'user', text: 'first', seq: 1 },
    { kind: 'user', text: 'mid', seq: 106503 },
    { kind: 'user', text: 'last', seq: 3 },
  ] as any

  it('scrolls an anchor entry to the seq resolved from its key (not to a different row)', () => {
    // Reading position is the MIDDLE message. The bug used to read the
    // key-less `seq` field off the anchor entry and fall back to the newest.
    const d = decideOpenScroll({ kind: 'anchor', seq: 106503, items: userItems, hasMore: false, deadlinePassed: false })
    expect(d).toEqual({ action: 'scroll', index: 1, seq: 106503 })
  })

  it('does NOT latch while the anchor row has not materialized in items (empty list on first pass)', () => {
    // Overlay mount: chat-view state not delivered yet -> items empty, but the
    // seq IS resolvable. The effect must keep waiting, never position "done".
    const d = decideOpenScroll({ kind: 'anchor', seq: 106503, items: [], hasMore: false, deadlinePassed: false })
    expect(d).toEqual({ action: 'wait' })
  })

  it('keeps waiting while history pages in (hasMore), even when the row exists', () => {
    const d = decideOpenScroll({ kind: 'anchor', seq: 106503, items: userItems, hasMore: true, deadlinePassed: true })
    expect(d).toEqual({ action: 'wait' })
  })

  it('falls back to the newest user message after the deadline when the anchor never materializes', () => {
    // The anchor row is absent from the settled list (its message was blank /
    // skipped by buildItems) and the deadline passed -> classic fallback.
    const d = decideOpenScroll({ kind: 'anchor', seq: 999999, items: userItems, hasMore: false, deadlinePassed: true })
    expect(d).toEqual({ action: 'scroll', index: 2, seq: null })
  })

  it('keeps waiting past the deadline while the row list itself never landed', () => {
    const d = decideOpenScroll({ kind: 'anchor', seq: 999999, items: [], hasMore: false, deadlinePassed: true })
    expect(d).toEqual({ action: 'bottom' })
  })

  it('falls back to the bottom after the deadline when no user row exists at all', () => {
    const d = decideOpenScroll({ kind: 'anchor', seq: 106503, items: [{ kind: 'assistant', blocks: [] } as any], hasMore: false, deadlinePassed: true })
    expect(d).toEqual({ action: 'bottom' })
  })

  it('scrolls an auto entry (auto-focus) to its question seq when the row materializes', () => {
    const d = decideOpenScroll({ kind: 'auto', seq: 106503, items: userItems, hasMore: false, deadlinePassed: false })
    expect(d).toEqual({ action: 'scroll', index: 1, seq: 106503 })
  })

  it('auto entry also waits (not latch) while its row is missing and the deadline has not passed', () => {
    const d = decideOpenScroll({ kind: 'auto', seq: 106503, items: [], hasMore: false, deadlinePassed: false })
    expect(d).toEqual({ action: 'wait' })
  })

  it('lastUser entry opens at the newest user prompt', () => {
    const d = decideOpenScroll({ kind: 'lastUser', seq: null, items: userItems, hasMore: false, deadlinePassed: false })
    expect(d).toEqual({ action: 'scroll', index: 2, seq: null })
  })

  it('lastUser entry waits (not latch) while the list is still empty pre-deadline', () => {
    const d = decideOpenScroll({ kind: 'lastUser', seq: null, items: [], hasMore: false, deadlinePassed: false })
    expect(d).toEqual({ action: 'wait' })
  })

  it('unresolvable anchor waits pre-deadline and falls back after it', () => {
    expect(decideOpenScroll({ kind: 'anchor', seq: null, items: [], hasMore: false, deadlinePassed: false })).toEqual({ action: 'wait' })
    expect(decideOpenScroll({ kind: 'anchor', seq: null, items: userItems, hasMore: false, deadlinePassed: true })).toEqual({ action: 'scroll', index: 2, seq: null })
  })
})

describe('legacySliceOf (dsh 0.1.2 snapshot adapter)', () => {
  it('reads the chat view legacy slice when present', () => {
    const chatView = { legacy: { nodes: [{ kind: 'user', seq: 1 }], partial: { turn: 1 }, runningCalls: [] } }
    const slice = legacySliceOf(chatView, {})
    expect(slice.nodes).toHaveLength(1)
    expect(slice.partial).toEqual({ turn: 1 })
  })
  it('falls back to flat snapshot fields on older dsh', () => {
    const slice = legacySliceOf(null, { nodes: [{ kind: 'assistant' }], partial: null, runningCalls: [{ name: 'bash' }] })
    expect(slice.nodes).toEqual([{ kind: 'assistant' }])
    expect(slice.runningCalls).toEqual([{ name: 'bash' }])
  })
  it('defaults to empty slices', () => {
    expect(legacySliceOf(null, null)).toEqual({ nodes: [], partial: null, runningCalls: [] })
  })
  it('feeds detectSettledCompletion with the adapted slice', () => {
    const chatView = { legacy: { nodes: [{ kind: 'user', seq: 1 }, { kind: 'assistant', seq: 2, interrupted: false }], partial: null, runningCalls: [] } }
    const slice = legacySliceOf(chatView, { running: false })
    const outcome = detectSettledCompletion(slice)
    expect(outcome.settled).toBe(true)
    expect(outcome.completed).toBe(true)
    expect(outcome.anchorSeq).toBe(1)
  })
})

describe('pendingInteractionOf (dsh 0.1.2 pending map)', () => {
  const interaction = { kind: 'question', key: 'k1' }
  it('reads the current session interaction', () => {
    const map = new Map([['s1', interaction]])
    expect(pendingInteractionOf(map, 's1')).toBe(interaction)
    expect(pendingInteractionOf(map, 's2')).toBe(null)
  })
  it('returns null defensively', () => {
    expect(pendingInteractionOf(null, 's1')).toBe(null)
    expect(pendingInteractionOf(undefined, undefined)).toBe(null)
  })
})

describe('lastUserSeq', () => {
  it('returns the last user seq and prefers user over steering', () => {
    const nodes = [
      { kind: 'user', seq: 1 },
      { kind: 'steering', seq: 5 },
      { kind: 'user', seq: 10 },
      { kind: 'steering', seq: 20 },
    ]
    expect(lastUserSeq(nodes)).toBe(10)
  })
  it('falls back to steering when no user message exists', () => {
    expect(lastUserSeq([{ kind: 'steering', seq: 7 }])).toBe(7)
  })
  it('returns null when neither user nor steering is present', () => {
    expect(lastUserSeq([{ kind: 'assistant', seq: 1 }])).toBe(null)
    expect(lastUserSeq([])).toBe(null)
    expect(lastUserSeq(undefined as any)).toBe(null)
  })
})

describe('lastUserIndex', () => {
  const items = [
    { kind: 'user', text: 'a', seq: 1 },
    { kind: 'steering', text: 'b', seq: 2 },
    { kind: 'user', text: 'c', seq: 3 },
    { kind: 'assistant', blocks: [], seq: 4, turn: 1, step: 1 },
  ] as any
  it('returns the last user item index', () => {
    expect(lastUserIndex(items)).toBe(2)
  })
  it('returns -1 when no user item exists', () => {
    expect(lastUserIndex([{ kind: 'assistant', blocks: [], seq: 1, turn: 1, step: 1 }] as any)).toBe(-1)
  })
})

describe('lastPromptSeq', () => {
  it('returns the newest user or steering seq (steering counts as a prompt)', () => {
    const items = [
      { kind: 'user', text: 'a', seq: 1 },
      { kind: 'assistant', blocks: [], seq: 2, turn: 1, step: 1 },
      { kind: 'steering', text: 'b', seq: 3 },
    ] as any
    expect(lastPromptSeq(items)).toBe(3)
  })
  it('returns the last user seq when it is the newest prompt row', () => {
    const items = [
      { kind: 'steering', text: 'a', seq: 1 },
      { kind: 'user', text: 'b', seq: 5 },
      { kind: 'assistant', blocks: [], seq: 6, turn: 1, step: 1 },
    ] as any
    expect(lastPromptSeq(items)).toBe(5)
  })
  it('returns null when no prompt row exists', () => {
    expect(lastPromptSeq([{ kind: 'assistant', blocks: [], seq: 1, turn: 1, step: 1 }] as any)).toBe(null)
    expect(lastPromptSeq([{ kind: 'process', collapsed: true, counts: { tools: 0, messages: 0, subagents: 0 }, rows: [] }] as any)).toBe(null)
    expect(lastPromptSeq([])).toBe(null)
  })
})

describe('detectSettledCompletion', () => {
  it('accepts a finalized, non-interrupted assistant as a normal completion', () => {
    const snap = {
      partial: null,
      nodes: [
        { kind: 'user', seq: 1 },
        { kind: 'assistant', seq: 2, turn: 1, step: 1, messageId: 'm1' },
      ],
    }
    expect(detectSettledCompletion(snap)).toEqual({ settled: true, completed: true, anchorSeq: 1 })
  })
  it('rejects an interrupted (stopped) assistant', () => {
    const outcome = detectSettledCompletion({ partial: null, nodes: [{ kind: 'assistant', seq: 2, turn: 1, step: 1, interrupted: true }] })
    expect(outcome).toEqual({ settled: true, completed: false, anchorSeq: null })
  })
  it('rejects turn-error and turn-max-tokens terminals', () => {
    expect(detectSettledCompletion({ partial: null, nodes: [{ kind: 'assistant', seq: 1, turn: 1, step: 1 }, { kind: 'turn-error', seq: 2, message: 'boom' }] })).toEqual({ settled: true, completed: false, anchorSeq: null })
    expect(detectSettledCompletion({ partial: null, nodes: [{ kind: 'turn-max-tokens', seq: 2 }] })).toEqual({ settled: true, completed: false, anchorSeq: null })
  })
  it('rejects when no terminal node exists', () => {
    expect(detectSettledCompletion({ partial: null, nodes: [{ kind: 'user', seq: 1 }] })).toEqual({ settled: true, completed: false, anchorSeq: null })
    expect(detectSettledCompletion({ partial: null, nodes: [] })).toEqual({ settled: true, completed: false, anchorSeq: null })
    expect(detectSettledCompletion(undefined)).toEqual({ settled: true, completed: false, anchorSeq: null })
  })
  it('skips trailing non-terminal nodes (context after assistant)', () => {
    const snap = {
      partial: null,
      nodes: [
        { kind: 'user', seq: 1 },
        { kind: 'assistant', seq: 2, turn: 1, step: 1, messageId: 'm1' },
        { kind: 'context', seq: 3 },
      ],
    }
    expect(detectSettledCompletion(snap)).toEqual({ settled: true, completed: true, anchorSeq: 1 })
  })
  it('anchorSeq is null when no user/steering started the turn', () => {
    const snap = { partial: null, nodes: [{ kind: 'assistant', seq: 2, turn: 1, step: 1, messageId: 'm1' }] }
    expect(detectSettledCompletion(snap)).toEqual({ settled: true, completed: true, anchorSeq: null })
  })

  // Regression: the running bit can flip before the aborted turn's frozen
  // (interrupted) node has landed, so the tail is still streaming in `partial`
  // and `nodes` is missing the final assistant. We must defer, not misjudge.
  it('defers (settled:false) while a reply is still streaming in partial', () => {
    const snap = {
      partial: { turn: 1, step: 2, blocks: [{ kind: 'text', text: 'still writing' }] },
      nodes: [
        { kind: 'user', seq: 1 },
        { kind: 'assistant', seq: 2, turn: 1, step: 1, messageId: 'm1' },
      ],
    }
    expect(detectSettledCompletion(snap)).toEqual({ settled: false, completed: false, anchorSeq: null })
  })

  // The exact reported bug: a finalized question (step 1, no `interrupted`) is
  // followed by the continued output still in `partial`. Without the guard this
  // would read as a normal completion and auto-open focus; with it, deferred.
  it('does not misjudge a finalized question as the tail while the follow-up streams', () => {
    const snap = {
      partial: { turn: 1, step: 2, blocks: [{ kind: 'text', text: 'continued' }] },
      nodes: [
        { kind: 'user', seq: 1 },
        { kind: 'assistant', seq: 2, turn: 1, step: 1, messageId: 'm1' },
        { kind: 'tool-result', seq: 3 },
      ],
    }
    expect(detectSettledCompletion(snap)).toEqual({ settled: false, completed: false, anchorSeq: null })
  })

  // Once the freeze lands (partial empties and the interrupted node enters
  // `nodes`), the same scenario is correctly rejected.
  it('rejects once the aborted follow-up freezes into an interrupted node', () => {
    const snap = {
      partial: null,
      nodes: [
        { kind: 'user', seq: 1 },
        { kind: 'assistant', seq: 2, turn: 1, step: 1, messageId: 'm1' },
        { kind: 'tool-result', seq: 3 },
        { kind: 'assistant', seq: 3.1, turn: 1, step: 2, interrupted: true },
      ],
    }
    expect(detectSettledCompletion(snap)).toEqual({ settled: true, completed: false, anchorSeq: null })
  })
})

describe('hasPendingInteraction', () => {
  it('is true while any pending interaction exists, false once answered', () => {
    expect(hasPendingInteraction({ pending: [{ key: 'q1' }] })).toBe(true)
    expect(hasPendingInteraction({ pending: [{ key: 'a' }, { key: 'b' }] })).toBe(true)
    expect(hasPendingInteraction({ pending: [] })).toBe(false)
    expect(hasPendingInteraction({})).toBe(false)
    expect(hasPendingInteraction(undefined)).toBe(false)
    expect(hasPendingInteraction(null)).toBe(false)
  })
})

describe('onboardingSeen', () => {
  it('is true only when the stored flag matches the current version', () => {
    expect(onboardingSeen('1', '1')).toBe(true)
    expect(onboardingSeen('0', '1')).toBe(false)
    expect(onboardingSeen(null, '1')).toBe(false)
  })
})

describe('hotkeyShouldEnter', () => {
  // Base event/opts that would trigger: F, no modifiers, pref on, not typing,
  // focus closed.
  const base = () => ({
    e: { key: 'f', ctrlKey: false, metaKey: false, altKey: false, repeat: false },
    opts: { enabled: true, typing: false, focusOn: false },
  })

  it('enters on plain F in either case', () => {
    expect(hotkeyShouldEnter(base().e, base().opts)).toBe(true)
    expect(hotkeyShouldEnter({ ...base().e, key: 'F' }, base().opts)).toBe(true)
  })

  it('ignores other keys', () => {
    for (const key of ['a', 'g', 'Enter', 'Escape', ' ']) {
      expect(hotkeyShouldEnter({ ...base().e, key }, base().opts)).toBe(false)
    }
    expect(hotkeyShouldEnter({ ...base().e, key: '' }, base().opts)).toBe(false)
    // missing `key` (never happens on KeyboardEvent, but defensively)
    expect(hotkeyShouldEnter({ ...base().e, key: undefined as any }, base().opts)).toBe(false)
  })

  it('ignores when the pref is off', () => {
    expect(hotkeyShouldEnter(base().e, { ...base().opts, enabled: false })).toBe(false)
  })

  it('ignores when focus is already open', () => {
    expect(hotkeyShouldEnter(base().e, { ...base().opts, focusOn: true })).toBe(false)
  })

  it('ignores while typing in an editable element', () => {
    expect(hotkeyShouldEnter(base().e, { ...base().opts, typing: true })).toBe(false)
  })

  it('ignores modifier combinations (Ctrl/Meta/Alt + F)', () => {
    expect(hotkeyShouldEnter({ ...base().e, ctrlKey: true }, base().opts)).toBe(false)
    expect(hotkeyShouldEnter({ ...base().e, metaKey: true }, base().opts)).toBe(false)
    expect(hotkeyShouldEnter({ ...base().e, altKey: true }, base().opts)).toBe(false)
  })

  it('ignores key auto-repeat', () => {
    expect(hotkeyShouldEnter({ ...base().e, repeat: true }, base().opts)).toBe(false)
  })
})

// ---- bottom dock form selection ----

import {
  bottomForm,
  bottomZoneAfter,
  BOTTOM_ENTER_PX,
  BOTTOM_EXIT_PX,
  NAV_TOP_PX,
  activeNavIndex,
  shouldRevealSentPrompt,
  REVEAL_RESERVE_PX,
  questionAnswered,
  allAnswered,
  encodeAnswer,
  parseRecommendedLabel,
} from '../src/client/model'
import { FOCUS_CSS } from '../src/client/styles'

describe('bottomForm', () => {
  const base = { pending: false, cardOpen: false, draftEmpty: true, inZone: false, focused: false, engaged: false }

  it('pending owns the region: toast by default, card once opened', () => {
    expect(bottomForm({ ...base, pending: true })).toBe('toast')
    expect(bottomForm({ ...base, pending: true, cardOpen: true })).toBe('card')
    // even with a draft / in zone / focused — a plain prompt cannot answer
    expect(bottomForm({ ...base, pending: true, draftEmpty: false, inZone: true, focused: true })).toBe('toast')
  })

  it('a focused bar stays up regardless of draft or scroll position', () => {
    expect(bottomForm({ ...base, focused: true })).toBe('bar')
    expect(bottomForm({ ...base, focused: true, inZone: false })).toBe('bar')
    expect(bottomForm({ ...base, focused: true, draftEmpty: false, inZone: false })).toBe('bar')
  })

  it('engaged (pill→bar handoff, focus not landed yet) shows the bar', () => {
    expect(bottomForm({ ...base, engaged: true, draftEmpty: false, inZone: false })).toBe('bar')
  })

  it('empty bar inside the bottom zone is ambient chrome', () => {
    expect(bottomForm({ ...base, inZone: true })).toBe('bar')
  })

  it('a draft alone no longer keeps the bar: blurred folds into the pill', () => {
    expect(bottomForm({ ...base, draftEmpty: false })).toBe('pill')
    // even at the live edge — clicking the conversation area collapsed it
    expect(bottomForm({ ...base, draftEmpty: false, inZone: true })).toBe('pill')
  })

  it('no draft, out of zone, unfocused: jump-to-bottom', () => {
    expect(bottomForm(base)).toBe('tobottom')
  })
})

describe('bottomZoneAfter (hysteresis)', () => {
  it('enters within the enter threshold', () => {
    expect(bottomZoneAfter(false, 0)).toBe(true)
    expect(bottomZoneAfter(false, BOTTOM_ENTER_PX)).toBe(true)
  })

  it('leaves beyond the exit threshold', () => {
    expect(bottomZoneAfter(true, BOTTOM_EXIT_PX)).toBe(false)
    expect(bottomZoneAfter(true, 10000)).toBe(false)
  })

  it('keeps the previous verdict between the thresholds (no flapping)', () => {
    const mid = (BOTTOM_ENTER_PX + BOTTOM_EXIT_PX) / 2
    expect(bottomZoneAfter(true, mid)).toBe(true)
    expect(bottomZoneAfter(false, mid)).toBe(false)
  })
})

describe('shouldRevealSentPrompt (send reveal decision)', () => {
  // Base facts of the reported bug: the reader sat at the bottom (armed), the
  // last prompt they saw was seq 10, and the sent row just rendered as seq 12.
  const base = { armed: true, prevSeq: 10, nextSeq: 12 }

  it('fires when armed and the newest prompt seq advanced', () => {
    expect(shouldRevealSentPrompt(base)).toBe(true)
  })

  it('fires for the first message of an empty conversation (prev null)', () => {
    expect(shouldRevealSentPrompt({ armed: true, prevSeq: null, nextSeq: 1 })).toBe(true)
  })

  it('stays quiet while the sent row has not rendered yet (seq unchanged)', () => {
    // Streaming snapshots between the click and delivery re-run the effect
    // with the same newest prompt — no premature scroll.
    expect(shouldRevealSentPrompt({ ...base, nextSeq: 10 })).toBe(false)
  })

  it('stays quiet when not armed (mount, ordinary history, send from up in history)', () => {
    expect(shouldRevealSentPrompt({ ...base, armed: false })).toBe(false)
  })

  it('stays quiet when no prompt row exists at all', () => {
    expect(shouldRevealSentPrompt({ ...base, nextSeq: null })).toBe(false)
  })

  it('REVEAL_RESERVE_PX stays in sync with .fm-body bottom padding (dock clearance)', () => {
    // The reserve is only correct as long as it matches the scrollport's own
    // bottom padding — the layout's contract for "clear of the dock". If this
    // fails, update both together.
    const block = FOCUS_CSS.match(/\.fm-body\{[^}]*\}/)?.[0] ?? ''
    const pad = block.match(/padding:([^;}]+)/)?.[1] ?? ''
    expect(parseInt(pad.trim().split(/\s+/)[2], 10)).toBe(REVEAL_RESERVE_PX)
  })
})

describe('activeNavIndex', () => {
  const INF = Number.POSITIVE_INFINITY

  it('returns -1 when there are no dots', () => {
    expect(activeNavIndex([], 0)).toBe(-1)
  })

  it('picks the last anchor at/above the top line (geometric scan)', () => {
    expect(activeNavIndex([10, 50, 90, 400], 10000)).toBe(2)
    expect(activeNavIndex([NAV_TOP_PX, 500], 10000)).toBe(0) // exactly on the line counts
  })

  it('skips stale anchor slots (Infinity) without stopping the scan', () => {
    expect(activeNavIndex([10, INF, 90], 10000)).toBe(2)
    expect(activeNavIndex([10, INF, 500], 10000)).toBe(0)
  })

  it('clamps to the first dot when every anchor is below the line', () => {
    expect(activeNavIndex([200, 800, 1400], 10000)).toBe(0)
  })

  it('bottom force: within the enter threshold the last dot owns the highlight', () => {
    expect(activeNavIndex([10, 200, 800], 0)).toBe(2)
    expect(activeNavIndex([10, 200, 800], BOTTOM_ENTER_PX)).toBe(2)
  })

  it('a short final turn pinned at the bottom lights its own dot', () => {
    // Geometry alone would stick to the first turn — the last anchor can never
    // reach the top line with less than a viewport of content below it.
    expect(activeNavIndex([50, 300, 420], 10000)).toBe(0)
    expect(activeNavIndex([50, 300, 420], 0)).toBe(2)
  })

  it('just past the enter threshold falls back to geometry', () => {
    expect(activeNavIndex([10, 200], BOTTOM_ENTER_PX + 0.01)).toBe(0)
  })

  it('non-finite bottom distance degrades to pure geometry', () => {
    expect(activeNavIndex([10, 50], INF)).toBe(1)
  })
})

describe('answer encoding', () => {
  it('questionAnswered: selection or non-blank custom', () => {
    expect(questionAnswered(undefined)).toBe(false)
    expect(questionAnswered({ selected: [], custom: '' })).toBe(false)
    expect(questionAnswered({ selected: [], custom: '   ' })).toBe(false)
    expect(questionAnswered({ selected: ['A'], custom: '' })).toBe(true)
    expect(questionAnswered({ selected: [], custom: 'free text' })).toBe(true)
  })

  it('allAnswered requires every question, and rejects empty batches', () => {
    const qs = [{ id: 'a' }, { id: 'b' }]
    expect(allAnswered([], {})).toBe(false)
    expect(allAnswered(qs, {})).toBe(false)
    expect(allAnswered(qs, { a: { selected: ['x'], custom: '' } })).toBe(false)
    expect(allAnswered(qs, {
      a: { selected: ['x'], custom: '' },
      b: { selected: [], custom: 'note' },
    })).toBe(true)
    // skips null entries defensively
    expect(allAnswered([null as any, { id: 'a' }], { a: { selected: ['x'], custom: '' } })).toBe(true)
  })

  it('encodeAnswer echoes labels verbatim (recommendation marker included) and trims custom', () => {
    const qs = [
      { id: 'q1', options: [{ label: 'A (Recommended)' }, { label: 'B' }] },
      { id: 'q2' },
    ]
    const drafts = {
      q1: { selected: ['A (Recommended)'], custom: '  extra  ' },
      q2: { selected: [], custom: 'plain' },
    }
    // q1 is single-select WITH custom → the official exclusivity rule clears
    // `selected` (option or custom, never both); q2 has no options at all.
    expect(encodeAnswer(qs, drafts)).toEqual({
      answers: [
        { id: 'q1', selected: [], custom: 'extra' },
        { id: 'q2', selected: [], custom: 'plain' },
      ],
    })
  })

  it('encodeAnswer keeps selection and custom together only for multi-select', () => {
    const qs = [
      { id: 's', multiSelect: false },
      { id: 'm', multiSelect: true },
    ]
    const drafts = {
      s: { selected: ['x'], custom: 'note' },
      m: { selected: ['x', 'y'], custom: 'note' },
    }
    expect(encodeAnswer(qs, drafts)).toEqual({
      answers: [
        { id: 's', selected: [], custom: 'note' },
        { id: 'm', selected: ['x', 'y'], custom: 'note' },
      ],
    })
  })

  it('encodeAnswer omits blank custom and defaults missing drafts to empty', () => {
    expect(encodeAnswer([{ id: 'q' }], {})).toEqual({ answers: [{ id: 'q', selected: [] }] })
  })

  it('parseRecommendedLabel splits the marker for display only (lenient, official-style)', () => {
    expect(parseRecommendedLabel('A (Recommended)')).toEqual({ label: 'A', recommended: true })
    expect(parseRecommendedLabel('A (recommended)')).toEqual({ label: 'A', recommended: true })
    expect(parseRecommendedLabel('A（推荐）')).toEqual({ label: 'A', recommended: true })
    expect(parseRecommendedLabel('B')).toEqual({ label: 'B', recommended: false })
    // the marker alone is not a recommendation marker
    expect(parseRecommendedLabel(' (Recommended)')).toEqual({ label: ' (Recommended)', recommended: false })
  })
})

describe('legacyPendingOf (pre-0.1.2 pending adapter)', () => {
  const legacyQuestion = {
    kind: 'question',
    sessionId: 's1',
    payload: { questions: [{ id: 'q1', question: 'Which?', options: [{ label: 'A' }] }] },
    respond: (result: any) => Promise.resolve({ accepted: true, echo: result }),
  }
  const legacyApproval = {
    kind: 'approval',
    sessionId: 's1',
    payload: { approvalId: 'ap1', toolName: 'bash', reason: 'run ls' },
    respond: (result: any) => Promise.resolve({ accepted: true, echo: result }),
  }

  it('returns null when nothing is pending', () => {
    expect(legacyPendingOf(null)).toBeNull()
    expect(legacyPendingOf({})).toBeNull()
    expect(legacyPendingOf({ pending: [] })).toBeNull()
  })

  it('reshapes a legacy question into the 0.1.2 carrier face', () => {
    const wait = legacyPendingOf({ pending: [legacyQuestion] })
    expect(wait.kind).toBe('question')
    expect(wait.questions).toHaveLength(1)
    expect(wait.questions[0].id).toBe('q1')
  })

  it('reshapes a legacy approval with reason/toolName/approvalId', () => {
    const wait = legacyPendingOf({ pending: [legacyApproval] })
    expect(wait.kind).toBe('approval')
    expect(wait.approvalId).toBe('ap1')
    expect(wait.toolName).toBe('bash')
    expect(wait.reason).toBe('run ls')
  })

  it('shims answer() onto respond() with the legacy envelope (question)', async () => {
    const wait = legacyPendingOf({ pending: [legacyQuestion] })
    const receipt = await wait.answer({ q1: 'A' })
    expect(receipt.accepted).toBe(true)
    expect(receipt.echo).toEqual({ ok: true, value: { sessionId: 's1', answer: { q1: 'A' } } })
  })

  it('shims answer() onto respond() with the approval outcome envelope', async () => {
    const wait = legacyPendingOf({ pending: [legacyApproval] })
    const receipt = await wait.answer('allowed-once')
    expect(receipt.echo).toEqual({ ok: true, value: { sessionId: 's1', approvalId: 'ap1', outcome: 'allowed-once' } })
  })

  it('rejects with a rejected-marker error when the legacy receipt refuses', async () => {
    const refusing = {
      kind: 'question', sessionId: 's1', payload: {},
      respond: () => Promise.resolve({ accepted: false, reason: 'session gone' }),
    }
    const wait = legacyPendingOf({ pending: [refusing] })
    await expect(wait.answer({})).rejects.toMatchObject({ rejected: true, reason: 'session gone' })
  })

  it('leaves a 0.1.2 carrier untouched (answer already a function)', () => {
    const modern = { kind: 'question', questions: [], answer: () => Promise.resolve({}) }
    const wait = legacyPendingOf({ pending: [modern] })
    expect(wait.answer).toBe(modern.answer)
  })
})

describe('legacy fallback edges', () => {
  it('legacySliceOf yields null partial even when the legacy slice omits it', () => {
    expect(legacySliceOf({ legacy: { nodes: [] } }, null).partial).toBeNull()
  })

  it('detectSettledCompletion accepts runningCalls so the legacy shape still judges', () => {
    const outcome = detectSettledCompletion({ partial: null, nodes: [], runningCalls: [{ name: 'bash' }] })
    expect(outcome).toHaveProperty('settled')
  })
})
