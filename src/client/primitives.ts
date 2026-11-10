/** Cross-release primitives resolution.
 *
 *  dsh keeps renaming/removing symbols in `@deepseek-ai/dsh-client-ui-primitives`
 *  between releases, and a stale named import resolves to `undefined` — React
 *  then throws #130 ("element type is invalid") the moment it renders. Two
 *  such breaks are already in this repo's history: `MessageText` (0.1.3) and
 *  the fixed-size icon variants (0.2). The 0.2.2 desktop runtime adds a third:
 *  `projectUserText` is gone.
 *
 *  The official user-text pipeline changed shape in 0.2.2: the conversation
 *  surface now parses text itself and renders inline nodes, falling back to
 *  the `UserTextRun` primitive (a plain inline run) for unmatched text. This
 *  module picks whichever projection the running primitives module actually
 *  exports, so one client bundle serves 0.1.2 through 0.2.2:
 *
 *  - dsh 0.1.2 … 0.2.0: `projectUserText(text, sessionLabels, …)` returns
 *    inline plain runs plus `@session` / `/skill` chips (the richer path).
 *  - dsh 0.2.2+: `UserTextRun` renders the text as a plain inline run; the
 *    overlay's bubble chrome still supplies `white-space: pre-wrap`, so the
 *    text keeps its shape. Reference chips in *user* text are the only
 *    cosmetic loss on that generation.
 *  - Anything else: return the raw string (React renders it as a text node).
 *
 *  Import the namespace once (not named symbols) so the resolver can never
 *  crash at module-evaluation time. */
import { createElement } from 'react'
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'

/** Render one user prompt's text through the projection the running dsh
 *  exports. `sessionLabels` feeds the older chip projection; newer
 *  generations ignore it. */
export function projectUserTextCompat(text: string, sessionLabels: string[] = []): any {
  const primitives = Primitives as any
  const project = primitives.projectUserText
  if (typeof project === 'function') {
    try {
      return project(text, sessionLabels)
    } catch {
      /* fall through to the newer / plain path */
    }
  }
  const UserTextRun = primitives.UserTextRun
  if (typeof UserTextRun === 'function') return createElement(UserTextRun, { text })
  return text
}
