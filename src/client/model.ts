import type { FocusTranslate } from './locales'

// ---- text helpers ----
export function flattenText(content: any): string {
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
export function addMetric(metrics: Record<string, number>, name: string) {
  const fam = METRIC[name] || 'others'
  metrics[fam] = (metrics[fam] || 0) + 1
}
export function summarySegments(t: FocusTranslate, metrics: Record<string, number>): string[] {
  const segs: string[] = []
  for (const fam of METRIC_ORDER) {
    const n = metrics[fam]
    if (!n) continue
    const key = METRIC_KEY[fam]
    segs.push((key === 'sum.todos' || key === 'sum.goals') ? t(key) : t(key, { n }))
  }
  return segs
}

export type FocusItem =
  | { kind: 'user'; text: string; seq: number }
  | { kind: 'steering'; text: string; seq: number }
  | { kind: 'assistant'; blocks: any[]; seq: number; turn: number; step: number }
  | { kind: 'hidden'; text: string }
  | { kind: 'error'; text: string }

export function hasAssistantContent(blocks: any[]): boolean {
  for (const b of blocks || []) {
    if (b && (b.kind === 'text' || b.kind === 'image')) return true
  }
  return false
}

export function buildItems(nodes: any[], runningCalls: any[], t: FocusTranslate): FocusItem[] {
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

export function resolveAnchorSeq(chat: any, key: string | null): number | null {
  if (!key || !chat || !chat.nodes) return null
  try {
    const node = chat.nodes.get(key)
    if (!node) return null
    const d = node.data || node.node || node
    return (d && typeof d.seq === 'number') ? d.seq : null
  } catch { return null }
}

export function findSeqIndex(items: FocusItem[], seq: number): number {
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if ((it.kind === 'user' || it.kind === 'steering') && it.seq === seq) return i
  }
  return -1
}

/** Seq of the message that started the latest turn: the last `user` node, or a
 *  `steering` node as a fallback when no user message exists (e.g. a
 *  command-only session). Returns null when neither is present. */
export function lastUserSeq(nodes: any[]): number | null {
  let user: number | null = null
  let steering: number | null = null
  for (const n of nodes || []) {
    if (!n || typeof n.seq !== 'number') continue
    if (n.kind === 'user') user = n.seq
    else if (n.kind === 'steering') steering = n.seq
  }
  return user != null ? user : steering
}

/** Index of the last user item in an already-built focus list (toast "View"
 *  jump target); -1 when absent. */
export function lastUserIndex(items: FocusItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === 'user') return i
  }
  return -1
}

export interface SettledOutcome {
  /** A reply completed normally (not stopped / errored / capped / interrupted). */
  completed: boolean
  /** Seq of the user message that started this turn, or null when unknown. */
  anchorSeq: number | null
}

/**
 * Decide whether an already-settled conversation snapshot (`running === false`)
 * ends in a *normal* completed reply, and which user message started it.
 *
 * The caller owns the `running true → false` edge; this is the pure
 * "is the tail a finished reply?" predicate: it walks backwards to the first
 * turn-terminating node (`assistant` / `turn-error` / `turn-max-tokens`), then
 * accepts only a finalized, non-interrupted assistant node.
 */
export function detectSettledCompletion(snap: any): SettledOutcome {
  const nodes = snap && snap.nodes ? snap.nodes : []
  let terminal: any = null
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    if (!n) continue
    if (n.kind === 'assistant' || n.kind === 'turn-error' || n.kind === 'turn-max-tokens') {
      terminal = n
      break
    }
  }
  if (!terminal || terminal.kind !== 'assistant' || terminal.interrupted) {
    return { completed: false, anchorSeq: null }
  }
  return { completed: true, anchorSeq: lastUserSeq(nodes) }
}

/** True while the session has a pending interaction — the AI is blocked waiting
 *  for the user (to answer a question or approve an action). It stays true for
 *  the whole wait (`running` remains true throughout) and clears as soon as the
 *  user answers, so it is the live signal for "questions still unanswered". */
export function hasPendingInteraction(snap: any): boolean {
  const pending = snap && snap.pending
  return Array.isArray(pending) && pending.length > 0
}
