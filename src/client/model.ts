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
  /** The snapshot is stable: the last assistant step has finalized or frozen,
   *  so its node is already in `nodes` and `partial` is empty. Only a stable
   *  snapshot can be judged — while `partial` is non-null the tail is still
   *  streaming and `nodes` is missing the final assistant node. */
  settled: boolean
  /** A reply completed normally (not stopped / errored / capped / interrupted). */
  completed: boolean
  /** Seq of the user message that started this turn, or null when unknown. */
  anchorSeq: number | null
}

/**
 * Decide whether a settled conversation snapshot (`running === false`) ends in
 * a *normal* completed reply, and which user message started it.
 *
 * The caller owns the `running true → false` edge. `running` is relayed on a
 * different stream than the conversation events, so the edge can fire before an
 * aborted turn's `interrupted` node has landed — at that instant the tail is
 * still held in `partial` and `nodes` is missing the final assistant (a
 * finalized question message can then be mistaken for the tail). To close that
 * race we require the snapshot to be *stable* first: while `partial` is non-null
 * we return `settled: false` and the caller must re-evaluate on a later
 * snapshot. Once stable, this walks backwards to the first turn-terminating node
 * (`assistant` / `turn-error` / `turn-max-tokens`) and accepts only a finalized,
 * non-interrupted assistant node.
 */
export function detectSettledCompletion(snap: any): SettledOutcome {
  // Still streaming / freeze not landed: the tail node is not in `nodes` yet,
  // so judging now would race the interrupted marker. Defer.
  if (snap && snap.partial != null) {
    return { settled: false, completed: false, anchorSeq: null }
  }
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
    return { settled: true, completed: false, anchorSeq: null }
  }
  return { settled: true, completed: true, anchorSeq: lastUserSeq(nodes) }
}

/** True while the session has a pending interaction — the AI is blocked waiting
 *  for the user (to answer a question or approve an action). It stays true for
 *  the whole wait (`running` remains true throughout) and clears as soon as the
 *  user answers, so it is the live signal for "questions still unanswered". */
export function hasPendingInteraction(snap: any): boolean {
  const pending = snap && snap.pending
  return Array.isArray(pending) && pending.length > 0
}

/** True once the persisted onboarding flag matches the current intro version.
 *  Kept as a pure comparison so the "already seen?" decision is testable and
 *  can be versioned: bump the version to re-show the intro after a major change. */
export function onboardingSeen(stored: string | null, version: string): boolean {
  return stored === version
}

/** Whether a keydown should enter focus mode via the F hotkey. Pure decision so
 *  the guard rails are unit-testable: the pref must be enabled, focus must not
 *  already be open, the press must not land in an editable element (composer /
 *  inputs — typing "f" must never yank the user into focus mode), no modifier
 *  may be held, auto-repeat is ignored, and the key must be F (either case). */
export function hotkeyShouldEnter(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean },
  opts: { enabled: boolean; typing: boolean; focusOn: boolean },
): boolean {
  if (!opts.enabled) return false
  if (opts.focusOn) return false
  if (opts.typing) return false
  if (e.repeat) return false
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  const k = typeof e.key === 'string' ? e.key : ''
  return k === 'f' || k === 'F'
}

// ---- bottom dock: the focus-mode composer region ----

/** Which form the bottom-center dock takes. The forms are mutually exclusive;
 *  `bottomForm` below is the single authority for which one renders. */
export type BottomForm = 'card' | 'toast' | 'bar' | 'pill' | 'tobottom'

/**
 * Decide the bottom dock's form from the live facts. Priority order mirrors the
 * agreed design:
 *
 * 1. pending (the AI is blocked waiting) owns the region — the answer card when
 *    the user opened it (the waiting toast morphs in place), otherwise the
 *    waiting toast itself. A plain prompt cannot answer `ask_user_question`, so
 *    while pending the input bar is suppressed entirely (the official main view
 *    likewise lets the question UI take over the composer seat).
 * 2. the input bar while the user is IN it: focused, or the one-render handoff
 *    from a pill click (`engaged`, focus not landed yet). With a draft this is
 *    the only thing that keeps the bar up — clicking the conversation area
 *    blurs the textarea and the bar folds itself into the pill (draft safe,
 *    blue dot, one click back). There is no manual hide.
 * 3. also the bar, as ambient chrome, while empty and reading at the live
 *    edge — a slim placeholder offering the composer.
 * 4. otherwise: a draft (unfocused) shows the pill; no draft and scrolled away
 *    shows the jump-to-bottom button.
 */
export function bottomForm(o: {
  pending: boolean
  cardOpen: boolean
  draftEmpty: boolean
  inZone: boolean
  focused: boolean
  engaged: boolean
}): BottomForm {
  if (o.pending) return o.cardOpen ? 'card' : 'toast'
  if (o.engaged || o.focused || (o.draftEmpty && o.inZone)) return 'bar'
  return o.draftEmpty ? 'tobottom' : 'pill'
}

/** Distance from the scroll end that counts as "at the bottom" (entering). */
export const BOTTOM_ENTER_PX = 48
/** Distance beyond which the reader has left the bottom zone (leaving). */
export const BOTTOM_EXIT_PX = 160

/**
 * Bottom-zone membership with hysteresis: entering requires the viewport edge
 * within {@link BOTTOM_ENTER_PX} of the scroll end, leaving requires drifting
 * past {@link BOTTOM_EXIT_PX}. Between the two thresholds the previous verdict
 * stands, so slow scrolling near the end (or streaming content quietly growing
 * the scrollHeight under a still reader) never flaps the dock between forms.
 */
export function bottomZoneAfter(prev: boolean, distance: number): boolean {
  if (distance <= BOTTOM_ENTER_PX) return true
  if (distance >= BOTTOM_EXIT_PX) return false
  return prev
}

// ---- pending answer encoding (question/respond wire shape) ----

/** The answer card's local, per-question edit state. Independent of the shared
 *  composer draft on purpose: the custom text is part of the answer payload
 *  (`custom`), submitted-and-cleared with the batch, never a prompt draft. */
export interface AnswerDraft {
  selected: string[]
  custom: string
}

/** A question is answered when at least one option is selected or the custom
 *  text is non-blank — the same completeness rule the official question
 *  composer applies before enabling submit. */
export function questionAnswered(d: AnswerDraft | undefined): boolean {
  if (!d) return false
  if (d.selected.length > 0) return true
  return d.custom.trim() !== ''
}

/** The whole batch must be answered: one `ask()` is one answer covering every
 *  question, never split per question. An empty question list is never
 *  complete (nothing to send — submit stays disabled); malformed null entries
 *  are skipped, matching encodeAnswer, so one bad row cannot deadlock the
 *  answerable majority. */
export function allAnswered(questions: any[], drafts: Record<string, AnswerDraft>): boolean {
  if (!questions || questions.length === 0) return false
  for (const q of questions) {
    if (!q) continue
    if (!questionAnswered(drafts[q.id])) return false
  }
  return true
}

/**
 * Encode the complete answer batch in the wire shape `question/respond`
 * expects (`AskUserQuestionAnswer`). Mirrors the official encoder's
 * exclusivity rule: a single-select question carries EITHER the selected
 * option OR the custom text (`selected` is cleared when custom is present —
 * never both, which would be a contradictory answer); multi-select may carry
 * both. Option labels go back verbatim — the harness's recommendation suffix
 * is part of the label the asker must see echoed — and custom text is sent
 * trimmed, only when present.
 */
export function encodeAnswer(questions: any[], drafts: Record<string, AnswerDraft>): { answers: Array<{ id: string; selected: string[]; custom?: string }> } {
  const answers: Array<{ id: string; selected: string[]; custom?: string }> = []
  for (const q of questions || []) {
    if (!q) continue
    const d = drafts[q.id] || { selected: [], custom: '' }
    const custom = d.custom.trim()
    const selected = (custom === '' || q.multiSelect) ? [...d.selected] : []
    const item: { id: string; selected: string[]; custom?: string } = { id: q.id, selected }
    if (custom) item.custom = custom
    answers.push(item)
  }
  return { answers }
}

/** Split the harness's recommendation marker off an option label for display
 *  (the marker becomes a badge); the full label stays what the wire echoes
 *  back. Lenient like the official parser: ASCII or full-width parentheses,
 *  "recommended" in any case, or the Chinese 推荐. */
export function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  if (typeof label !== 'string') return { label, recommended: false }
  const rest = label.replace(/\s*[（(]\s*(?:recommended|推荐)\s*[)）]\s*$/i, '')
  if (rest === label || rest === '') return { label, recommended: false }
  return { label: rest, recommended: true }
}
