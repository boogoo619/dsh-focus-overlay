import { useEffect, useState } from 'react'
import { onboardingSeen } from './model'

/** User preferences, persisted to localStorage (bundle plugins have full browser access). */
export interface FocusPrefs {
  navbar: boolean
  scroll: 'preserve' | 'bottom'
  width: number
  /** When enabled, a normally-completed reply auto-opens focus mode (or, if already open, shows a "new reply" reminder). */
  autoFocus: boolean
}

const KEY = 'dsh-focus-overlay:prefs'
const DEFAULTS: FocusPrefs = { navbar: true, scroll: 'preserve', width: 760, autoFocus: false }

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
