/**
 * The zoom of the hikes' map (/randonnees and each sector's page): pinch, the wheel (with Ctrl, or once zoomed), the
 * buttons + and −, and « Recentrer » for the whole island; once zoomed, a finger or the mouse moves the map. It moves
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
svg.addEventListener("wheel",(e)=>{if(!e.ctrlKey&&!svg.classList.contains("zoomed"))return;e.preventDefault();const c=pt(e.clientX,e.clientY);zoom(e.deltaY<0?1.25:.8,c[0],c[1])},{passive:false});
z.addEventListener("click",(e)=>{const k=e.target.closest("button")?.dataset.z;if(k==="+")zoom(1.6);else if(k==="-")zoom(1/1.6);else if(k==="0"){v=B.slice();put()}});
const near=(x,y)=>{for(let r=4;r<=${REACH_PX};r+=3)for(let a=0;a<16;a++){const l=document.elementsFromPoint(x+r*Math.cos(a*Math.PI/8),y+r*Math.sin(a*Math.PI/8)).find((n)=>n.dataset&&n.dataset.k&&svg.contains(n));if(l)return l}return null};
svg.addEventListener("click",(e)=>{if(moved>8){e.stopImmediatePropagation();e.preventDefault();return}if(e.target.dataset?.k||!e.isTrusted)return;const l=near(e.clientX,e.clientY);if(l){e.stopImmediatePropagation();l.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:e.clientX,clientY:e.clientY}))}},true)})();`;

/** The buttons under the hikes' map, then its script, run before the page is drawn so that nothing moves. */
export function hikesZoom(): string {
  const button = (z: string, aria: string, text: string) => `<button type="button" data-z="${z}" aria-label="${esc(aria)}">${esc(text)}</button>`;
  return `<div id="hmz" class="kzoom" hidden>${button("+", MOTS.zoomIn, "+")}${button("-", MOTS.zoomOut, "−")}${button("0", MOTS.recadrerAria, MOTS.recadrer)}</div><script>${SCRIPT}</script>`;
}
