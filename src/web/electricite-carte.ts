/**
 * /electricite's map and chart (marketing's charter of the maps, 31/10/2026: the « rond proportionnel », the filières'
 * colours in each theme):
 * - The map: the power installed in each commune, filière by filière, from the national register of the installations
 *   as EDF SEI publishes it (src/electricite/installations.json, scripts/build-installations.py). It stays still: EDF
 *   publishes the production for the whole island, never plant by plant, so nothing on the map says what produces now.
 *   A round per filière, its area as its MW, grouped around the commune's centre, the biggest under; one zone to touch
 *   per commune, its bubble listing them all.
 * - The chart: the island's production over EDF's last 24 hours, the renewable filières under, the others over (the
 *   batteries left out, `produced`), a cursor on the moment said under it. Its replay moves the cursor alone.
 */
import data from "../electricite/installations.json" with { type: "json" };
import { resolvePlace } from "../places/resolve.js";
import type { Journee } from "./data.js";
import { esc, H, islandMap, project, W } from "./map.js";
import { slugify } from "./places.js";

interface Filiere { nom: string; mw: number; installations: number }
interface Commune { commune: string; filieres: Filiere[] }

const INSTALLATIONS = data as { mis_a_jour: string; communes: Commune[] };

/** Each filière of the register: its class, for its colour in each theme (ELECTRICITE_CSS). */
const CLASSE: Record<string, string> = {
  "bioénergies": "f-bio",
  "solaire": "f-sol",
  "hydraulique": "f-hyd",
  "éolien": "f-eol",
  "thermique non renouvelable": "f-the",
  "stockage non hydraulique": "f-sto",
};
/** The legend's order: the renewable filières, then the others. */
const ORDRE = Object.keys(CLASSE);

/**
 * A round's diameter in the map's units: its area as its MW, 211 MW (the biggest) 120 units, about 64 px on the
 * computer's map and 40 px on a phone's; never under 30 units, 10 px on a phone, or it would not be seen.
 */
export const diametre = (mw: number) => Math.max(30, 8.26 * Math.sqrt(mw));

const mwText = (mw: number) => `${mw >= 10 ? Math.round(mw) : mw >= 1 ? mw.toFixed(1).replace(".", ",") : mw.toFixed(2).replace(".", ",")}\u00a0MW`;
const installations = (n: number) => `${n.toLocaleString("fr-FR")}\u00a0installation${n > 1 ? "s" : ""}`;
const jourMois = (iso: string) => iso.split("-").reverse().join("/");
export const MIS_A_JOUR = jourMois(INSTALLATIONS.mis_a_jour);

/** A commune's filières, the strongest first: « bioénergies 211 MW (1 installation) · solaire 12 MW (… installations) ». */
const total = (c: Commune) => c.filieres.reduce((n, f) => n + f.mw, 0);
export const filieresText = (c: Commune) =>
  c.filieres.map((f) => `${f.nom} ${mwText(f.mw)} (${installations(f.installations)})`).join(" · ");

/** Where each round of a commune goes: the biggest on the centre, the others around it, each touching its edge. */
function placer([x, y]: [number, number], fs: Filiere[]): { f: Filiere; x: number; y: number; r: number }[] {
  const [big, ...rest] = fs;
  const R = diametre(big.mw) / 2;
  return [{ f: big, x, y, r: R }, ...rest.map((f, k) => {
    const r = diametre(f.mw) / 2;
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / Math.max(rest.length, 3);
    const d = R * 0.7 + r * 0.5;
    return { f, x: x + d * Math.cos(a), y: y + d * Math.sin(a), r };
  })];
}

/** The map, the reference rounds at the map's own scale, then the legend. `HIT`: a finger's zone, 66 units (map.ts). */
export function installationsMap(): string {
  const communes = INSTALLATIONS.communes.flatMap((c) => {
    const at = resolvePlace(c.commune)?.lieu;
    return at && c.filieres.length ? [{ c, xy: project(at.lon, at.lat) }] : [];
  });
  const groups = communes.map(({ c, xy }) => {
    const rounds = placer(xy, c.filieres);
    const reach = Math.max(66, ...rounds.map((p) => Math.hypot(p.x - xy[0], p.y - xy[1]) + p.r));
    const said = `${c.commune} : ${filieresText(c)}, registre d'EDF mis à jour le ${MIS_A_JOUR}`;
    return `<a class="mk ip" href="#inst-${slugify(c.commune)}" aria-label="${esc(said)}" data-tp="${esc(c.commune)}" data-tv="${esc(filieresText(c))}" data-td="${esc(`registre d'EDF mis à jour le ${MIS_A_JOUR}`)}">` +
      `<title>${esc(c.commune)}</title><circle class="hit" cx="${xy[0]}" cy="${xy[1]}" r="${Math.round(reach)}" style="fill:transparent;stroke:none"/>` +
      rounds.map((p) => `<circle class="sh ${CLASSE[p.f.nom] ?? "f-sto"}" cx="${Math.round(p.x)}" cy="${Math.round(p.y)}" r="${Math.round(p.r)}"/>`).join("") + `</a>`;
  }).join("");
  const label = `Carte de La Réunion : puissance installée par commune et par filière, d'après le registre d'EDF mis à jour le ${MIS_A_JOUR}`;
  // The names of the communes with the most power first: a big round's commune keeps its name, its neighbour gives way.
  const first = [...communes].sort((a, b) => total(b.c) - total(a.c)).map(({ c }) => c.commune);
  const map = islandMap({ top: `<g class="ips">${groups}</g>`, label, first });
  return map;
}

/** The legend under the map: the filières present, three reference rounds at the map's scale, then the source. */
export function installationsLegend(): string {
  const present = new Set(INSTALLATIONS.communes.flatMap((c) => c.filieres.map((f) => f.nom)));
  const keys = ORDRE.filter((n) => present.has(n)).map((n) =>
    `<span><svg viewBox="-20 -20 40 40" aria-hidden="true"><circle class="${CLASSE[n]}" r="15"/></svg>${esc(n)}</span>`).join("");
  // The reference rounds at the map's scale: each in its own SVG, as wide against the legend as the round against the
  // map (the legend is as wide as the map); their words in HTML beside them, at the page's text size.
  const refs = [10, 50, 200].map((mw) => {
    const d = diametre(mw) + 8;
    return `<svg viewBox="0 0 ${d.toFixed(1)} ${d.toFixed(1)}" style="width:${((d / W) * 100).toFixed(2)}%" aria-hidden="true">` +
      `<circle cx="${(d / 2).toFixed(1)}" cy="${(d / 2).toFixed(1)}" r="${(diametre(mw) / 2).toFixed(1)}"/></svg><span>${mwText(mw)}</span>`;
  }).join("");
  return `<span class="mlg ipk">${keys}</span>` +
    `<span class="iprw">${refs}</span>` +
    `<span class="mls">Puissance installée par commune et par filière, d'après le registre national des installations, mis à jour par EDF SEI le ${MIS_A_JOUR}. EDF publie la production pour toute l'île, filière par filière, pas centrale par centrale\u00a0: la carte montre ce qui peut produire, pas ce qui produit en ce moment.</span>`;
}

/** Each commune's line, where its zone on the map leads: its filières, the strongest first. */
export function installationsList(): string {
  return `<ul class="rows inst">${INSTALLATIONS.communes.map((c) =>
    `<li id="inst-${slugify(c.commune)}" class="tgt"><b>${esc(c.commune)}</b><span>${esc(filieresText(c))}</span></li>`).join("")}</ul>`;
}

// ---------------------------------------------------------------- the chart of the 24 hours

/** The plot in its own units; its graduations are HTML around it, at the page's text sizes on a phone as on a computer. */
const CW = 1000;
const CH = 480;

const hm = (t: number) => new Date(t + 4 * 3600_000).toISOString().slice(11, 16);
const dm = (t: number) => { const d = new Date(t + 4 * 3600_000).toISOString(); return `${d.slice(8, 10)}/${d.slice(5, 7)}`; };
const pct = (ren: number, non: number) => (ren + non > 0 ? Math.round((ren / (ren + non)) * 100) : 0);
const at = (v: number) => `${(v * 100).toFixed(2)}%`;

/** What the cursor says, as the script says it (CHART_SCRIPT): « 31/10 à 05:20 : 281 MW produits, dont 95 % renouvelable. » */
export const momentText = (t: number, total: number, ren: number, non: number) =>
  `${dm(t)} à ${hm(t)}\u00a0: ${Math.round(total)}\u00a0MW produits, dont ${pct(ren, non)}\u00a0% renouvelable.`;

/** The chart, its cursor on the latest point; beside it (under it on a phone) the words of that moment, the replay's bar, the source. */
export function productionChart(j: Journee): string {
  const t0 = Date.parse(j.debut);
  const pts = j.points;
  const last = pts[pts.length - 1];
  const span = Math.max(last[0], 60);
  const top = Math.max(100, Math.ceil(Math.max(...pts.map((p) => p[1] + p[2])) / 100) * 100);
  const X = (m: number) => (CW * m) / span;
  const Y = (mw: number) => CH - (CH * mw) / top;
  // Each area down to the axis: the whole production behind, the renewable part over it; whole units, under a pixel.
  const area = (f: (p: (typeof pts)[number]) => number) =>
    `M${Math.round(X(pts[0][0]))} ${CH}L${pts.map((p) => `${Math.round(X(p[0]))} ${Math.round(Y(f(p)))}`).join("L")}L${Math.round(X(last[0]))} ${CH}Z`;
  const levels = Array.from({ length: top / 100 + 1 }, (_, k) => k * 100);
  const grid = levels.map((mw) => `<line x1="0" x2="${CW}" y1="${Y(mw)}" y2="${Y(mw)}"/>`).join("");
  // The hours: every 6 hours, on the round hour.
  const first = Math.ceil((t0 + 4 * 3600_000) / (6 * 3600_000)) * 6 * 3600_000 - 4 * 3600_000;
  const hours: number[] = [];
  for (let t = first; t <= t0 + span * 60_000; t += 6 * 3600_000) hours.push(t);
  const tl = t0 + last[0] * 60_000;
  const lows = Math.min(...pts.map((p) => pct(p[1], p[2])));
  const highs = Math.max(...pts.map((p) => pct(p[1], p[2])));
  const label = `Production d'électricité de l'île sur 24\u00a0h, de ${hm(t0)} à ${hm(tl)}\u00a0: part renouvelable de ${lows}\u00a0% à ${highs}\u00a0%.`;
  const svg = `<svg class="ech" viewBox="0 0 ${CW} ${CH}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">` +
    `<g class="cg">${grid}</g><path class="ar ar-non" d="${area((p) => p[1] + p[2])}"/><path class="ar ar-ren" d="${area((p) => p[1])}"/>` +
    `<line class="cur" x1="${X(last[0])}" x2="${X(last[0])}" y1="0" y2="${CH}" vector-effect="non-scaling-stroke"/></svg>`;
  const ys = levels.map((mw) => `<span class="cy" style="top:${at(Y(mw) / CH)}">${mw === top ? `${mw}\u00a0MW` : mw}</span>`).join("");
  const xs = hours.map((t) => `<span class="cx" style="left:${at(X((t - t0) / 60_000) / CW)}">${hm(t)}</span>`).join("");
  const keys = `<span class="mlg"><span><svg viewBox="-20 -20 40 40" aria-hidden="true"><rect class="ar-ren" x="-15" y="-15" width="30" height="30" rx="4"/></svg>renouvelable</span>` +
    `<span><svg viewBox="-20 -20 40 40" aria-hidden="true"><rect class="ar-non" x="-15" y="-15" width="30" height="30" rx="4"/></svg>non renouvelable</span></span>`;
  const bar = `<div class="rj ech-rj" hidden><button type="button" class="rj-b" aria-label="Lire les 24\u00a0dernières heures">▶ Lire</button>` +
    `<input type="range" min="0" max="${pts.length - 1}" step="1" value="${pts.length - 1}" aria-label="Moment affiché sur le graphique"></div>`;
  const source = `Production d'électricité de l'île sur 24\u00a0h, toutes les 5\u00a0minutes, estimée par EDF${j.mis_a_jour ? ` (mise à jour le ${esc(j.mis_a_jour.replace(" ", " à "))})` : ""}. Part renouvelable selon les filières d'EDF, sans les batteries.`;
  // The points for the script, in whole MW: what it says is rounded the same.
  const data = esc(JSON.stringify({ t0, s: span, p: pts.map((p) => p.map(Math.round)) }));
  return `<figure class="card ecard" data-ech="${data}"><div class="ech-g"><div class="ech-p">${svg}<span aria-hidden="true">${ys}${xs}</span></div>` +
    `<figcaption class="note"><p class="ech-m" aria-live="polite">${esc(momentText(tl, Math.round(last[3]), Math.round(last[1]), Math.round(last[2])))}</p>${bar}${keys}<span class="mls">${source}</span></figcaption></div></figure><script>${CHART_SCRIPT}</script>`;
}

/**
 * The replay of the chart: the slider and the button move the cursor from point to point, and the words under the chart
 * follow it; over PLAY_MS for the 24 hours, from the start or from where the slider is. Without a script, the cursor stays
 * on the latest point and the bar stays hidden; with less motion asked, no button (ELECTRICITE_CSS), the slider only.
 */
const PLAY_MS = 12_000;
const CHART_SCRIPT = `(()=>{const f=document.querySelector("[data-ech]");if(!f)return;const J=JSON.parse(f.dataset.ech),P=J.p,bar=f.querySelector(".ech-rj"),b=bar.querySelector("button"),rg=bar.querySelector("input"),cur=f.querySelector(".cur"),m=f.querySelector(".ech-m");
const hm=(t)=>new Date(t+144e5).toISOString().slice(11,16),dm=(t)=>{const d=new Date(t+144e5).toISOString();return d.slice(8,10)+"/"+d.slice(5,7)},pc=(r,n)=>r+n>0?Math.round(r/(r+n)*100):0;
const show=(i)=>{const p=P[i],x=1e3*p[0]/J.s,t=J.t0+p[0]*6e4;cur.setAttribute("x1",x);cur.setAttribute("x2",x);rg.value=i;m.textContent=dm(t)+" à "+hm(t)+"\\u00a0: "+Math.round(p[3])+"\\u00a0MW produits, dont "+pc(p[1],p[2])+"\\u00a0% renouvelable."};
let run=0;const stop=()=>{cancelAnimationFrame(run);run=0;b.textContent="▶ Lire";b.setAttribute("aria-label","Lire les 24\\u00a0dernières heures")};
b.addEventListener("click",()=>{if(run)return stop();let from=+rg.value;if(from>=P.length-1)from=0;const s=performance.now()-from/(P.length-1)*${PLAY_MS};b.textContent="❚❚ Pause";b.setAttribute("aria-label","Arrêter");
const step=(now)=>{const i=Math.min(P.length-1,Math.round((now-s)/${PLAY_MS}*(P.length-1)));show(i);if(i>=P.length-1)return stop();run=requestAnimationFrame(step)};run=requestAnimationFrame(step)});
rg.addEventListener("input",()=>{if(run)stop();show(+rg.value)});bar.hidden=false})();`;

/** Their style, in the page's sheet: the filières' and the areas' colours in each theme (marketing, 31/10/2026). */
// `.ipm`: the map's room, kept while it waits to be put in the page (laterMap()).
export const ELECTRICITE_CSS = `.ipm{aspect-ratio:${W}/${H}}` +
  `:root{--f-sol:#b97f00;--f-bio:#2b8a46;--f-hyd:#1c6fc2;--f-eol:#4fa3c7;--f-the:#5a6672;--f-sto:#7048e8;--a-ren:#2b8a46;--a-non:#5a6672}` +
  `@media (prefers-color-scheme:dark){:root{--f-sol:#ffcf1f;--f-bio:#5ee08a;--f-hyd:#4dabf7;--f-eol:#a5d8ff;--f-the:#8a96a3;--f-sto:#b197fc;--a-ren:#5ee08a;--a-non:#8a96a3}}` +
  `.f-sol{fill:var(--f-sol)}.f-bio{fill:var(--f-bio)}.f-hyd{fill:var(--f-hyd)}.f-eol{fill:var(--f-eol)}.f-the{fill:var(--f-the)}.f-sto{fill:var(--f-sto)}` +
  `.map .ip circle:not(.hit){stroke:#fff;stroke-width:4}.mlg.ipk circle{stroke:#fff;stroke-width:4}` +
  `.iprw{display:flex;align-items:center;gap:.35rem;margin:.3rem 0 .5rem}.iprw svg{height:auto;flex:none}.iprw circle{fill:none;stroke:var(--muted);stroke-width:4}.iprw>span{color:var(--muted);font-weight:600;font-size:.82rem;white-space:nowrap;margin-right:.9rem}` +
  `.ech-g{display:grid;gap:1rem}@media (min-width:58rem){.ech-g{grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);align-items:start}}` +
  `.ech-p{position:relative;margin:.6rem 0 1.9rem 3.1rem}.ech{display:block;width:100%;height:auto;aspect-ratio:${CW}/${CH};overflow:visible}.ech .cg line{stroke:var(--line);stroke-width:2;vector-effect:non-scaling-stroke}` +
  `.ech-p .cy,.ech-p .cx{position:absolute;color:var(--muted);font-size:.8rem;font-weight:600;line-height:1;white-space:nowrap}.ech-p .cy{right:calc(100% + .4rem);transform:translateY(-50%)}.ech-p .cx{top:calc(100% + .45rem);transform:translateX(-50%)}` +
  `.ar-ren{fill:var(--a-ren)}.ar-non{fill:var(--a-non)}.ech .cur{stroke:var(--ink);stroke-width:2.5}.ech-m{font-weight:700;font-size:1.05rem;color:var(--ink);margin:0 0 .5rem}` +
  `.ech-rj{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin:.4rem 0}.ech-rj[hidden]{display:none}` +
  `.ech-rj button{min-height:44px;padding:.35rem .95rem;border-radius:999px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);font:inherit;font-weight:700;cursor:pointer}` +
  `.ech-rj input{flex:1 1 12rem;min-height:44px;accent-color:var(--ink)}@media (prefers-reduced-motion:reduce){.ech-rj button{display:none}}` +
  `.rows.inst li{display:flex;flex-wrap:wrap;gap:.2rem .8rem}.rows.inst li>span{color:var(--muted)}.ipc details{margin-top:.8rem}.ipc summary h3{display:inline;font-size:1rem}` +
  `@media (max-width:37.49rem){.ech{aspect-ratio:${CW}/700}}`;
