import { describe, expect, it } from "vitest";
import { SECTEURS } from "../src/traces/secteurs.js";
import { hikesZoom, MAX_ZOOM, MOTS, REACH_PX } from "../src/web/carte-zoom.js";
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
    // The wheel scrolls the page until the map is zoomed, or with Ctrl.
    expect(html).toContain('if(!e.ctrlKey&&!svg.classList.contains("zoomed"))return;');
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
