/**
 * One zoom for every map of the island that zooms (`svg[data-zoom]`): the hikes' map (/randonnees and each sector's
 * page), a trail's map, a commune's map of /enfants. Pinch, the wheel (WHEEL_SCRIPT), the double click (DOUBLE_SCRIPT),
 * the buttons + and − under the map, and « Recentrer » for its whole frame; once zoomed, a finger or the mouse moves it.
 * It moves the map's viewBox within its frame (`data-box`, else its first viewBox), up to `data-zoom` times closer, or
 * `data-zoom-fd` times once an IGN background is picked (web/map.ts, FONDS_SCRIPT): the lines and the dots keep their
 * width on screen (vector-effect) and the names are placed again at their size (NOMS_SCRIPT, on the viewBox's change).
 * A tap that ended a drag or a pinch opens nothing. A page's own script brings a point into the frame with the event
 * `zshow` (its detail: x and y, in the map's units); carte-points.ts zooms where a finger covers too many points with
 * `pzoom`. A button that can do nothing more is greyed. Without the script, the map stays whole and the buttons hidden.
 */
export const MOTS = {
  zoomIn: "Rapprocher",
  zoomOut: "Éloigner",
  recadrer: "Recentrer",
  /** « Recentrer » said aloud, by what the map's whole frame shows. */
  recadrerAria: { ile: "Recentrer sur toute l'île", commune: "Recentrer sur toute la commune", trace: "Recentrer sur toute la trace" },
};

/** The closest the map comes: 8 times the island's width, about 9 km across, where the relief still reads. */
export const MAX_ZOOM = 8;

/** The wheel's step: a notch of a mouse (deltaY 100 px) zooms by this much; a touchpad's small deltas by as little. */
export const WHEEL_STEP = 1.25;

/**
 * The wheel on a map, for a script with `svg`, `pt` (screen to map) and `zoom` (factor, centre) in scope: forwards it
 * always zooms in, centred on the pointer; backwards it zooms out, and once the map is whole it lets the page scroll. On a
 * map that cannot come closer (`most`, a short trail on the relief), it lets the page scroll both ways.
 */
export const WHEEL_SCRIPT = `svg.addEventListener("wheel",(e)=>{if(!e.deltaY||e.deltaY>0&&!svg.classList.contains("zoomed")||e.deltaY<0&&most()<=1)return;e.preventDefault();` +
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

/** Half a finger, in px: a tap this far from a line of the hikes' map still takes it. */
export const REACH_PX = 22;

// The buttons are found by the map's key (`data-fd`, the same as its backgrounds'), the map by its attribute: the script
// runs once for each map, however many times the page holds it. The backgrounds come after it in the page: they are
// looked for when they change, and when the map zooms.
const SCRIPT = `(()=>{document.querySelectorAll("svg[data-zoom]:not([data-zon])").forEach((svg)=>{svg.dataset.zon="1";const key=svg.dataset.fd,z=document.querySelector('.kzoom[data-fd="'+key+'"]'),fd='.fonds[data-fd="'+key+'"]';if(z)z.hidden=false;
const most=()=>+(svg.dataset.zoomFd&&document.querySelector(fd+" input:checked:not([value=relief])")?svg.dataset.zoomFd:svg.dataset.zoom)||1,bt=(k)=>z&&z.querySelector('[data-z="'+k+'"]');
const B=(svg.dataset.box||svg.getAttribute("viewBox")).split(" ").map(Number);let v=B.slice();const put=()=>{svg.setAttribute("viewBox",v.map((x)=>Math.round(x*100)/100).join(" "));svg.classList.toggle("zoomed",v[2]<B[2]-.01);
if(z){bt("+").disabled=v[2]<=B[2]/most()+.01;bt("-").disabled=bt("0").disabled=v[2]>=B[2]-.01}};
const clamp=()=>{v[2]=Math.min(B[2],Math.max(B[2]/most(),v[2]));v[3]=v[2]*B[3]/B[2];v[0]=Math.min(B[0]+B[2]-v[2],Math.max(B[0],v[0]));v[1]=Math.min(B[1]+B[3]-v[3],Math.max(B[1],v[1]));put()};
const zoom=(k,cx,cy)=>{if(cx===undefined){cx=v[0]+v[2]/2;cy=v[1]+v[3]/2}const w=v[2]/k;v=[cx-(cx-v[0])/k,cy-(cy-v[1])/k,w,w*B[3]/B[2]];clamp()};
const pt=(x,y)=>{const m=svg.getScreenCTM().inverse(),p=new DOMPoint(x,y).matrixTransform(m);return[p.x,p.y]};
const ps=new Map();let moved=0,last=null;
svg.addEventListener("pointerdown",(e)=>{ps.set(e.pointerId,[e.clientX,e.clientY]);if(ps.size===1)moved=0;last=null});
svg.addEventListener("pointermove",(e)=>{if(!ps.has(e.pointerId))return;const o=ps.get(e.pointerId);ps.set(e.pointerId,[e.clientX,e.clientY]);
if(ps.size===2){const[a,b]=[...ps.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]),c=pt((a[0]+b[0])/2,(a[1]+b[1])/2);if(last)zoom(d/last,c[0],c[1]);last=d;moved=9;e.preventDefault();return}
if(!svg.classList.contains("zoomed"))return;const p0=pt(o[0],o[1]),p1=pt(e.clientX,e.clientY);moved+=Math.hypot(e.clientX-o[0],e.clientY-o[1]);v[0]-=p1[0]-p0[0];v[1]-=p1[1]-p0[1];clamp();e.preventDefault()});
const up=(e)=>{ps.delete(e.pointerId);if(ps.size<2)last=null};["pointerup","pointercancel","pointerleave"].forEach((t)=>svg.addEventListener(t,up));
${WHEEL_SCRIPT}${DOUBLE_SCRIPT}
svg.addEventListener("click",(e)=>{if(moved>8){e.stopImmediatePropagation();e.preventDefault();return}held(e)},true);
svg.addEventListener("pzoom",(e)=>{const w=v[2],c=pt(e.detail.x,e.detail.y);zoom(2.5,c[0],c[1]);if(v[2]<w)e.preventDefault()});
svg.addEventListener("zshow",(e)=>{const x=e.detail.x,y=e.detail.y;if(x<v[0]||x>v[0]+v[2]||y<v[1]||y>v[1]+v[3]){v[0]=x-v[2]/2;v[1]=y-v[3]/2;clamp()}});
document.addEventListener("change",(e)=>{if(e.target.closest&&e.target.closest(fd))clamp()});put();
if(z)z.addEventListener("click",(e)=>{const k=e.target.closest("button")?.dataset.z;if(k==="+")zoom(${DOUBLE_STEP});else if(k==="-")zoom(1/${DOUBLE_STEP});else if(k==="0"){v=B.slice();put()}})})})();`;

/**
 * The buttons under a map that zooms, then the zoom's script, run before the page is drawn so that nothing moves.
 * `key` is the map's `data-fd`; `frame`, what its whole frame shows.
 */
export function zoomControls(key: string, frame: keyof typeof MOTS.recadrerAria): string {
  // The words hold no character to escape in an attribute.
  const button = (z: string, aria: string, text: string) => `<button type="button" data-z="${z}" aria-label="${aria}">${text}</button>`;
  return `<div class="kzoom" data-fd="${key}" hidden>${button("+", MOTS.zoomIn, "+")}${button("-", MOTS.zoomOut, "−")}${button("0", MOTS.recadrerAria[frame], MOTS.recadrer)}</div><script>${SCRIPT}</script>`;
}

/**
 * On the hikes' map, a tap beside a line takes the nearest one within a finger's reach. After the zoom's script, whose
 * listener comes first: a tap that ended a drag, and a mouse's click held for a double click, never reach it.
 */
export const HIKES_REACH = `(()=>{const svg=document.getElementById("hmap");if(!svg)return;
const near=(x,y)=>{for(let r=4;r<=${REACH_PX};r+=3)for(let a=0;a<16;a++){const l=document.elementsFromPoint(x+r*Math.cos(a*Math.PI/8),y+r*Math.sin(a*Math.PI/8)).find((n)=>n.dataset&&n.dataset.k&&svg.contains(n));if(l)return l}return null};
svg.addEventListener("click",(e)=>{if(e.target.dataset?.k)return;const l=near(e.clientX,e.clientY);if(l){e.stopImmediatePropagation();l.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:e.clientX,clientY:e.clientY}))}},true)})();`;
