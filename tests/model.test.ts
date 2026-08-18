import { describe, it, expect } from 'vitest'
import {
  flattenText,
  hasAssistantContent,
  addMetric,
  summarySegments,
  buildItems,
  findSeqIndex,
  resolveAnchorSeq,
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
  it('folds tool-result/context/command into a summary line', () => {
    const nodes = [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: 'hi' }] },
      { kind: 'tool-result', seq: 2, call: { name: 'bash' } },
      { kind: 'context', seq: 3, content: [] },
      { kind: 'command', seq: 4, name: 'x' },
      { kind: 'assistant', seq: 5, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'done' }] },
    ]
    const items = buildItems(nodes, [], t)
    expect(items.map((i) => i.kind)).toEqual(['user', 'hidden', 'assistant'])
    const hidden = items[1] as { kind: 'hidden'; text: string }
    expect(hidden.text).toContain('sum.commands:2')
    expect(hidden.text).toContain('sum.context:1')
  })

  it('skips empty user and non-content assistant nodes', () => {
    const nodes = [
      { kind: 'user', seq: 1, content: [{ type: 'image' }] },
      { kind: 'assistant', seq: 2, turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'think' }] },
    ]
    expect(buildItems(nodes, [], t)).toEqual([])
  })

  it('emits an error item for turn-error', () => {
    const items = buildItems([{ kind: 'turn-error', seq: 1, message: 'boom' }], [], t)
    expect(items).toEqual([{ kind: 'error', text: 'boom' }])
  })

  it('accounts for running tool calls', () => {
    const items = buildItems([], [{ name: 'bash' }, { name: 'bash' }], t)
    expect(items).toHaveLength(1)
    expect((items[0] as { kind: 'hidden'; text: string }).text).toBe('sum.commands:2')
  })
})

describe('findSeqIndex', () => {
  const items = [
    { kind: 'user', text: 'a', seq: 10 },
    { kind: 'steering', text: 'b', seq: 20 },
    { kind: 'hidden', text: 'x' },
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
