import { useEffect, useState } from 'react'
import { onboardingSeen, readEntryCount, readStarred } from './model'

/** User preferences, persisted to localStorage (bundle plugins have full browser access). */
export interface FocusPrefs {
  navbar: boolean
  scroll: 'preserve' | 'bottom'
  width: number
  /** When enabled, a normally-completed reply auto-opens focus mode (or, if already open, shows a "new reply" reminder). */
  autoFocus: boolean
  /** When enabled, pressing F anywhere enters focus mode (ignored while typing in an input). */
  hotkey: boolean
  /** When enabled, the focus-mode input bar borrows the OFFICIAL main-view
   *  composer (slash commands, @ references, chips — the whole official
   *  editing surface) instead of the plugin's textarea; falls back to the
   *  textarea when the official composer DOM is unavailable. */
  borrow: boolean
}

const KEY = 'dsh-focus-overlay:prefs'
const DEFAULTS: FocusPrefs = { navbar: true, scroll: 'preserve', width: 760, autoFocus: false, hotkey: true, borrow: true }

function load(): FocusPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

let prefs: FocusPrefs = load()
const listeners: Array<() => void> = []

export const prefsStore = {
  get: (): FocusPrefs => prefs,
  set: (next: FocusPrefs) => {
    prefs = next
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
    for (const l of listeners) l()
  },
  update: (patch: Partial<FocusPrefs>) => prefsStore.set({ ...prefs, ...patch }),
  subscribe: (l: () => void) => { listeners.push(l); return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1) } },
}

export function usePrefs(): FocusPrefs {
  const [p, setP] = useState<FocusPrefs>(prefsStore.get)
  useEffect(() => prefsStore.subscribe(() => setP(prefsStore.get)), [])
  return p
}

// ---- first-run onboarding flag (persisted so the intro shows only once) ----
export const ONBOARD_KEY = 'dsh-focus-overlay:onboarded'
export const ONBOARD_VERSION = '1'

export const onboardingStore = {
  isDone: (): boolean => {
    try { return onboardingSeen(localStorage.getItem(ONBOARD_KEY), ONBOARD_VERSION) } catch { return false }
  },
  markDone: () => {
    try { localStorage.setItem(ONBOARD_KEY, ONBOARD_VERSION) } catch { /* ignore */ }
  },
}

// ---- focus stats (counter + starred flag; bumped/written by FocusView) ----
const STATS_KEY = 'dsh-focus-overlay:stats'

/** `starred` records that the GitHub Star button has been used once — the
 *  card then offers a plain project-page button instead of asking again. */
interface FocusStats { entries: number; starred: boolean }

function loadStats(): FocusStats {
  try {
    const raw = localStorage.getItem(STATS_KEY)
    return { entries: readEntryCount(raw), starred: readStarred(raw) }
  } catch { return { entries: 0, starred: false } }
}

let stats: FocusStats = loadStats()
const statsListeners: Array<() => void> = []

function persistStats(next: FocusStats) {
  stats = next
  try { localStorage.setItem(STATS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  for (const l of statsListeners) l()
}

export const statsStore = {
  getEntries: (): number => stats.entries,
  isStarred: (): boolean => stats.starred,
  /** One focus-mode open. Writes through to localStorage (best effort); when
   *  storage is unavailable the in-memory value still counts for the session. */
  bumpEntries: () => persistStats({ ...stats, entries: stats.entries + 1 }),
  /** Mark the Star button as used (idempotent). */
  markStarred: () => { if (!stats.starred) persistStats({ ...stats, starred: true }) },
  subscribe: (l: () => void) => { statsListeners.push(l); return () => { const i = statsListeners.indexOf(l); if (i >= 0) statsListeners.splice(i, 1) } },
}

export function useEntryCount(): number {
  const [n, setN] = useState<number>(statsStore.getEntries)
  useEffect(() => statsStore.subscribe(() => setN(statsStore.getEntries)), [])
  return n
}

export function useStarred(): boolean {
  const [s, setS] = useState<boolean>(statsStore.isStarred)
  useEffect(() => statsStore.subscribe(() => setS(statsStore.isStarred)), [])
  return s
}
