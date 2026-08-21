/** Package-owned stylesheet text (injected by the client apply, cleaned up on unload). */
export const FOCUS_CSS = `
.fm-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);display:flex;flex-direction:column;pointer-events:auto;font-family:var(--dsw-font-family,sans-serif);outline:none}
.fm-topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));flex:0 0 auto}
.fm-title{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fm-body{flex:1 1 auto;overflow-y:auto;padding:28px 28px 64px}
.fm-inner{max-width:760px;margin:0 auto}
.fm-msg{margin:0 0 24px}
.fm-user-msg{margin-bottom:44px}
.fm-user{background:var(--dsw-specific-bubble,#eaf2ff);color:var(--dsw-alias-label-primary,#1a1a1a);border-radius:14px;padding:10px 14px;word-break:break-word;max-width:85%;margin-left:auto}
.fm-steering{opacity:.85}
.fm-assistant{word-break:break-word}
.fm-image{max-width:100%;border-radius:8px;margin:8px 0}
.fm-hidden{text-align:center;color:var(--dsw-alias-label-secondary,#888);font-size:12px;line-height:1.6;margin:6px 0 18px;user-select:none}
.fm-error{color:var(--dsw-alias-state-error-primary,#d23);font-size:13px;white-space:pre-wrap}
.fm-running{color:var(--dsw-alias-label-secondary,#888);font-size:13px;margin:6px 0 16px}
.fm-empty{color:var(--dsw-alias-label-secondary,#888);padding:48px 16px;text-align:center}
.fm-nav{position:absolute;right:20px;top:50%;transform:translateY(-50%);display:block;width:16px;z-index:2;pointer-events:auto;transition:transform .18s ease}
.fm-nav:hover{transform:translateY(-50%) translateX(-6px)}
.fm-nav-dot{position:absolute;left:50%;transform:translate(-50%,-50%);cursor:pointer;background:transparent;border:0;padding:0;width:16px;height:auto;display:flex;align-items:center;justify-content:center;transition:top .22s ease}
.fm-nav-dot::after{content:'';position:absolute;inset:-5px -8px}
.fm-nav-dot-core{display:block;width:8px;height:8px;border-radius:999px;background:var(--dsw-alias-label-secondary,#999);opacity:.45;transition:opacity .15s ease,background .15s ease,height .15s ease,transform .18s ease}
.fm-nav:hover .fm-nav-dot:not(.fm-nav-dot-active) .fm-nav-dot-core{transform:scale(1.15);opacity:.9}
.fm-nav-dot:not(.fm-nav-dot-active):hover .fm-nav-dot-core{background:var(--dsw-static-deepseek-500,#4176e6);opacity:1;transform:scale(1.5)}
.fm-nav-dot-active .fm-nav-dot-core{background:var(--dsw-static-deepseek-500,#4176e6);height:22px;opacity:1}
.fm-nav-tip{position:absolute;right:calc(100% + 8px);top:50%;transform:translateY(-50%);display:none;width:260px;box-sizing:border-box;white-space:normal;overflow-wrap:break-word;word-break:break-word;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.12);pointer-events:none;text-align:left}
.fm-nav-dot:hover .fm-nav-tip{display:block}
.fm-tobottom-wrap{position:absolute;left:50%;transform:translateX(-50%);bottom:18px;z-index:2;pointer-events:none}
.fm-tobottom{pointer-events:auto;border-radius:100px;min-width:34px;height:34px;padding:0 10px}
.fm-reply-toast{position:absolute;left:50%;transform:translateX(-50%);bottom:64px;z-index:2;display:flex;align-items:center;gap:10px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:100px;padding:8px 8px 8px 16px;box-shadow:0 4px 16px rgba(0,0,0,.12);font-size:13px}
.fm-reply-toast-dot{width:8px;height:8px;border-radius:999px;background:var(--dsw-static-deepseek-500,#4176e6);flex:0 0 auto}
.fm-reply-toast-text{white-space:nowrap}
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
.fm-plugin-card-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:12px}
.fm-plugin-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.fm-plugin-field+.fm-plugin-field{border-top:1px solid var(--dsw-alias-border-l2)}
.fm-plugin-field-head{align-items:center;gap:8px;display:flex}
.fm-plugin-field-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.fm-plugin-field-value{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.fm-plugin-field-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.fm-plugin-check{align-items:center;gap:8px;display:flex;cursor:pointer;user-select:none}
.fm-plugin-check input[type="checkbox"]{width:16px;height:16px;margin:0;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#4176e6)}
.fm-plugin-check-label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.fm-plugin-range{width:100%;max-width:280px;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#4176e6)}
`
