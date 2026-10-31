/**
 * The map of the south-west Indian Ocean on /cyclones, all year: the lands (ocean.json, scripts/build-ocean.py), the
 * zone the RSMC of La Réunion watches, dotted, and La Réunion. It never shows a system's forecast, neither its track
 * nor a cone nor a distance: for the people's safety, the site shows Météo-France's own map and links to its site
 * (kit.md, « Vigilance et cyclone : affichage de Météo-France », after Météo-France's mail of 27/10/2026). While a
 * system is watched, the line under the map sends to that official map, shown whole above it (cmrs-carte.ts), and
 * the map shows only the path the system has already travelled, its positions at the RSMC's advisories, once
 * Météo-France agrees (providers/cmrs-trace.ts, the user's decision of 31/10/2026); before that, nothing else. The rest of the time, it draws the tracks of the past cyclones
 * that have a page /cyclones/<slug>, as the RSMC gave them (cyclones-traces.json: Météo-France's best track, the older
 * ones from NOAA's IBTrACS; the user's
 * yes of 31/10/2026): the line only, with its name and year, no wind nor pressure nor stage.
 */
import best from "../historique/cyclones-traces.json" with { type: "json" };
import type { Parcours } from "../providers/cmrs-trace.js";
import { PASSES } from "../historique/cyclones-passes.js";
import ocean from "./ocean.json" with { type: "json" };
import { esc } from "./map.js";

/** The frame, in degrees: the RSMC's zone (from Africa to 90° E, the equator to 40° S) with a margin. */
const LON0 = 28, LON1 = 92, LAT0 = -44, LAT1 = 2;
/** Degrees of longitude shortened as at 20° S, the middle of the basin's islands. */
const KX = Math.cos((20 * Math.PI) / 180);
export const W = 1000;
export const H = Math.round((W * (LAT1 - LAT0)) / ((LON1 - LON0) * KX));

export const xy = (lon: number, lat: number): [number, number] => [Math.round(((lon - LON0) / (LON1 - LON0)) * W), Math.round(((LAT1 - lat) / (LAT1 - LAT0)) * H)];
const line = (p: number[][]) => p.map(([lon, lat], i) => `${i ? "L" : "M"}${xy(lon, lat).join(" ")}`).join("");

/**
 * The limits of the RSMC's zone of responsibility: the equator, 90° E and 40° S, from the coast of Africa. Source:
 * the RSMC of La Réunion's presentation of its basin to the WMO (2017): the eastern limit moved from 80° E
 * to 90° E in September 1985, the zone grew from 30° S to 40° S and from 5° S to the equator in September 2003.
 */
export const ZONE_CMRS = { nord: 0, est: 90, sud: -40 };
export const ZONE_SOURCE = "https://severeweather.wmo.int/TCFW/RAI_Training2017/01_SWIO_BasinConfiguration_SebastienLanglade.pdf";
/** Where the equator meets the coast of Africa (Somalia), where the zone begins. */
const COAST_AT_EQUATOR = 42.1;

/** The names of the lands, Madagascar's along the island. */
const LANDS: { nom: string; lon: number; lat: number; turn?: number }[] = [
  { nom: "Afrique", lon: 33.5, lat: -7.5 },
  { nom: "Madagascar", lon: 46.75, lat: -19.3, turn: -73 },
];
/** The islands too small at this scale, drawn as named dots; `dx`, `dy`: where the name starts, `end` when it ends there. */
const ISLETS: { nom: string; lon: number; lat: number; dx: number; dy: number; end?: true }[] = [
  { nom: "Maurice", lon: 57.55, lat: -20.25, dx: 10, dy: -32 },
  { nom: "Rodrigues", lon: 63.42, lat: -19.72, dx: 16, dy: 18 },
  { nom: "Mayotte", lon: 45.15, lat: -12.82, dx: -12, dy: 24, end: true },
  { nom: "Comores", lon: 43.33, lat: -11.7, dx: -16, dy: -10, end: true },
  { nom: "Seychelles", lon: 55.45, lat: -4.62, dx: 16, dy: 0 },
];
const REUNION = { lon: 55.53, lat: -21.13 };

/**
 * Where each past cyclone's number goes, on its track towards its end, where it leaves the basin, in the map's units:
 * the list under the map names them by these numbers (marketing, 31/10/2026: nine names do not fit by their tracks'
 * ends). Found by a search along the second half of each track: no number over another, a name, land, an island or a
 * graduation, the nearest to the end and over the fewest other tracks; then set here, as the communes' names are. The
 * side of its name, shown while it is lit: the first of right, left and above clear of the map's names and graduations
 * (the other numbers are then faded under it).
 */
const TRACE_MARKS: Record<string, [number, number, "droite" | "gauche" | "dessus"]> = {
  "garance-2025": [620, 612, "droite"],
  "belal-2024": [410, 579, "droite"],
  "batsirai-2022": [315, 669, "dessus"],
  "gamede-2007": [260, 583, "droite"],
  "dina-2002": [542, 632, "droite"],
  "colina-1993": [453, 486, "droite"],
  "firinga-1989": [398, 632, "droite"],
  "clotilda-1987": [670, 600, "gauche"],
  "hyacinthe-1980": [443, 670, "gauche"],
};
/** The past cyclones drawn: their page, name, year and track. */
export const TRACES = PASSES.map((p) => {
  const t = (best.traces as Record<string, { source: string; points: number[][] }>)[p.slug];
  return { slug: p.slug, nom: p.nom, annee: p.slug.slice(-4), points: t.points, source: t.source, nom_annee: `${p.nom} (${p.slug.slice(-4)})` };
});
/** Météo-France's best track from the season 1986-1987 (Licence Ouverte 2.0), IBTrACS for a cyclone before it. */
export const TRACES_SOURCES = { ...best.sources, consulte: best.consulte };

/** An advisory's time in La Réunion (UTC+4, no summer time): « 23/10 à 16:00 ». */
export function avisLe(iso: string): string {
  const t = new Date(Date.parse(iso) + 4 * 3_600_000).toISOString();
  return `${t.slice(8, 10)}/${t.slice(5, 7)} à ${t.slice(11, 16)}`;
}

/** A system's last advisory, as written by its last position: « Agueda, dépression résiduelle, avis du 23/10 à 16:00 ». */
export const dernierAvis = (p: Parcours) => `${p.nom}, ${p.stade}, avis du ${avisLe(p.heure)}`;

/** The text the map stands for, said to screen readers. */
export function label(traces: boolean, parcours: Parcours[] = []): string {
  return "Carte du sud-ouest de l'océan Indien : l'Afrique de l'Est, Madagascar, les Comores, les Seychelles et les Mascareignes, " +
    "avec La Réunion. En pointillé, la zone suivie par le CMRS de La Réunion, de l'équateur à 40° S et des côtes de l'Afrique à 90° E. " +
    (traces ? `En traits numérotés, la trace des cyclones passés\u00a0: ${TRACES.map((t, i) => `${i + 1}, ${t.nom_annee}`).join("\u00a0; ")}. Aucun système de la saison n'y est dessiné.`
      : parcours.length ? `En trait plein, le chemin déjà parcouru, d'après les avis du CMRS\u00a0: ${parcours.map(dernierAvis).join("\u00a0; ")} (heure de La Réunion). Aucune trajectoire prévue.`
      : "Cette carte ne montre aucun système.");
}

/** Where a system's name goes by its last position: on its right, or on its left near the map's right edge. */
const NAME_ROOM = 380;

/**
 * The map; `traces`: the past cyclones' tracks, only while no system is watched; `parcours`: the path travelled by
 * each watched system, its positions at the RSMC's advisories, the last named with its stage and time (never a
 * forecast).
 */
export function basinMap(traces = false, parcours: Parcours[] = []): string {
  const land = ocean.rings.map((r) => `${line(r)}Z`).join("");
  let grid = "";
  for (let lon = 30; lon <= 90; lon += 10) {
    const [x] = xy(lon, 0);
    grid += `<path class="grat" d="M${x} 0V${H}"/>` + (lon < 90 ? `<text class="gl" x="${x + 8}" y="${H - 18}">${lon}° E</text>` : "");
  }
  for (let lat = 0; lat >= -40; lat -= 10) {
    const [, y] = xy(0, lat);
    grid += `<path class="grat" d="M0 ${y}H${W}"/>` + (lat > -40 ? `<text class="gl" x="${W - 46}" y="${y + (lat ? -20 : 26)}" style="text-anchor:end">${lat ? `${-lat}° S` : "Équateur"}</text>` : "");
  }
  const z = ZONE_CMRS;
  const zone = `<path class="zone" d="${line([[COAST_AT_EQUATOR, z.nord], [z.est, z.nord], [z.est, z.sud], [LON0 - 1, z.sud]])}"/>`;
  const [zx, zy] = xy(z.est, z.sud);
  const zoneName = `<text class="zl" x="${zx - 18}" y="${zy - 24}" style="text-anchor:end">Zone suivie par le CMRS</text>`;
  const names = LANDS.map((l) => {
    const [x, y] = xy(l.lon, l.lat);
    return `<text class="ln" x="${x}" y="${y}"${l.turn ? ` transform="rotate(${l.turn} ${x} ${y})"` : ""}>${esc(l.nom)}</text>`;
  }).join("");
  const islets = ISLETS.map((i) => {
    const [x, y] = xy(i.lon, i.lat);
    return `<g class="islet"><circle cx="${x}" cy="${y}" r="7"/><text x="${x + i.dx}" y="${y + i.dy}"${i.end ? ' style="text-anchor:end"' : ""}>${esc(i.nom)}</text></g>`;
  }).join("");
  // Its name under it: Madagascar on its left, Maurice and Rodrigues on its right.
  const [hx, hy] = xy(REUNION.lon, REUNION.lat);
  const home = `<g class="home"><circle cx="${hx}" cy="${hy}" r="12"/><text x="${hx}" y="${hy + 42}">La Réunion</text></g>`;
  // Each track a link to its page, kept from the keyboard: the same links follow the map, in its caption, numbered.
  const tracks = traces ? `<g class="trc">${TRACES.map((t, i) => {
    const [x, y] = TRACE_MARKS[t.slug];
    return `<a href="/cyclones/${t.slug}" tabindex="-1"><title>${esc(t.nom_annee)}</title><path class="hit" d="${line(t.points)}"/><path d="${line(t.points)}"/>` +
      `<g class="nb"><circle cx="${x}" cy="${y}" r="22"/><text x="${x}" y="${y}">${i + 1}</text></g></a>`;
  }).join("")}</g>` : "";
  // Its name by its number, shown while it is lit (the charter's « Dina (2002) »), over everything else on the map.
  const lit = traces ? `<g class="tns">${TRACES.map((t) => {
    const [x, y, side] = TRACE_MARKS[t.slug];
    return side === "dessus" ? `<text x="${x}" y="${y - 46}" style="text-anchor:middle">${esc(t.nom_annee)}</text>`
      : side === "gauche" ? `<text x="${x - 30}" y="${y}" style="text-anchor:end">${esc(t.nom_annee)}</text>`
      : `<text x="${x + 30}" y="${y}">${esc(t.nom_annee)}</text>`;
  }).join("")}</g>` : "";
  // The path travelled: a line through the positions, a dot at each, the last larger, named over everything else.
  const cur = traces ? "" : parcours.map((p) => {
    const at = p.points.map(([lon, lat]) => xy(lon, lat));
    const [x, y] = at[at.length - 1];
    const left = x > W - NAME_ROOM;
    const tx = left ? x - 24 : x + 24, ty = Math.max(y, 56);
    const anchor = left ? ' style="text-anchor:end"' : "";
    return `<g class="cur">${at.length > 1 ? `<path d="${line(p.points)}"/>` : ""}${at.slice(0, -1).map(([px, py]) => `<circle cx="${px}" cy="${py}" r="6"/>`).join("")}` +
      `<circle class="last" cx="${x}" cy="${y}" r="13"/><text class="cn" x="${tx}" y="${ty - 20}"${anchor}>${esc(p.nom)}</text>` +
      `<text x="${tx}" y="${ty + 20}"${anchor}>${esc(`${p.stade}, ${avisLe(p.heure)}`)}</text></g>`;
  }).join("");
  return `<svg class="map ocean" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label(traces, parcours))}">` +
    `<rect class="sea" width="${W}" height="${H}" rx="28"/>${grid}<path class="land" d="${land}"/><path class="shore" d="${land}"/>` +
    tracks + zone + zoneName + names + islets + home + lit + cur + `</svg>`;
}

/**
 * A past cyclone pointed at lights up: its track, its number, its name by its number and its line in the list, the
 * others faded. With the mouse, on its track or its line; with a finger, the track nearest the finger within 22 px
 * lights, and a second touch on it opens its page (as the communes' names, carte-points.ts); the list's links open at
 * once. Without the script, the tracks are links, and the mouse alone lights one (CSS :hover), its name in its title;
 * with it, only the script lights them (`js`): Safari keeps :hover on the last track touched.
 */
export const TRACES_SCRIPT = `(()=>{const f=document.querySelector("figure.bassin"),g=f&&f.querySelector(".trc");if(!g)return;g.classList.add("js");const s=g.closest("svg"),t=[...g.querySelectorAll("a")],l=[...f.querySelectorAll(".trcs a")],n=[...s.querySelectorAll(".tns text")],` +
  `P=t.map((a)=>{const n=a.querySelector("path").getAttribute("d").match(/-?\\d+/g).map(Number),p=[];for(let i=0;i<n.length;i+=2)p.push([n[i],n[i+1]]);return p});let cur=-1,touch=false;` +
  `const on=(i)=>{cur=i;g.classList.toggle("focus",i>=0);t.forEach((a,k)=>a.classList.toggle("on",k===i));l.forEach((a,k)=>a.classList.toggle("on",k===i));n.forEach((a,k)=>a.classList.toggle("on",k===i));};` +
  `t.concat(l).forEach((a,j)=>{const i=j%t.length;a.addEventListener("pointerenter",(e)=>{if(e.pointerType==="mouse")on(i)});a.addEventListener("pointerleave",(e)=>{if(e.pointerType==="mouse")on(-1)})});` +
  `l.forEach((a,i)=>{a.addEventListener("focus",()=>on(i));a.addEventListener("blur",()=>on(-1))});s.addEventListener("pointerdown",(e)=>{touch=e.pointerType!=="mouse"},true);` +
  `const d2=(p,a,b)=>{const x=b[0]-a[0],y=b[1]-a[1],L=x*x+y*y,u=L?Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/L)):0,X=a[0]+u*x-p[0],Y=a[1]+u*y-p[1];return X*X+Y*Y};` +
  `s.addEventListener("click",(e)=>{if(!touch)return;e.preventDefault();const r=s.getBoundingClientRect(),k=s.viewBox.baseVal.width/r.width,p=[(e.clientX-r.left)*k,(e.clientY-r.top)*k];let b=-1,d=(22*k)**2;` +
  `P.forEach((q,i)=>{for(let j=1;j<q.length;j++){const v=d2(p,q[j-1],q[j]);if(v<d){d=v;b=i}}});if(b>=0&&b===cur)location.href=t[b].getAttribute("href");else on(b)},true)})();`;
