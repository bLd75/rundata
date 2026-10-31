/**
 * The points of every map that leads somewhere (map.ts: a marker of the island, a spot of a commune), one code for all.
 *
 * With a mouse, a bubble names the point under it: its name, then its kind or its value, then its address or its time,
 * from its `data-pn`, `data-p2` and `data-p3` (written by map.ts; a marker with a bubble of its own has its name in `data-tp`), in place of the browser's slow tooltip. The maps
 * that have a bubble of their own (/meteo, the home page's: `[data-mtip]`) keep it. Under its lines, its direct links:
 * « Voir la fiche → » (the point's own link), and for a point whose row is on the page, the row's « Y aller » (as the
 * row shows it, under a cyclone alert too; not from a commune's card of several places) and the place's site (the row's
 * `data-site`). Once the pointer has rested on the point (ARM_MS), it stays open while the pointer goes from the point
 * to it (LINGER_MS), over a band that joins them (other points under that band are passed over), and a click on it,
 * outside its links, is a click on the point. It closes with Échap or a click elsewhere. From the keyboard, a point's
 * bubble opens on its focus (not on a tap's), and Tab goes into it.
 *
 * On a commune's map, the point under the mouse is found by the distance on screen, the nearest within MOUSE_PX: its
 * hit area is in the map's units, made for a finger on a phone, and grows with the map on a wide screen and with the
 * zoom (31/10/2026: the bubble then named another point than the one under the pointer, one time out of two). While the
 * mouse moves over the map, that point alone takes the pointer (`.vise`, the others `pointer-events:none`), so that the
 * browser's own click, and the page's handling of it (a double click held, web/carte-zoom.ts), go to it; none within
 * MOUSE_PX, none.
 *
 * With a finger, a point is small and its neighbours close: a tap takes the nearest point within TAP_PX of it, even
 * one whose own hit area is under another's, never one out of the map's frame (a map zoomed in). When several are
 * that close, a short list of their names offers them; more than LIST_MAX, a map that zooms (it handles `pzoom` and
 * cancels it) zooms in on the tap instead, until the list is short or it can zoom no more. A drag or a pinch is not a tap.
 *
 * Where the finger was is read from the pointer's events, not the click's, which the browser may move onto the link it
 * guesses (Chrome's and Safari's touch adjustment). The point taken gets the tap as if touched itself, so that each
 * page's own handling follows: a row marked, a page opened, a bubble opened. A marker with a bubble (`data-tp`) always
 * gets it so, since its bubble opens on a finger's tap only when the finger went down on the marker itself.
 *
 * A point whose link is a row of the page, and whose page did not handle its click, leads to that row: its category
 * opened if folded (<details>, around it or in it: a commune's card), the row brought into view and marked as a link to
 * it marks it (`.tgt:target`).
 */

/** Around a finger's tap, in CSS pixels: the half of the 44 px a finger covers. */
export const TAP_PX = 22;
/** Around the mouse, in CSS pixels, on a commune's map: a point's dot and a little around it. */
export const MOUSE_PX = 14;
/** More points than this under a finger: a map that zooms (`pzoom`, the children's map of a commune) zooms there first. */
export const LIST_MAX = 5;
/** The time the bubble waits for the pointer to come into it, once off its point. */
export const LINGER_MS = 400;
/**
 * The time the pointer rests on a point before its bubble takes the pointer: until then the pointer goes through it,
 * to the points under it, as it passes over the map.
 */
export const ARM_MS = 300;

/** The bubble's links: data-run's words. */
// A marker names another word for its link in `data-pv` (an event's point leads to its announcement).
export const MOTS = {
  detail: "Voir la fiche →",
  annonce: "Voir l'annonce →",
  site: "Site du lieu",
};

export const POINTS_SCRIPT = `(()=>{const maps=[...document.querySelectorAll("svg.map")].filter((s)=>s.querySelector("a.mk,a.sp"));if(!maps.length&&!document.querySelector("template.carte"))return;
const R=${TAP_PX},LIST=${LIST_MAX},M=${MOUSE_PX},T=${JSON.stringify(MOTS)},mk=(c,t)=>{const e=document.createElement(c);if(t)e.className=t;return e};
const lines=(a)=>[a.dataset.pn||a.dataset.tp,a.dataset.p2,a.dataset.p3].filter(Boolean);
const mid=(a)=>{const h=a.querySelector(".hit");const r=(h||a).getBoundingClientRect();return r.width?[r.left+r.width/2,r.top+r.height/2]:null};
const row=(a)=>{const h=a.getAttribute("href")||"";return h.length>1&&h[0]==="#"?document.getElementById(h.slice(1)):null};
const voir=(t)=>{const d=t.closest("details")||t.querySelector(":scope>details");if(d)d.open=true;if(location.hash!=="#"+t.id){location.hash=t.id;return}t.scrollIntoView({block:"start"});t.style.animation="none";t.offsetWidth;t.style.animation=""};
const tip=mk("div","ptip");tip.hidden=true;tip.setAttribute("aria-hidden","true");document.body.append(tip);
let on=null,shut=0,arm=0,pass=null;
const hide=()=>{clearTimeout(shut);clearTimeout(arm);shut=0;tip.hidden=true;tip.classList.remove("vu","lien","prise");tip.setAttribute("aria-hidden","true");tip.removeAttribute("role");tip.removeAttribute("aria-label");tip.replaceChildren();on=null};
const later=()=>{if(on&&!shut)shut=setTimeout(hide,${LINGER_MS})},stay=()=>{clearTimeout(shut);shut=0};
const place=(a)=>{const c=mid(a);if(!c){hide();return}const w=tip.offsetWidth,h=tip.offsetHeight,x=Math.min(Math.max(c[0]-w/2,6),innerWidth-w-6),up=c[1]-h-20>=0;
tip.classList.toggle("bas",!up);tip.style.left=x+scrollX+"px";tip.style.top=(up?c[1]-h-20:c[1]+20)+scrollY+"px";tip.style.setProperty("--ax",Math.min(Math.max(c[0]-x,14),w-14)+"px")};
const links=(a)=>{const h=a.getAttribute("href");if(!h)return[];const r=row(a),v=mk("a","pv");v.href=h;v.textContent=T[a.dataset.pv]||T.detail;
if(r)v.addEventListener("click",(e)=>{e.preventDefault();hide();fire(a)});const out=[v],ya=r?r.querySelectorAll("a.aller"):[];if(ya.length===1)out.push(ya[0].cloneNode(true));
const site=r&&r.dataset.site;if(site){const l=mk("a");l.href=site;l.rel="noopener";l.textContent=T.site+" ↗";out.push(l)}return out};
const show=(a)=>{stay();if(on===a)return;const l=lines(a);if(!l.length||!mid(a)){hide();return}on=a;tip.classList.remove("vu","prise");clearTimeout(arm);arm=setTimeout(()=>tip.classList.add("prise"),${ARM_MS});
const parts=l.map((x,i)=>{const e=mk(i?"span":"b");e.textContent=x;return e}),ln=links(a);
if(ln.length){const p=mk("p","pl");p.append(...ln);parts.push(p);tip.classList.add("lien");tip.removeAttribute("aria-hidden");tip.setAttribute("role","group");tip.setAttribute("aria-label",l[0])}
else{tip.classList.remove("lien");tip.setAttribute("aria-hidden","true");tip.removeAttribute("role");tip.removeAttribute("aria-label")}
tip.replaceChildren(...parts);tip.hidden=false;place(a);requestAnimationFrame(()=>tip.classList.add("vu"))};
tip.addEventListener("pointerenter",stay);tip.addEventListener("pointerleave",later);tip.addEventListener("click",(e)=>{if(!on||e.target.closest("a"))return;const a=on;hide();fire(a)});
tip.addEventListener("keydown",(e)=>{const a=on;if(!a)return;const f=[...tip.querySelectorAll("a")];
if(e.key==="Escape"){e.preventDefault();e.stopPropagation();pass=a;hide();a.focus()}else if(e.key==="Tab"&&e.shiftKey&&document.activeElement===f[0]){e.preventDefault();a.focus()}
else if(e.key==="Tab"&&!e.shiftKey&&document.activeElement===f[f.length-1]){e.preventDefault();pass=a;hide();a.focus()}});
tip.addEventListener("focusout",(e)=>{if(!tip.contains(e.relatedTarget)&&e.relatedTarget!==on)later()});
const box=mk("div","pchoix");box.hidden=true;box.setAttribute("role","dialog");document.body.append(box);
const close=()=>{box.hidden=true;box.replaceChildren()};
let go=false;
const fire=(a)=>{close();go=true;try{if(a.matches("[data-tp]"))a.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerType:"touch"}));a.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}))}finally{go=false}};
const choose=(list,x,y)=>{const ul=mk("ul");list.forEach((a)=>{const b=mk("button");b.type="button";const l=lines(a);const n=mk("b");n.textContent=l[0]||a.getAttribute("aria-label")||"";b.append(n);
if(l[1]){const s=mk("span");s.textContent=l[1];b.append(s)}b.addEventListener("click",(e)=>{e.stopPropagation();fire(a)});const li=mk("li");li.append(b);ul.append(li)});
const x0=mk("button","x");x0.type="button";x0.setAttribute("aria-label","Fermer");x0.textContent="×";x0.addEventListener("click",close);box.replaceChildren(x0,ul);box.hidden=false;
const w=box.offsetWidth,h=box.offsetHeight;box.style.left=Math.min(Math.max(x-w/2,8),innerWidth-w-8)+scrollX+"px";box.style.top=(y+16+h<=innerHeight-8?y+16:Math.max(8,y-16-h))+scrollY+"px"};
document.addEventListener("pointerdown",(e)=>{if(!box.hidden&&!box.contains(e.target))close();if(on&&!tip.contains(e.target)&&!on.contains(e.target))hide()});
document.addEventListener("keydown",(e)=>{if(e.key==="Escape"){close();hide()}else if(e.key==="Tab"&&!e.shiftKey&&on&&document.activeElement===on&&tip.classList.contains("lien")){e.preventDefault();tip.querySelector("a").focus()}});
addEventListener("resize",()=>{close();hide()});
document.addEventListener("click",(e)=>{if(e.defaultPrevented||e.button||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;const a=e.target.closest&&e.target.closest("svg.map a.mk,svg.map a.sp"),r=a&&row(a);if(!r)return;e.preventDefault();hide();voir(r)});
const wire=(s)=>{const pts=()=>[...s.querySelectorAll("a.mk,a.sp")];const own=!!(s.closest("figure")||s.parentElement).querySelector("[data-mtip]");
const nearest=(x,y)=>{const b=s.getBoundingClientRect();let best=null,k=M;s.querySelectorAll("a.sp").forEach((a)=>{const c=mid(a);if(!c||c[0]<b.left||c[0]>b.right||c[1]<b.top||c[1]>b.bottom)return;const d=Math.hypot(c[0]-x,c[1]-y);if(d<=k){k=d;best=a}});return best};
if(!own){pts().forEach((a)=>{a.querySelectorAll("title").forEach((t)=>{if(!a.getAttribute("aria-label"))a.setAttribute("aria-label",t.textContent);t.remove()});
a.addEventListener("focus",()=>{if(pass!==a&&a.matches(":focus-visible"))show(a)});a.addEventListener("blur",(e)=>{if(pass===a)pass=null;if(!tip.contains(e.relatedTarget))later()});
if(a.matches(".mk")){a.addEventListener("pointerenter",(e)=>{if(e.pointerType==="mouse")show(a)});a.addEventListener("pointerleave",(e)=>{if(e.pointerType==="mouse")later()})}});
let vise=null;const aim=(a)=>{if(vise&&vise!==a)vise.classList.remove("vise");vise=a;if(a)a.classList.add("vise")};
s.addEventListener("pointermove",(e)=>{if(e.pointerType!=="mouse"||!s.querySelector("a.sp"))return;const a=nearest(e.clientX,e.clientY);s.classList.add("souris");aim(a);if(e.buttons){hide();return}
if(a)show(a);else if(on&&on.matches(".sp"))later()});
s.addEventListener("pointerleave",(e)=>{if(e.pointerType!=="mouse")return;s.classList.remove("souris");aim(null);if(on&&on.matches(".sp"))later()});
s.addEventListener("pointerdown",(e)=>{if(e.pointerType!=="mouse"){s.classList.remove("souris");aim(null)}},true);
new MutationObserver(()=>{if(!on||!s.contains(on))return;const c=mid(on),b=s.getBoundingClientRect();if(!c||c[0]<b.left||c[0]>b.right||c[1]<b.top||c[1]>b.bottom)hide();else place(on)}).observe(s,{attributes:true,attributeFilter:["viewBox"]})}
let down=null,up=null;s.addEventListener("pointerdown",(e)=>{if(go)return;down=e.pointerType==="mouse"?null:[e.clientX,e.clientY];up=null},true);
s.addEventListener("pointerup",(e)=>{if(down)up=[e.clientX,e.clientY]},true);
s.addEventListener("click",(e)=>{if(go)return;if(!down)return;
const d=down,u=up||d;down=up=null;if(Math.hypot(u[0]-d[0],u[1]-d[1])>10)return;
const b=s.getBoundingClientRect(),near=pts().map((a)=>[a,mid(a)]).filter(([,c])=>c&&c[0]>=b.left&&c[0]<=b.right&&c[1]>=b.top&&c[1]<=b.bottom).map(([a,c])=>[a,Math.hypot(c[0]-u[0],c[1]-u[1])]).filter(([,k])=>k<=R).sort((p,q)=>p[1]-q[1]).map(([a])=>a);
if(!near.length||(near.length===1&&near[0]===e.target.closest("a.mk,a.sp")&&!near[0].matches("[data-tp]")))return;e.preventDefault();e.stopPropagation();
if(near.length===1)fire(near[0]);else if(near.length<=LIST||s.dispatchEvent(new CustomEvent("pzoom",{cancelable:true,detail:{x:u[0],y:u[1]}})))choose(near,u[0],u[1])},true)};maps.forEach(wire);
document.addEventListener("carte",(e)=>{const s=e.target;if(s.matches&&s.matches("svg.map")&&s.querySelector("a.mk,a.sp"))wire(s)})})();`;

/** The bubble as /meteo's (.mtip), night in both themes; the list of close points the same, its rows wide enough for a finger. */
export const POINTS_CSS = `
.ptip{position:absolute;z-index:20;display:grid;gap:.1rem;max-width:16rem;padding:.5rem .75rem .55rem;border-radius:12px;background:#0f1d2c;color:#f1f5f9;
border:1px solid rgb(241 245 249/.12);box-shadow:0 1px 2px rgb(0 0 0/.3),0 10px 30px -8px rgb(0 0 0/.5);font-size:.85rem;line-height:1.3;pointer-events:none;
opacity:0;transform:translateY(4px);transition:opacity .12s ease-out,transform .12s ease-out}
.ptip[hidden],.pchoix[hidden]{display:none}.ptip.vu{opacity:1;transform:none}.ptip b{font-weight:600}.ptip span{color:#b4c6d8;font-size:.8rem}
.ptip::after{content:"";position:absolute;left:var(--ax,50%);bottom:-7px;width:12px;height:12px;background:#0f1d2c;border:solid rgb(241 245 249/.12);border-width:0 1px 1px 0;transform:translateX(-50%) rotate(45deg)}
.ptip.bas::after{bottom:auto;top:-7px;border-width:1px 0 0 1px}
svg.map.souris a.sp:not(.vise){pointer-events:none}
.ptip.lien.prise{pointer-events:auto;cursor:pointer}.ptip.lien.prise::before{content:"";position:absolute;left:0;right:0;top:100%;height:26px}.ptip.lien.prise.bas::before{top:auto;bottom:100%}.ptip .pl{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .9rem;margin:.4rem 0 0}
.ptip .pl a{color:#a5d8ff;font-weight:600;font-size:.82rem;text-underline-offset:2px}.ptip .pl a:focus-visible{outline:2px solid #a5d8ff;outline-offset:2px;border-radius:4px}
.ptip .pl .aller{min-height:32px;padding:0 .6rem;border-color:rgb(241 245 249/.2);background:rgb(241 245 249/.08);color:#f1f5f9;font-size:.82rem}
.pchoix{position:absolute;z-index:21;min-width:12rem;max-width:min(20rem,calc(100vw - 16px));max-height:min(60vh,22rem);overflow:auto;padding:.35rem;border-radius:14px;background:#0f1d2c;color:#f1f5f9;
border:1px solid rgb(241 245 249/.14);box-shadow:0 1px 2px rgb(0 0 0/.3),0 14px 34px -8px rgb(0 0 0/.55)}
.pchoix ul{list-style:none;margin:0;padding:0}.pchoix li+li{border-top:1px solid rgb(241 245 249/.1)}
.pchoix ul button{display:grid;gap:.05rem;width:100%;min-height:44px;padding:.45rem 2.2rem .45rem .6rem;border:0;border-radius:10px;background:none;color:inherit;font:inherit;font-size:.9rem;text-align:left;cursor:pointer}
.pchoix ul button:hover,.pchoix ul button:focus-visible{background:rgb(241 245 249/.1)}.pchoix ul button span{color:#b4c6d8;font-size:.8rem}
.pchoix .x{position:absolute;top:.35rem;right:.35rem;width:36px;height:36px;border:0;border-radius:10px;background:none;color:#b4c6d8;font-size:1.3rem;line-height:1;cursor:pointer}
@media (prefers-reduced-motion:reduce){.ptip{transition:none;transform:none}}
@media print{.ptip,.pchoix{display:none}}
`.replace(/\n/g, "");
