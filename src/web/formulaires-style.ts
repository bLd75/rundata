/** The look of the clubs' and associations' forms (web/propositions.ts), in the stylesheet of every page (pages.ts). */
export const FORMS_CSS = `.fo{max-width:44rem}
.fo label,.fo legend{font-weight:600;font-size:.92rem}
.fo .f{display:grid;gap:.3rem}
.fo input:not([type=checkbox]):not([type=radio]),.fo textarea,.fo select{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:.6rem .75rem;width:100%}
.fo textarea{min-height:4.5rem;resize:vertical}
.fo .row{display:flex;flex-wrap:wrap;gap:.8rem}
.fo .row>.f{flex:1 1 12rem}
.fo .row.court>.f{flex-basis:8rem}
.fo .case{display:flex;gap:.6rem;align-items:flex-start;font-weight:400}
.fo .case input{margin-top:.25rem;width:1.15rem;height:1.15rem;flex:none}
.fo fieldset{border:0;padding:0;margin:0;display:grid;gap:.4rem}
.fo .aide{font-size:.86rem;color:var(--muted);font-weight:400}
.fo .aide.bloc{display:block;margin-top:.15rem}
.fo [hidden]{display:none!important}
.fo .faux{color:var(--lave);font-size:.88rem;font-weight:600}
.fo [aria-invalid=true]{border-color:var(--lave)!important;border-width:2px!important}
.fo button{font:700 1rem system-ui,sans-serif;background:var(--accent);color:var(--accent-ink);border:0;border-radius:12px;padding:.75rem 1.4rem;cursor:pointer;justify-self:start}
.fo .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.fo .msg{display:none;font-weight:700;border-radius:10px;padding:.6rem .8rem;background:var(--warn-bg);color:var(--lave)}
.fo .msg.ok{background:var(--surface-2);color:var(--ink);border-left:4px solid var(--ren)}
.fo .msg:target,.fo .msg.vu{display:block}`.replace(/\n/g, "");
