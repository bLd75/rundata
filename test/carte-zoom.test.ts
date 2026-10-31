import { describe, expect, it } from "vitest";
import { SECTEURS } from "../src/traces/secteurs.js";
import { DOUBLE_SCRIPT, DOUBLE_STEP, DOUBLE_WAIT_MS, HIKES_REACH, MAX_ZOOM, MOTS, REACH_PX, WHEEL_SCRIPT, WHEEL_STEP, zoomControls } from "../src/web/carte-zoom.js";
import type { RandonneesAnswer } from "../src/web/data.js";
import { randonneesPage, tracePage, traceSource } from "../src/web/domains.js";
import { CSS } from "../src/web/pages.js";
import island from "../src/places/island.json" with { type: "json" };
import { FONDS_SCRIPT, FOND_ZOOM, H, NOMS_SCRIPT, traceMap, W } from "../src/web/map.js";
import routes from "../src/web/routes.json" with { type: "json" };
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

const zoom = zoomControls("h", "ile");
const script = zoom.slice(zoom.indexOf("<script>") + 8, -9);
const attr = (html: string, name: string) => +new RegExp(`${name}="([\\d.]+)"`).exec(html)![1];
// A trail of 2 km, on the slopes of Saint-Denis.
const short = traceMap({ lines: [{ etat: "ouvert", points: [[55.452, -20.885], [55.465, -20.895]] }], label: "x" });
// Across the island.
const long = traceMap({ lines: [{ etat: "ouvert", points: [[55.3, -20.9], [55.5, -21.1], [55.7, -21.3]] }], label: "x" });

describe("the zoom of every map that zooms", () => {
  it("is under the map of /randonnees and of each sector's page, then the backgrounds, then the legend", () => {
    for (const html of [randonneesPage(O, data, NOW), secteurPage(O, mafate, data, null, NOW)]) {
      expect(html).toContain('<svg id="hmap" class="map terrain hikes" data-fd="h" data-zoom="8"');
      expect(html).toContain(`</svg>${zoom}<p class="fd-w" id="fd-w-h" role="status"></p><div class="tabs fonds" role="radiogroup" aria-label="Fond de la carte" data-fd="h" hidden>`);
      expect(html).toContain(`<script>${FONDS_SCRIPT}</script><script>${HIKES_REACH}</script>\n  <figcaption class="note legend">`);
      // The IGN's tiles over the relief, under the lines.
      expect(html.indexOf('<g id="fd-h" class="fd"></g>')).toBeGreaterThan(html.indexOf("relief-"));
      expect(html.indexOf('<g id="fd-h" class="fd"></g>')).toBeLessThan(html.indexOf('<g class="lines">'));
      expect(html.match(/class="kzoom"/g)).toHaveLength(1);
    }
  });

  it("has three buttons, hidden until the script runs, each 44 px wide, « Recentrer » said by what the frame shows", () => {
    expect(zoom).toContain(`<div class="kzoom" data-fd="h" hidden><button type="button" data-z="+" aria-label="${MOTS.zoomIn}">+</button>` +
      `<button type="button" data-z="-" aria-label="${MOTS.zoomOut}">−</button><button type="button" data-z="0" aria-label="Recentrer sur toute l'île">Recentrer</button></div>`);
    expect(zoomControls("t", "trace")).toContain('aria-label="Recentrer sur toute la trace">Recentrer</button>');
    expect(zoomControls("ecm", "commune")).toContain('aria-label="Recentrer sur toute la commune">Recentrer</button>');
    expect(script).toContain("if(z)z.hidden=false;");
    expect(CSS).toContain(".kzoom button{min-width:44px;min-height:44px;");
    expect(CSS).toContain(".kzoom[hidden]");
  });

  it("is one script for every map with data-zoom, run once for each, its buttons and backgrounds found by the map's key", () => {
    expect(script).toContain('document.querySelectorAll("svg[data-zoom]:not([data-zon])").forEach((svg)=>{svg.dataset.zon="1";');
    expect(script).toContain(`z=document.querySelector('.kzoom[data-fd="'+key+'"]'),fd='.fonds[data-fd="'+key+'"]';`);
    expect(() => new Function(script)).not.toThrow();
    expect(() => new Function(HIKES_REACH)).not.toThrow();
  });

  it("moves the viewBox within the map's frame, at most data-zoom times closer, with a pinch, the wheel, the buttons and a drag", () => {
    expect(MAX_ZOOM).toBe(8);
    expect(script).toContain('const B=(svg.dataset.box||svg.getAttribute("viewBox")).split(" ").map(Number);');
    expect(script).toContain("Math.max(B[2]/most(),v[2])");
    for (const t of ['"pointerdown"', '"pointermove"', "ps.size===2", 'k==="+"', 'k==="-"', 'k==="0"']) expect(script).toContain(t);
    expect(script).toContain(WHEEL_SCRIPT);
    expect(script).toContain(DOUBLE_SCRIPT);
    expect(script).toContain(`if(k==="+")zoom(${DOUBLE_STEP});else if(k==="-")zoom(1/${DOUBLE_STEP});`);
  });

  it("comes closer on the IGN's backgrounds where the map says so, and back within the relief's limit when the relief is picked again", () => {
    // The backgrounds come after the zoom's script in the page: looked for when needed.
    expect(script).toContain('const most=()=>+(svg.dataset.zoomFd&&document.querySelector(fd+" input:checked:not([value=relief])")?svg.dataset.zoomFd:svg.dataset.zoom)||1,');
    expect(script).toContain('document.addEventListener("change",(e)=>{if(e.target.closest&&e.target.closest(fd))clamp()});put();');
    // A button that can do nothing more is greyed: + at the closest, − and « Recentrer » on the whole frame.
    expect(script).toContain('bt("+").disabled=v[2]<=B[2]/most()+.01;bt("-").disabled=bt("0").disabled=v[2]>=B[2]-.01');
    expect(CSS).toContain(".kzoom button:disabled{opacity:.45;cursor:default}");
  });

  it("brings a point into the frame for the page's script, and zooms where a finger covers too many points", () => {
    expect(script).toContain('svg.addEventListener("zshow",(e)=>{const x=e.detail.x,y=e.detail.y;if(x<v[0]||x>v[0]+v[2]||y<v[1]||y>v[1]+v[3]){v[0]=x-v[2]/2;v[1]=y-v[3]/2;clamp()}});');
    expect(script).toContain('svg.addEventListener("pzoom",(e)=>{const w=v[2],c=pt(e.detail.x,e.detail.y);zoom(2.5,c[0],c[1]);if(v[2]<w)e.preventDefault()});');
  });

  it("zooms in with the wheel forwards, always and without Ctrl, and lets the page scroll backwards once the map is whole", () => {
    expect(WHEEL_SCRIPT).toContain('if(!e.deltaY||e.deltaY>0&&!svg.classList.contains("zoomed")||e.deltaY<0&&most()<=1)return;e.preventDefault();');
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
  });

  it("opens nothing at the end of a drag, and on the hikes' map takes the nearest line within half a finger of a tap", () => {
    expect(script).toContain('svg.addEventListener("click",(e)=>{if(moved>8){e.stopImmediatePropagation();e.preventDefault();return}held(e)},true);');
    expect(REACH_PX).toBe(22);
    expect(HIKES_REACH).toContain(`for(let r=4;r<=${REACH_PX};r+=3)`);
    expect(HIKES_REACH).toContain('if(e.target.dataset?.k)return;');
    expect(HIKES_REACH).toContain('l.dispatchEvent(new MouseEvent("click",{bubbles:true,');
  });

  it("keeps the lines' width and the coast's on screen, and the closed trails thicker, once zoomed", () => {
    expect(CSS).toContain(".map[data-zoom]{touch-action:pan-y;user-select:none;-webkit-user-select:none}.map[data-zoom].zoomed{touch-action:none;cursor:grab}");
    expect(CSS).toContain(".map.hikes.zoomed .coast{stroke-width:3px;vector-effect:non-scaling-stroke}.map.hikes.zoomed .borders{vector-effect:non-scaling-stroke}");
    expect(CSS).toContain(".map.hikes.zoomed .trk.ferme{stroke-width:3.4px;stroke-dasharray:7 4}");
    expect(CSS).toMatch(/\.map \.trk\{[^}]*vector-effect:non-scaling-stroke\}/);
    expect(CSS).toMatch(/\.map\.hikes \.rte\{[^}]*vector-effect:non-scaling-stroke\}/);
  });
});

describe("a trail's map", () => {
  it("is never closer than the relief reads: a short trail gets room around it", () => {
    const width = (html: string) => +/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/.exec(html)![1];
    expect(width(short)).toBeCloseTo(W / MAX_ZOOM, 1);
    expect(width(long)).toBeGreaterThan(W / MAX_ZOOM);
  });

  it("zooms up to the relief's limit, FOND_ZOOM times closer on the IGN's backgrounds", () => {
    expect(attr(short, "data-zoom")).toBe(1);
    expect(attr(short, "data-zoom-fd")).toBe(FOND_ZOOM);
    const width = +/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/.exec(long)![1];
    expect(attr(long, "data-zoom")).toBeCloseTo(width / (W / MAX_ZOOM), 1);
    expect(short).toContain(`</svg>${zoomControls("t", "trace")}<p class="fd-w"`);
  });

  it("marks its start with a dot of the same size on screen at any zoom", () => {
    expect(short).toMatch(/<path class="trk-start" d="M[\d.]+ [\d.]+h0"\/><path class="trk-start in" d="M[\d.]+ [\d.]+h0"\/><\/svg>/);
    expect(CSS).toContain(".map .trk-start{fill:none;stroke:#0b1f36;stroke-width:12px;stroke-linecap:round;vector-effect:non-scaling-stroke}");
  });

  it("keeps the names of places off the trail, on the server and in the page's script", () => {
    // A trail across Hell Bourg, from west to east: its name moves above or below the trail, or is not shown.
    const [, , hx, hy] = (routes.noms as [string, number, number, number][]).find((n) => n[0] === "Hell Bourg")!;
    const [A, B, C, D] = island.bbox;
    const lon = A + (hx / W) * (C - A);
    const lat = D - (hy / H) * (D - B);
    const across = traceMap({ lines: [{ etat: "ouvert", points: [[lon - 0.03, lat], [lon + 0.03, lat]] }], label: "x" });
    const t = /<text x="[\d.]+" y="([\d.]+)" data-x="[\d.]+" data-y="[\d.]+" font-size="([\d.]+)"[^>]*>Hell Bourg<\/text>/.exec(across)!;
    if (!t[0].includes('class="nx"')) expect(Math.abs(+t[1] - hy)).toBeGreaterThan(+t[2] * 0.6);
    expect(NOMS_SCRIPT).toContain('svg.querySelectorAll(".trk-halo").forEach((l)=>{const L=l.getTotalLength(),st=Math.max(6*u,L/800);');
    expect(NOMS_SCRIPT).toContain('const r=e.matches(".rg,.trk-start")?9*u:0;');
  });
});

describe("the source under a map of trails", () => {
  // The ONF's map edited at 02:15 on 31/10 in La Réunion.
  const edited = "2026-10-30T22:15:00.000Z";
  const trace = (genre: "sentier" | "randonnee", carte_mise_a_jour?: string) =>
    ({ value: { nom: "x", slug: "x", genre, km: 2, etat: "Ouvert", ferme: false, troncons: [], lignes: [{ etat: genre === "sentier" ? "ouvert" : "", points: [[55.452, -20.885], [55.465, -20.895]] }], profil: [], randonnees: [], fermes: [], inconnus: [], carte_mise_a_jour, sources: [] }, fetchedAt: NOW, stale: false }) as any;

  it("dates the ONF's map in La Réunion, and names OpenStreetMap where its hikes are drawn", () => {
    expect(traceSource(edited, true)).toBe(`<span class="mls">Carte de l'ONF du 31/10\u00a0; itinéraires d'OpenStreetMap.</span>`);
    expect(traceSource(edited, false)).toBe(`<span class="mls">Carte de l'ONF du 31/10.</span>`);
    // Without the date (an old copy, or the ONF's metadata not read), the map is still named.
    expect(traceSource(undefined, false)).toBe(`<span class="mls">Carte de l'ONF.</span>`);
    expect(traceSource("pas une date", true)).toBe(`<span class="mls">Carte de l'ONF\u00a0; itinéraires d'OpenStreetMap.</span>`);
  });

  it("goes on its own line after the legend, under the hikes' map, a sector's and a trace", () => {
    const dated = { ...data, value: { ...answer, carte_mise_a_jour: edited } };
    for (const html of [randonneesPage(O, dated, NOW), secteurPage(O, mafate, dated, null, NOW)]) {
      expect(html).toContain(`<span><i class="sw inconnu"></i>hors gestion ONF</span>${traceSource(edited, true)}</figcaption>`);
    }
    expect(tracePage(O, "sentier", "x", "X", trace("sentier", edited), NOW)).toContain(`<span><i class="sw st"></i>départ</span>${traceSource(edited, false)}</figcaption>`);
    expect(tracePage(O, "randonnee", "x", "X", trace("randonnee", edited), NOW)).toContain(`<span><i class="sw st"></i>départ</span>${traceSource(edited, true)}</figcaption>`);
    expect(CSS).toContain(".legend .mls{flex-basis:100%;white-space:normal}");
  });
});
