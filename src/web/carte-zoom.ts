/**
 * The zoom of the hikes' map (/randonnees and each sector's page): pinch, the wheel (WHEEL_SCRIPT), the
 * double click (DOUBLE_SCRIPT), the buttons + and −, and « Recentrer » for the whole island; once zoomed, a finger or the mouse moves the map. It moves
 * the map's viewBox, within the island's frame: the lines keep their width on screen (vector-effect) and the names are
 * placed again at their size (NOMS_SCRIPT, on the viewBox's change). A tap beside a line takes the nearest one within
 * a finger's reach; a tap that ended a drag or a pinch opens nothing. Without the script, the map stays whole and the
 * buttons hidden.
 */
import { esc } from "./map.js";

export const MOTS = {
  zoomIn: "Rapprocher",
  zoomOut: "Éloigner",
  recadrer: "Recentrer",
  recadrerAria: "Recentrer sur toute l'île",
};

/** The closest the map comes: 8 times the island's width, about 9 km across, where the relief still reads. */
export const MAX_ZOOM = 8;

/** The wheel's step: a notch of a mouse (deltaY 100 px) zooms by this much; a touchpad's small deltas by as little. */
export const WHEEL_STEP = 1.25;

/**
 * The wheel on a map, for a script with `svg`, `pt` (screen to map) and `zoom` (factor, centre) in scope: forwards it
 * always zooms in, centred on the pointer; backwards it zooms out, and once the map is whole it lets the page scroll.
 * Shared by the hikes' map and the communes' maps of /enfants (web/enfants.ts).
 */
export const WHEEL_SCRIPT = `svg.addEventListener("wheel",(e)=>{if(!e.deltaY||e.deltaY>0&&!svg.classList.contains("zoomed"))return;e.preventDefault();` +
  `const d=e.deltaY*(e.deltaMode===1?33:e.deltaMode===2?100:1)/100,c=pt(e.clientX,e.clientY);zoom(${WHEEL_STEP}**Math.max(-1,Math.min(1,-d)),c[0],c[1])},{passive:false});`;

/** A double click's step, the button + 's. */
export const DOUBLE_STEP = 1.6;
/** How long a mouse's click waits for a second one before it opens what is under it, in ms. */
export const DOUBLE_WAIT_MS = 300;

/**
 * The double click on a map, for the same script: it zooms in by DOUBLE_STEP, centred on the point clicked. A mouse's
 * click is held (`held`, for the script's click listener in the capture phase) and given again DOUBLE_WAIT_MS later
 * unless a second click came, so that the first click of a double click opens nothing. A finger's tap, a pen's and a
 * click from the keyboard (detail 0) are never held: on a phone, the pinch zooms. The pointer is the one of the last
 * pointerdown, not the click's own: Safari gives a finger's click the pointerType « mouse ».
 */
export const DOUBLE_SCRIPT = `let hold=0,ptr="";svg.addEventListener("pointerdown",(e)=>{ptr=e.pointerType},true);` +
  `const held=(e)=>{if(!e.isTrusted||!e.detail||ptr!=="mouse")return false;` +
  `e.stopImmediatePropagation();e.preventDefault();clearTimeout(hold);if(e.detail===1){const t=e.target,x=e.clientX,y=e.clientY;` +
  `hold=setTimeout(()=>t.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,clientX:x,clientY:y})),${DOUBLE_WAIT_MS})}return true};` +
  `svg.addEventListener("dblclick",(e)=>{e.preventDefault();const c=pt(e.clientX,e.clientY);zoom(${DOUBLE_STEP},c[0],c[1])});`;

/** Half a finger, in px: a tap this far from a line still takes it. */
export const REACH_PX = 22;

const SCRIPT = `(()=>{const svg=document.getElementById("hmap"),z=document.getElementById("hmz");if(!svg||!z)return;z.hidden=false;
const B=svg.getAttribute("viewBox").split(" ").map(Number);let v=B.slice();const put=()=>{svg.setAttribute("viewBox",v.map((x)=>Math.round(x*100)/100).join(" "));svg.classList.toggle("zoomed",v[2]<B[2]-.01)};
const clamp=()=>{v[2]=Math.min(B[2],Math.max(B[2]/${MAX_ZOOM},v[2]));v[3]=v[2]*B[3]/B[2];v[0]=Math.min(B[0]+B[2]-v[2],Math.max(B[0],v[0]));v[1]=Math.min(B[1]+B[3]-v[3],Math.max(B[1],v[1]));put()};
const zoom=(k,cx,cy)=>{if(cx===undefined){cx=v[0]+v[2]/2;cy=v[1]+v[3]/2}const w=v[2]/k;v=[cx-(cx-v[0])/k,cy-(cy-v[1])/k,w,w*B[3]/B[2]];clamp()};
const pt=(x,y)=>{const m=svg.getScreenCTM().inverse(),p=new DOMPoint(x,y).matrixTransform(m);return[p.x,p.y]};
const ps=new Map();let moved=0,last=null;
svg.addEventListener("pointerdown",(e)=>{ps.set(e.pointerId,[e.clientX,e.clientY]);if(ps.size===1)moved=0;last=null});
svg.addEventListener("pointermove",(e)=>{if(!ps.has(e.pointerId))return;const o=ps.get(e.pointerId);ps.set(e.pointerId,[e.clientX,e.clientY]);
if(ps.size===2){const[a,b]=[...ps.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]),c=pt((a[0]+b[0])/2,(a[1]+b[1])/2);if(last)zoom(d/last,c[0],c[1]);last=d;moved=9;e.preventDefault();return}
if(!svg.classList.contains("zoomed"))return;const p0=pt(o[0],o[1]),p1=pt(e.clientX,e.clientY);moved+=Math.hypot(e.clientX-o[0],e.clientY-o[1]);v[0]-=p1[0]-p0[0];v[1]-=p1[1]-p0[1];clamp();e.preventDefault()});
const up=(e)=>{ps.delete(e.pointerId);if(ps.size<2)last=null};["pointerup","pointercancel","pointerleave"].forEach((t)=>svg.addEventListener(t,up));
${WHEEL_SCRIPT}${DOUBLE_SCRIPT}
z.addEventListener("click",(e)=>{const k=e.target.closest("button")?.dataset.z;if(k==="+")zoom(1.6);else if(k==="-")zoom(1/1.6);else if(k==="0"){v=B.slice();put()}});
const near=(x,y)=>{for(let r=4;r<=${REACH_PX};r+=3)for(let a=0;a<16;a++){const l=document.elementsFromPoint(x+r*Math.cos(a*Math.PI/8),y+r*Math.sin(a*Math.PI/8)).find((n)=>n.dataset&&n.dataset.k&&svg.contains(n));if(l)return l}return null};
svg.addEventListener("click",(e)=>{if(moved>8){e.stopImmediatePropagation();e.preventDefault();return}if(held(e)||e.target.dataset?.k)return;const l=near(e.clientX,e.clientY);if(l){e.stopImmediatePropagation();l.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:e.clientX,clientY:e.clientY}))}},true)})();`;

/** The buttons under the hikes' map, then its script, run before the page is drawn so that nothing moves. */
export function hikesZoom(): string {
  const button = (z: string, aria: string, text: string) => `<button type="button" data-z="${z}" aria-label="${esc(aria)}">${esc(text)}</button>`;
  return `<div id="hmz" class="kzoom" hidden>${button("+", MOTS.zoomIn, "+")}${button("-", MOTS.zoomOut, "−")}${button("0", MOTS.recadrerAria, MOTS.recadrer)}</div><script>${SCRIPT}</script>`;
}
