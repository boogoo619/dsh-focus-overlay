// Node half: register the `dsh-focus-overlay` settings namespace on the dsh
// generations that still serve one, so the Settings → Plugins card
// (`settings.plugin.item`, keyed by namespace) is dispatched there. All overlay
// behaviour still lives in the client bundle (lib/client.js).
//
// dsh 0.2 removed the whole contract this half existed for: the Settings card
// slot is gone (the browser half now registers the sidebar Plugins page's
// `plugins.bundle.config` instead) and `ctx.settings` is a form service with no
// `register`. The guard below therefore no-ops there — the browser card stores
// its preferences in localStorage and needs no served namespace either way.
import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by this plugin (must match /^[a-z][a-z0-9-]*$/). */
export const NAMESPACE = 'dsh-focus-overlay'

/** Durable settings schema; defaults mirror the browser localStorage DEFAULTS. */
export const FocusSettingsSchema = z.object({
  navbar: z.boolean().default(true),
  scroll: z.union(['preserve', 'bottom']).default('preserve'),
  width: z.number().default(760),
  autoFocus: z.boolean().default(false),
  hotkey: z.boolean().default(true),
})

export default function apply(ctx) {
  // Register the settings namespace only while a settings provider that still
  // has `register` is mounted. On dsh >= 0.1.0-rc.7 (and < 0.2) this "serves"
  // the namespace so the keyed card in the Plugins tab is dispatched; older dsh
  // has no served-namespace ledger and its list-slot card renders without it.
  // The call is guarded so a dsh whose settings contract differs cannot take
  // the whole plugin down — the overlay itself lives entirely in the client
  // bundle.
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings
    if (!settings || typeof settings.register !== 'function') return
    try {
      settings.register(NAMESPACE, FocusSettingsSchema)
    } catch (error) {
      console.warn('[dsh-focus-overlay] settings namespace registration failed:', error)
    }
  })
}
