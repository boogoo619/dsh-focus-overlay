/** Package-owned stylesheet text (injected by the client apply, cleaned up on unload). */
import { LIFT_MAX_WIDTH } from './model'

export const FOCUS_CSS = `
.fm-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);display:flex;flex-direction:column;pointer-events:auto;font-family:var(--dsw-font-family,sans-serif);outline:none}
.fm-topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));flex:0 0 auto}
.fm-title{font-size:calc(14px + var(--dsh-content-font-delta,0px));font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fm-body-wrap{position:relative;flex:1 1 auto;display:flex;min-height:0}
.fm-body{flex:1 1 auto;min-width:0;overflow-y:auto;padding:28px 28px 160px}
.fm-inner{max-width:760px;margin:0 auto}
.fm-msg{margin:0}
.fm-user-msg{margin:0}
.fm-inner>*{margin:var(--dsh-chat-flow-gap,16px) 0 0}
.fm-inner>*:first-child{margin-top:0}
.fm-user{background:var(--dsw-specific-bubble,#eaf2ff);color:var(--dsw-alias-label-primary,#1a1a1a);font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));white-space:pre-wrap;word-break:break-word;border-radius:22px;padding:10px 16px;max-width:min(calc(var(--fm-content-width,748px) * .702),82%);margin-left:auto}
.fm-steering{opacity:.85}
.fm-assistant{word-break:break-word;font:var(--dsw-font-markdown-base,400 var(--dsh-content-font-size,14px)/calc(24px + var(--dsh-content-font-delta,0px)) var(--dsw-font-family,sans-serif))}
.fm-image{max-width:100%;border-radius:8px;margin:8px 0}
/* Classic process fold (normal mode, and the expanded work-part rows in
   compact): centered, muted, secondary typography. */
.fm-hidden{text-align:center;color:var(--dsw-alias-label-secondary,#888);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));padding:2px 0;user-select:none}
/* Turn process disclosure (compact 对话显示) — replica of the official
   TurnProcessNodeView row: 33px button, bottom hairline, chevron that
   rotates from -90deg to 0 when open, 8px breathing room when closed. */
.fm-process-root{box-sizing:border-box;border:none;border-bottom:.5px solid var(--dsw-alias-border-l2);width:100%;min-width:0;height:33px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;background:0 0;align-items:center;padding:0 0 8px;display:flex;font:inherit}
.fm-process-root:not([data-open]){margin-bottom:8px}
.fm-process-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;line-height:24px;overflow:hidden}
.fm-process-chevron{width:16px;height:16px;color:var(--dsw-alias-label-tertiary);flex:none;margin-left:6px;transition:transform .1s;transform:rotate(-90deg)}
.fm-process-root[data-open] .fm-process-chevron{transform:rotate(0)}
@media (prefers-reduced-motion:reduce){.fm-process-chevron{transition:none}}
.fm-error{color:var(--dsw-alias-state-error-primary,#d23);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:pre-wrap}
/* "正在工作" live line — the shimmer is a 1:1 replica of the official
   generating indicator in dsh-client-ui-conversation (the "Deep Diving"
   turn-status): brand-blue text (--dsw-static-deepseek-500) with a light
   highlight (--dsw-static-deepseek-200) sweeping through — gradient stops
   0/40/50/60/100 on a 250% tile, background-position 100%→0, 1.8s linear,
   font --dsw-font-s-strong-14 (500 14px/22px). The official class name
   (Md3f7G_turnStatus) is a per-build CSS-modules hash, so reusing it would
   break silently on dsh updates — the declarations are copied verbatim onto
   our own class using the same theme tokens instead. The flanking short
   dashes are part of the same shimmer span, so the sweep covers dashes and
   label as one unit. Fallbacks: no background-clip:text → secondary gray
   label; prefers-reduced-motion → animation off, label stays solid
   deepseek-500 (the official base color). */
.fm-running{text-align:center;user-select:none;animation:fm-up .18s ease}
.fm-running-text{color:var(--dsw-alias-label-secondary,#888);font:500 var(--dsh-content-font-size,14px)/calc(22px + var(--dsh-content-font-delta,0px)) var(--dsw-font-family,sans-serif);white-space:nowrap}
/* Dashes: separate spans with fixed margins instead of space characters — in
   CJK/Latin mixed runs the browser itemizes the two U+0020 spaces into
   different fonts (one Latin-narrow, one Han-wide), and the Han font's en
   dash glyph is left-biased, which made the two gaps visually unequal. The
   forced Latin-first stack renders a symmetric en dash; margins are exact. */
.fm-running-dash{font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;margin:0 8px}
@supports ((-webkit-background-clip:text) or (background-clip:text)){
.fm-running-text{background:linear-gradient(90deg,var(--dsw-static-deepseek-500,#4176e6) 0%,var(--dsw-static-deepseek-500,#4176e6) 40%,var(--dsw-static-deepseek-200,#d3e2ff) 50%,var(--dsw-static-deepseek-500,#4176e6) 60%,var(--dsw-static-deepseek-500,#4176e6) 100%);color:#0000;-webkit-text-fill-color:transparent;background-position:100% 0;background-size:250% 100%;-webkit-background-clip:text;background-clip:text;animation:fm-sweep 1.8s linear infinite}
}
@keyframes fm-sweep{to{background-position:0 0}}
@media (prefers-reduced-motion:reduce){.fm-running{animation:none}.fm-running-text{background:0 0;color:var(--dsw-static-deepseek-500,#4176e6);-webkit-text-fill-color:currentColor;animation:none}}
.fm-empty{color:var(--dsw-alias-label-secondary,#888);padding:48px 16px;text-align:center}
.fm-reply-toast{position:absolute;left:50%;transform:translateX(-50%);bottom:84px;z-index:2;display:flex;align-items:center;gap:10px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:100px;padding:8px 8px 8px 16px;box-shadow:var(--dsw-shadow-lv2,0 4px 16px rgba(0,0,0,.12));font-size:var(--dsh-content-font-size-secondary,13px)}
.fm-reply-toast-dot{width:8px;height:8px;border-radius:999px;background:var(--dsw-static-deepseek-500,#4176e6);flex:0 0 auto}
.fm-reply-toast-text{white-space:nowrap}
/* ---- official-composer borrow: the lifted input bar ----
   The main view's composer seat ([data-composer-seat], normally in the
   conversation scroll flow UNDER this overlay) is re-anchored above the
   overlay while the dock wants the bar form. Its ancestor chain has no
   transform/filter/positioned-z traps (verified against the 0.1.2 build),
   so position:fixed escapes to the viewport; the z-index sits just above
   .fm-overlay's 2147483000 and below the int32 ceiling. The slash/@ menus
   are descendants of the composer card, so they lift with it.
   The seat itself must paint NOTHING: it is a layout box larger than the
   composer card (hero variant stacks brand/workspace rows above it), so a
   seat-level background or shadow would draw a translucent SQUARE behind
   the rounded card. Only the card's own skin shows; the seat's empty area
   is click-transparent so the reading surface beneath stays interactive. */
.fm-lift{position:fixed!important;left:50%!important;right:auto!important;top:auto!important;bottom:20px!important;transform:translateX(-50%)!important;width:min(var(--fm-lift-width,${LIFT_MAX_WIDTH}px),calc(100vw - 48px))!important;max-width:calc(100vw - 48px)!important;z-index:2147483200!important;margin:0!important;box-shadow:none!important;background:0 0!important;pointer-events:none}
/* The composer's dock row (queue/references rail) is hidden while lifted on
   purpose: focus mode's dock is the plugin's own bottom-center region, and a
   second rail inside the floating bar would duplicate it. Noteboard's canvas
   borrow does the same. This drops that row's affordances IN FOCUS MODE only
   (the main view keeps them); revisit if a focus-mode user needs them. */
.fm-lift [data-slot="conversation.composer.dock"]{display:none!important}
.fm-lift [data-composer-card]{pointer-events:auto}
/* Cap the lifted editor's scroll area: a long multi-line draft must not grow
   the floating card over half the reading surface (the main view allows the
   full composer column height, which focus mode cannot afford). */
.fm-lift [data-input-scroll]{max-height:180px!important;overscroll-behavior:contain}
/* ---- bottom dock: bar / pill / jump-to-bottom / answer card ----
   Visual language mirrors the official composer cards token-for-token
   (ui-conversation InputBar/QuestionComposer, ui-user-questions
   PlanReviewPanel): --dsw-specific-input-major surfaces, 20–22px radii,
   --dsw-shadow-lv2, the 34px round info-fill primary button, interactive-
   hover option tinting. */
.fm-dock{position:absolute;left:50%;transform:translateX(-50%);bottom:18px;z-index:3;width:calc(100% - 96px);display:flex;justify-content:center;pointer-events:none}
.fm-dock>*{pointer-events:auto;animation:fm-up .18s ease}
.fm-bar{box-sizing:border-box;width:100%;background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);border:1px solid var(--dsw-alias-border-l2-darkmode-thin,rgba(0,0,0,.12));box-shadow:var(--dsw-shadow-lv2,0 4px 16px rgba(0,0,0,.12));border-radius:22px;padding-top:10px;display:flex;flex-direction:column;font-size:calc(var(--dsh-content-font-size,14px) + 2px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}
.fm-bar-row{display:flex;align-items:flex-end;gap:12px;min-width:0;padding:2px 8px 6px}
/* flex-end anchors the send button to the row's bottom edge, so a multi-line
   draft grows the textarea upward and the button's distance to the bar's
   bottom-right corner never moves. */
.fm-bar-text{flex:1 1 auto;min-height:28px;max-height:120px;resize:none;color:inherit;caret-color:var(--dsw-alias-state-business-primary,var(--dsw-static-deepseek-500,#4176e6));background:0 0;border:none;outline:none;font:inherit;font-size:inherit;line-height:inherit;padding:4px 12px 0 16px}
.fm-bar-text::placeholder{color:var(--dsw-alias-label-caption,#999);user-select:none}
.fm-bar-note{margin:4px 12px 0;border-radius:8px;padding:4px 8px;font-size:12px;line-height:18px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-secondary,#888)}
.fm-bar-note-error{color:var(--dsw-alias-state-error-primary,#d23);word-break:break-word}
.fm-bar-queue{flex:0 0 auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#888);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));border-radius:999px;padding:2px 10px;margin-bottom:7px;white-space:nowrap}
.fm-bar-send{width:34px;height:34px;display:grid;place-items:center;flex:none;cursor:pointer;border:none;border-radius:999px;background:var(--dsw-alias-button-info-fill,#4176e6);color:#fff;transform:translateY(-2px);transition:background-color .1s;padding:0}
.fm-bar-send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,#3560c4)}
.fm-bar-send:disabled{opacity:.4;cursor:default}
.fm-pill{position:relative;display:grid;place-items:center;width:38px;height:38px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2-darkmode-thin,rgba(0,0,0,.12));background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-secondary,#666);cursor:pointer;box-shadow:var(--dsw-shadow-lv2,0 4px 16px rgba(0,0,0,.12));transition:color .12s;padding:0}
.fm-pill:hover{color:var(--dsw-alias-label-primary,#1a1a1a)}
.fm-pill-dot{position:absolute;top:4px;right:4px;width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-state-business-primary,var(--dsw-static-deepseek-500,#4176e6))}
.fm-card{box-sizing:border-box;width:100%;background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);border:1px solid var(--dsw-alias-border-l2-darkmode-thin,rgba(0,0,0,.12));box-shadow:var(--dsw-shadow-lv2,0 4px 16px rgba(0,0,0,.12));border-radius:20px;display:flex;flex-direction:column;max-height:min(60vh,520px);overflow:hidden;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.fm-card *{box-sizing:border-box}
.fm-card-approval{border-color:var(--dsw-alias-state-warn-secondary,#e6a23c)}
.fm-card-head{flex:0 0 auto;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:20px 16px 0 24px}
.fm-card-approval .fm-card-head{background:var(--dsw-alias-state-warn-tertiary,rgba(230,162,60,.12));color:var(--dsw-alias-state-warn-primary,#9a6b12);align-items:center;padding:10px 16px}
.fm-card-heading{min-width:0}
.fm-card-eyebrow{color:var(--dsw-alias-label-tertiary,#999);margin:0 0 5px;font-size:11px;line-height:16px}
.fm-card-title{margin:0;font-size:16px;font-weight:500;line-height:22px}
.fm-card-strip-title{font-size:13px;line-height:18px;flex:1;min-width:0}
.fm-card-dot{background:var(--dsw-alias-state-warn-primary,#9a6b12);border-radius:50%;width:8px;height:8px;flex:none}
.fm-card-close{width:24px;height:24px;display:grid;place-items:center;flex:none;cursor:pointer;border:none;border-radius:999px;background:0 0;color:var(--dsw-alias-label-tertiary,#999);padding:0}
.fm-card-close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1a1a1a)}
.fm-card-approval .fm-card-close,.fm-card-approval .fm-card-close:hover:not(:disabled){color:inherit}
.fm-card-body{overscroll-behavior:contain;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow-y:auto;padding-bottom:8px;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px))}
.fm-card-q{display:flex;flex-direction:column}
.fm-card-q-text{margin:0 2px 8px;padding:0 22px;white-space:pre-wrap;word-break:break-word;font-size:calc(var(--dsh-content-font-size,14px) + 2px);font-weight:500;line-height:calc(22px + var(--dsh-content-font-delta,0px))}
.fm-card-detail{color:var(--dsw-alias-label-secondary,#888);margin:0 2px 8px;padding:0 22px;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px))}
.fm-card-opts{display:flex;flex-direction:column;gap:1px;margin:8px 0 0;padding:4px 12px}
.fm-opt{width:100%;min-height:40px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:1px solid #0000;border-radius:12px;flex-shrink:0;display:flex;align-items:flex-start;gap:8px;padding:8px 12px 8px 8px;transition:background-color .12s,border-color .12s;font:inherit}
.fm-opt:hover:not(:disabled),.fm-opt-on{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.fm-opt-on{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.18))}
.fm-opt-num{background:var(--dsw-alias-bg-overlay,#fff);width:20px;height:20px;color:var(--dsw-alias-label-secondary,#888);border-radius:6px;flex:0 0 20px;display:grid;place-items:center;margin-top:2px;font-size:12px;font-weight:500;line-height:18px}
.fm-opt-check{flex:0 0 20px;width:20px;height:20px;margin-top:2px;display:grid;place-items:center;position:relative;color:var(--dsw-alias-label-primary-foreground,#fff)}
.fm-opt-check::before{content:'';border:1px solid var(--dsw-alias-border-l4,rgba(0,0,0,.25));border-radius:4px;width:14px;height:14px;grid-area:1/1;transition:background-color .12s,border-color .12s}
.fm-opt-check-on::before{border-color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-label-primary,#1a1a1a)}
.fm-opt-check>*{grid-area:1/1}
.fm-opt-copy{flex:1;min-width:0}
.fm-opt-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 6px}
.fm-opt-label{font-size:var(--dsh-content-font-size,14px);font-weight:500;line-height:calc(24px + var(--dsh-content-font-delta,0px));word-break:break-word}
.fm-opt-badge{background:var(--dsw-specific-sidebar-nav-item-active-accent,rgba(65,118,230,.12));color:var(--dsw-alias-button-info-fill,#4176e6);border-radius:6px;padding:0 4px;font-size:11px;font-weight:600;line-height:18px}
.fm-opt-desc{color:var(--dsw-alias-label-tertiary,#999);font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));word-break:break-word}
.fm-card-custom{margin:0 12px;border:1px solid #0000;border-radius:12px;flex-shrink:0;display:flex;align-items:center;min-height:40px;padding:8px 12px;transition:background-color .12s,border-color .12s}
.fm-card-custom:hover,.fm-card-custom:focus-within{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.fm-card-custom:focus-within{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.18))}
.fm-card-field{min-width:0;width:100%;border:none;outline:none;background:0 0;color:inherit;font:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));padding:0}
.fm-card-field::placeholder{color:var(--dsw-alias-label-caption,#999)}
.fm-card-foot{flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 16px 12px}
.fm-card-err{flex:1 1 auto;min-height:16px;color:var(--dsw-alias-state-error-primary,#d23);font-size:11px;line-height:16px;word-break:break-word}
.fm-card-actions{display:flex;align-items:center;gap:8px;flex:none}
@keyframes fm-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.fm-plugin-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.fm-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.fm-plugin-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.fm-plugin-card-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.fm-plugin-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.fm-plugin-card-headtext{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.fm-plugin-card-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.fm-plugin-card-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.fm-plugin-card-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
.fm-plugin-card-chevron-open{transform:rotate(180deg)}
.fm-plugin-card-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:16px}
.fm-plugin-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.fm-plugin-field+.fm-plugin-field{border-top:1px solid var(--dsw-alias-border-l2)}
/* The stats row ends the card body, so it carries NO bottom padding of its
   own — the body's 16px padding-bottom is the entire below-gap, matching the
   row's 16px above-gap after the divider (symmetric, one rhythm). */
.fm-plugin-field-stat{padding:16px 0 0}
.fm-plugin-field-head{align-items:center;gap:8px;display:flex}
.fm-plugin-field-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.fm-plugin-field-value{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.fm-plugin-field-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.fm-plugin-check{align-items:center;gap:8px;display:flex;cursor:pointer;user-select:none}
.fm-plugin-check input[type="checkbox"]{width:16px;height:16px;margin:0;cursor:pointer;accent-color:var(--dsw-static-deepseek-500,#4176e6)}
.fm-plugin-check-label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.fm-plugin-range{width:100%;max-width:280px;cursor:pointer;accent-color:var(--dsw-static-deepseek-500,#4176e6)}
/* DSH-better-sidebar compatibility: its panel host (top-right toggle cluster +
   right/bottom panels) is appended to document.body at z-index 40/45, above
   shell.overlay's z-20 layer, so this overlay cannot cover it. Hide the host
   while focus is on, and neutralize the #root layout push it applies when its
   panels are open. Selectors mirror better-sidebar's own layout.css exactly. */
body[data-fm-focus] [data-dsh-panel-host]{display:none!important}
body[data-fm-focus] #root{margin-right:0!important;width:100%!important}
body[data-fm-focus] #root [data-dsh-frame] > [data-pane="conversation"],
body[data-fm-focus] #root :has(> [data-slot="conversation"]){margin-bottom:0!important}
/* First-run onboarding (settings.onboarding step) — content inside the official
   Modal primitive; the primitive owns the mask/dialog chrome, these style our body. */
.fm-onboard{width:min(600px,100%);padding:0}
.fm-onboard-content{box-sizing:border-box;flex-direction:column;max-height:calc(100vh - 48px);padding:28px;display:flex;overflow-y:auto}
.fm-onboard-title{color:var(--dsw-alias-label-primary);outline:none;margin:0;font-size:20px;font-weight:500;line-height:28px}
.fm-onboard-intro{color:var(--dsw-alias-label-secondary);margin:8px 0 0;font-size:14px;line-height:22px}
.fm-onboard-subtitle{color:var(--dsw-alias-label-primary);margin:20px 0 8px;font-size:14px;font-weight:600;line-height:22px}
.fm-onboard-features{margin:0;padding:0 0 0 18px;list-style:disc;display:flex;flex-direction:column;gap:6px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.fm-onboard-note{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:18px}
.fm-onboard-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
@media (width<=560px){.fm-onboard-content{padding:24px}}
`

// ---- shared style injection (component-owned stylesheets) ----

const injectedStyles = new Map<string, HTMLStyleElement>()

/** Inject a named package stylesheet once and return a dispose function. The
 *  map keeps duplicates out across mount/unmount cycles; the dispose removes
 *  the element so plugin unload (or the component's effect cleanup) never
 *  leaks <style> nodes. */
export function injectStyle(id: string, css: string): () => void {
  if (typeof document === 'undefined') return () => {}
  let el = injectedStyles.get(id)
  if (!el) {
    el = document.createElement('style')
    el.setAttribute('data-plugin', 'dsh-focus-overlay')
    el.setAttribute('data-fm-style', id)
    el.textContent = css
    document.head.appendChild(el)
    injectedStyles.set(id, el)
  }
  const node = el
  return () => {
    node.remove()
    injectedStyles.delete(id)
  }
}
