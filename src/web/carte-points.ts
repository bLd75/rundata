/**
 * The points of every map that leads somewhere (map.ts: a marker of the island, a spot of a commune), one code for all.
 *
 * With a mouse, a bubble names the point under it: its name, then its kind or its value, then its address or its time,
 * from its `data-pn`, `data-p2` and `data-p3` (written by map.ts; a marker with a bubble of its own has its name in `data-tp`), in place of the browser's slow tooltip. The maps
 * that have a bubble of their own (/meteo, the home page's: `[data-mtip]`) keep it.
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
 */

/** Around a finger's tap, in CSS pixels: the half of the 44 px a finger covers. */
export const TAP_PX = 22;
/** More points than this under a finger: a map that zooms (`pzoom`, the children's map of a commune) zooms there first. */
export const LIST_MAX = 5;

export const POINTS_SCRIPT = `(()=>{const maps=[...document.querySelectorAll("svg.map")].filter((s)=>s.querySelector("a.mk,a.sp"));if(!maps.length)return;
const R=${TAP_PX},LIST=${LIST_MAX},mk=(c,t)=>{const e=document.createElement(c);if(t)e.className=t;return e};
const lines=(a)=>[a.dataset.pn||a.dataset.tp,a.dataset.p2,a.dataset.p3].filter(Boolean);
const mid=(a)=>{const h=a.querySelector(".hit");const r=(h||a).getBoundingClientRect();return r.width?[r.left+r.width/2,r.top+r.height/2]:null};
const tip=mk("div","ptip");tip.hidden=true;tip.setAttribute("aria-hidden","true");document.body.append(tip);
const hide=()=>{tip.hidden=true;tip.classList.remove("vu")};
const show=(a)=>{const l=lines(a),c=mid(a);if(!l.length||!c)return;tip.replaceChildren(...l.map((x,i)=>{const e=mk(i?"span":"b");e.textContent=x;return e}));
tip.hidden=false;const w=tip.offsetWidth,h=tip.offsetHeight,x=Math.min(Math.max(c[0]-w/2,6),innerWidth-w-6),up=c[1]-h-20>=0;
tip.classList.toggle("bas",!up);tip.style.left=x+scrollX+"px";tip.style.top=(up?c[1]-h-20:c[1]+20)+scrollY+"px";tip.style.setProperty("--ax",Math.min(Math.max(c[0]-x,14),w-14)+"px");requestAnimationFrame(()=>tip.classList.add("vu"))};
const box=mk("div","pchoix");box.hidden=true;box.setAttribute("role","dialog");document.body.append(box);
const close=()=>{box.hidden=true;box.replaceChildren()};
let go=false;
const fire=(a)=>{close();go=true;try{if(a.matches("[data-tp]"))a.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerType:"touch"}));a.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}))}finally{go=false}};
const choose=(list,x,y)=>{const ul=mk("ul");list.forEach((a)=>{const b=mk("button");b.type="button";const l=lines(a);const n=mk("b");n.textContent=l[0]||a.getAttribute("aria-label")||"";b.append(n);
if(l[1]){const s=mk("span");s.textContent=l[1];b.append(s)}b.addEventListener("click",(e)=>{e.stopPropagation();fire(a)});const li=mk("li");li.append(b);ul.append(li)});
const x0=mk("button","x");x0.type="button";x0.setAttribute("aria-label","Fermer");x0.textContent="×";x0.addEventListener("click",close);box.replaceChildren(x0,ul);box.hidden=false;
const w=box.offsetWidth,h=box.offsetHeight;box.style.left=Math.min(Math.max(x-w/2,8),innerWidth-w-8)+scrollX+"px";box.style.top=(y+16+h<=innerHeight-8?y+16:Math.max(8,y-16-h))+scrollY+"px"};
document.addEventListener("pointerdown",(e)=>{if(!box.hidden&&!box.contains(e.target))close()});document.addEventListener("keydown",(e)=>{if(e.key==="Escape"){close();hide()}});addEventListener("resize",()=>{close();hide()});
maps.forEach((s)=>{const pts=()=>[...s.querySelectorAll("a.mk,a.sp")];const own=!!(s.closest("figure")||s.parentElement).querySelector("[data-mtip]");
if(!own)pts().forEach((a)=>{a.querySelectorAll("title").forEach((t)=>{if(!a.getAttribute("aria-label"))a.setAttribute("aria-label",t.textContent);t.remove()});
a.addEventListener("pointerenter",(e)=>{if(e.pointerType==="mouse")show(a)});a.addEventListener("pointerleave",hide)});
let down=null,up=null;s.addEventListener("pointerdown",(e)=>{if(go)return;down=e.pointerType==="mouse"?null:[e.clientX,e.clientY];up=null},true);
s.addEventListener("pointerup",(e)=>{if(down)up=[e.clientX,e.clientY]},true);
s.addEventListener("click",(e)=>{if(go||!down)return;const d=down,u=up||d;down=up=null;if(Math.hypot(u[0]-d[0],u[1]-d[1])>10)return;
const b=s.getBoundingClientRect(),near=pts().map((a)=>[a,mid(a)]).filter(([,c])=>c&&c[0]>=b.left&&c[0]<=b.right&&c[1]>=b.top&&c[1]<=b.bottom).map(([a,c])=>[a,Math.hypot(c[0]-u[0],c[1]-u[1])]).filter(([,k])=>k<=R).sort((p,q)=>p[1]-q[1]).map(([a])=>a);
if(!near.length||(near.length===1&&near[0]===e.target.closest("a.mk,a.sp")&&!near[0].matches("[data-tp]")))return;e.preventDefault();e.stopPropagation();
if(near.length===1)fire(near[0]);else if(near.length<=LIST||s.dispatchEvent(new CustomEvent("pzoom",{cancelable:true,detail:{x:u[0],y:u[1]}})))choose(near,u[0],u[1])},true)})})();`;

/** The bubble as /meteo's (.mtip), night in both themes; the list of close points the same, its rows wide enough for a finger. */
export const POINTS_CSS = `
.ptip{position:absolute;z-index:20;display:grid;gap:.1rem;max-width:16rem;padding:.5rem .75rem .55rem;border-radius:12px;background:#0f1d2c;color:#f1f5f9;
border:1px solid rgb(241 245 249/.12);box-shadow:0 1px 2px rgb(0 0 0/.3),0 10px 30px -8px rgb(0 0 0/.5);font-size:.85rem;line-height:1.3;pointer-events:none;
opacity:0;transform:translateY(4px);transition:opacity .12s ease-out,transform .12s ease-out}
.ptip[hidden],.pchoix[hidden]{display:none}.ptip.vu{opacity:1;transform:none}.ptip b{font-weight:600}.ptip span{color:#b4c6d8;font-size:.8rem}
.ptip::after{content:"";position:absolute;left:var(--ax,50%);bottom:-7px;width:12px;height:12px;background:#0f1d2c;border:solid rgb(241 245 249/.12);border-width:0 1px 1px 0;transform:translateX(-50%) rotate(45deg)}
.ptip.bas::after{bottom:auto;top:-7px;border-width:1px 0 0 1px}
.pchoix{position:absolute;z-index:21;min-width:12rem;max-width:min(20rem,calc(100vw - 16px));max-height:min(60vh,22rem);overflow:auto;padding:.35rem;border-radius:14px;background:#0f1d2c;color:#f1f5f9;
border:1px solid rgb(241 245 249/.14);box-shadow:0 1px 2px rgb(0 0 0/.3),0 14px 34px -8px rgb(0 0 0/.55)}
.pchoix ul{list-style:none;margin:0;padding:0}.pchoix li+li{border-top:1px solid rgb(241 245 249/.1)}
.pchoix ul button{display:grid;gap:.05rem;width:100%;min-height:44px;padding:.45rem 2.2rem .45rem .6rem;border:0;border-radius:10px;background:none;color:inherit;font:inherit;font-size:.9rem;text-align:left;cursor:pointer}
.pchoix ul button:hover,.pchoix ul button:focus-visible{background:rgb(241 245 249/.1)}.pchoix ul button span{color:#b4c6d8;font-size:.8rem}
.pchoix .x{position:absolute;top:.35rem;right:.35rem;width:36px;height:36px;border:0;border-radius:10px;background:none;color:#b4c6d8;font-size:1.3rem;line-height:1;cursor:pointer}
@media (prefers-reduced-motion:reduce){.ptip{transition:none;transform:none}}
@media print{.ptip,.pchoix{display:none}}
`.replace(/\n/g, "");
