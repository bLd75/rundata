import { describe, expect, it } from "vitest";
import { SECTEURS } from "../src/traces/secteurs.js";
import { DOUBLE_SCRIPT, DOUBLE_STEP, DOUBLE_WAIT_MS, hikesZoom, MAX_ZOOM, MOTS, REACH_PX, WHEEL_SCRIPT, WHEEL_STEP } from "../src/web/carte-zoom.js";
import type { RandonneesAnswer } from "../src/web/data.js";
import { randonneesPage } from "../src/web/domains.js";
import { CSS } from "../src/web/pages.js";
import { secteurPage } from "../src/web/randonnees.js";

const O = "https://rundata.re";
const NOW = new Date("2026-10-31T04:00:00Z");
const mafate = SECTEURS.find((s) => s.nom === "Mafate")!;
const answer = {
  randonnees: [],
  secteurs: [{ secteur: mafate.nom, communes: ["La Possession"], sentiers: [{ k: "s1", nom: "La Nouvelle - Maison Laclos", commune: "La Possession", km: 0.9, etat: "fermé", boucle: false, randonnees: [] }] }],
  lignes: [{ k: "s1", genre: "sentier", etat: "fermé", d: "M350 380l5 4", href: "", nom: "La Nouvelle - Maison Laclos" }],
  fermes: 1,
  suivis: 1,
  sources: [],
  hauts: [],
} as unknown as RandonneesAnswer;
const data = { value: answer, fetchedAt: NOW, stale: false };

describe("the zoom of the hikes' map", () => {
  it("is under the map of /randonnees and of each sector's page, between the map and its legend", () => {
    for (const html of [randonneesPage(O, data, NOW), secteurPage(O, mafate, data, null, NOW)]) {
      expect(html).toContain(`</svg>${hikesZoom()}\n  <figcaption class="note legend">`);
      expect(html.match(/id="hmz"/g)).toHaveLength(1);
    }
  });

  it("has the buttons of the communes' maps, hidden until the script runs, each 44 px wide", () => {
    const html = hikesZoom();
    expect(html).toContain(`<div id="hmz" class="kzoom" hidden><button type="button" data-z="+" aria-label="${MOTS.zoomIn}">+</button>` +
      `<button type="button" data-z="-" aria-label="${MOTS.zoomOut}">−</button><button type="button" data-z="0" aria-label="Recentrer sur toute l&#39;île">Recentrer</button></div>`);
    expect(html).toContain('z.hidden=false;');
    expect(CSS).toContain(".kzoom button{min-width:44px;min-height:44px;");
  });

  it("moves the viewBox within the island, at most 8 times closer, with a pinch, the wheel, the buttons and a drag", () => {
    const html = hikesZoom();
    expect(MAX_ZOOM).toBe(8);
    expect(html).toContain(`Math.max(B[2]/${MAX_ZOOM},v[2])`);
    for (const t of ['"pointerdown"', '"pointermove"', '"wheel"', "ps.size===2", 'k==="+"', 'k==="-"', 'k==="0"']) expect(html).toContain(t);
    expect(html).toContain(WHEEL_SCRIPT);
    expect(html).toContain(DOUBLE_SCRIPT);
  });

  it("zooms in with the wheel forwards, always and without Ctrl, and lets the page scroll backwards once the map is whole", () => {
    expect(WHEEL_SCRIPT).toContain('if(!e.deltaY||e.deltaY>0&&!svg.classList.contains("zoomed"))return;e.preventDefault();');
    expect(WHEEL_SCRIPT).not.toContain("ctrlKey");
    expect(WHEEL_SCRIPT).toContain("{passive:false}");
    // A mouse's notch (100 px, or 3 lines) a whole step, a touchpad's few px a small one, centred on the pointer.
    expect(WHEEL_STEP).toBe(1.25);
    expect(WHEEL_SCRIPT).toContain("e.deltaMode===1?33:e.deltaMode===2?100:1");
    expect(WHEEL_SCRIPT).toContain(`zoom(${WHEEL_STEP}**Math.max(-1,Math.min(1,-d)),c[0],c[1])`);
    expect(WHEEL_SCRIPT).toContain("c=pt(e.clientX,e.clientY)");
  });

  it("zooms in a step with a double click, centred on it, and opens nothing on its first click", () => {
    expect(DOUBLE_STEP).toBe(1.6);
    expect(DOUBLE_WAIT_MS).toBe(300);
    expect(DOUBLE_SCRIPT).toContain(`svg.addEventListener("dblclick",(e)=>{e.preventDefault();const c=pt(e.clientX,e.clientY);zoom(${DOUBLE_STEP},c[0],c[1])});`);
    // A mouse's click waits for a second one; a finger's tap, a pen's and the keyboard's open at once.
    // Told by the pointerdown: Safari's click after a finger's tap says « mouse ».
    expect(DOUBLE_SCRIPT).toContain('svg.addEventListener("pointerdown",(e)=>{ptr=e.pointerType},true);');
    expect(DOUBLE_SCRIPT).toContain('if(!e.isTrusted||!e.detail||ptr!=="mouse")return false;');
    expect(DOUBLE_SCRIPT).toContain(`if(e.detail===1){`);
    expect(DOUBLE_SCRIPT).toContain(`,${DOUBLE_WAIT_MS})}return true}`);
    expect(hikesZoom()).toContain("if(moved>8){e.stopImmediatePropagation();e.preventDefault();return}if(held(e)||e.target.dataset?.k)return;");
  });

  it("opens nothing at the end of a drag, and takes the nearest line within half a finger of a tap", () => {
    const html = hikesZoom();
    expect(REACH_PX).toBe(22);
    expect(html).toContain("if(moved>8){e.stopImmediatePropagation();e.preventDefault();return}");
    expect(html).toContain(`for(let r=4;r<=${REACH_PX};r+=3)`);
    expect(html).toContain('l.dispatchEvent(new MouseEvent("click",{bubbles:true,');
  });

  it("keeps the lines' width and the coast's on screen, and the closed trails thicker, once zoomed", () => {
    expect(CSS).toContain(".map.hikes{touch-action:pan-y;user-select:none;-webkit-user-select:none}.map.hikes.zoomed{touch-action:none;cursor:grab}");
    expect(CSS).toContain(".map.hikes.zoomed .coast{stroke-width:3px;vector-effect:non-scaling-stroke}.map.hikes.zoomed .borders{vector-effect:non-scaling-stroke}");
    expect(CSS).toContain(".map.hikes.zoomed .trk.ferme{stroke-width:3.4px;stroke-dasharray:7 4}");
    expect(CSS).toMatch(/\.map \.trk\{[^}]*vector-effect:non-scaling-stroke\}/);
    expect(CSS).toMatch(/\.map\.hikes \.rte\{[^}]*vector-effect:non-scaling-stroke\}/);
  });
});
