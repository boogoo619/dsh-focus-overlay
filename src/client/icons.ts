/** Cross-release product-icon resolution.
 *
 *  The official primitives package renamed its icon set in dsh 0.2: the
 *  fixed-size artwork variants (`IconCheckOutline14`, `IconChevronDownOutline14`,
 *  `IconEditOutline16`, `IconSendOutline14`) were removed, leaving one
 *  `…OutlineRegular` / `…OutlineMedium` component per glyph that takes an
 *  explicit `size` prop. A stale named import therefore resolves to
 *  `undefined`, and React throws #130 ("element type is invalid") the moment
 *  the component renders — the same failure mode the 0.1.3 `MessageText`
 *  removal produced.
 *
 *  Import the namespace once and pick the first name the running build exports,
 *  so one bundle serves both generations. Each fallback carries the size the
 *  removed variant was drawn at, keeping layout identical across releases. */
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'

/** The icon props every generation accepts (0.2 also accepts `size`). */
export interface FocusIconProps {
  size?: number
  className?: string
}

type IconComponent = (props: FocusIconProps) => any

function pick(names: string[], size: number): IconComponent {
  for (const name of names) {
    const component = (Primitives as any)[name]
    if (typeof component === 'function') return (props: FocusIconProps) => component({ size, ...props })
  }
  // No released variant resolved: render nothing rather than letting an
  // `undefined` element type abort the overlay's render.
  return () => null
}

export const IconCheck = pick(['IconCheckOutline14', 'IconCheckOutlineRegular'], 14)
export const IconChevronDown = pick(['IconChevronDownOutline14', 'IconChevronDownOutlineRegular'], 14)
export const IconEdit = pick(['IconEditOutline16', 'IconEditOutlineRegular'], 16)
export const IconSend = pick(['IconSendOutline14', 'IconSendOutlineRegular'], 14)
