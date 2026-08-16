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
.fm-nav{position:absolute;right:20px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:5px;z-index:2;pointer-events:auto}
.fm-nav-dot{position:relative;cursor:pointer;background:var(--dsw-alias-label-secondary,#999);border:0;border-radius:999px;width:8px;height:8px;padding:0;transition:background .15s,height .15s}
.fm-nav-dot:hover{background:var(--dsw-alias-brand-primary,#4c6ef5)}
.fm-nav-dot-active{background:var(--dsw-alias-brand-primary,#4c6ef5);height:22px;width:8px}
.fm-nav-tip{position:absolute;right:18px;top:50%;transform:translateY(-50%);display:none;width:260px;box-sizing:border-box;white-space:normal;overflow-wrap:break-word;word-break:break-word;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.12);pointer-events:none;text-align:left}
.fm-nav-dot:hover .fm-nav-tip{display:block}
.fm-tobottom-wrap{position:absolute;left:50%;transform:translateX(-50%);bottom:18px;z-index:2;pointer-events:none}
.fm-tobottom{pointer-events:auto;border-radius:100px;min-width:34px;height:34px;padding:0 10px}
.fm-settings{display:flex;flex-direction:column;gap:16px;max-width:560px;padding:8px 0}
.fm-setting-row{display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;user-select:none}
.fm-setting-row input[type="checkbox"]{width:16px;height:16px;cursor:pointer}
.fm-setting-row input[type="range"]{flex:1;max-width:240px;cursor:pointer}
`
