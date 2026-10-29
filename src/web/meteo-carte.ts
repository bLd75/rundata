/**
 * The map at the top of /meteo: every station that measured, one measure at a time (temperature, rain of the last
 * hour, wind), and under the temperatures a veil estimated between the stations with the altitude, drawn by the
 * page's script from a small grid of the island's altitudes (scripts/build-altitudes.py). The points are the measures;
 * the veil, an estimate, says so in its legend.
 */
import { INSEE } from "../places/insee.js";
import altitudes from "./altitudes.json" with { type: "json" };
import { fr } from "../tools/format.js";
import type { StationNow } from "./data.js";
import { esc, H, islandMap, project, W } from "./map.js";
import { chip, deg, hm, metres, shortName, stationId, thin } from "./pages.js";

const COMMUNE_OF_INSEE = new Map(Object.entries(INSEE).map(([nom, code]) => [code, nom]));

/** The commune of a station: from its INSEE code for Météo-France, else the nearest Météo-France station's. */
export function communeOf(s: StationNow, all: StationNow[]): string | undefined {
  const own = (x: StationNow) => (x.source === "meteofrance" && x.id ? COMMUNE_OF_INSEE.get(x.id.slice(0, 5)) : undefined);
  if (own(s)) return own(s);
  const near = all.filter((x) => own(x)).sort((a, b) => Math.hypot(a.lon - s.lon, a.lat - s.lat) - Math.hypot(b.lon - s.lon, b.lat - s.lat))[0];
  return near && own(near);
}

const by = (s: StationNow) =>
  s.source === "meteofrance" ? " par Météo-France" : s.source === "metar" ? " par l'aéroport (METAR)" : s.source === "pioupiou" ? ` par OpenWindMap (${s.nom.replace(/^Balise /, "balise de ")})` : "";

// Where the wind comes from, in words: abbreviations read badly (« vent O » as « vent 0 »).
const FROM = ["du nord", "du nord-est", "d'est", "du sud-est", "du sud", "du sud-ouest", "d'ouest", "du nord-ouest"];

/** A tile's wind: an arrow where it goes, the speed; the whole said to a screen reader and on hover. */
export function windPill(s: StationNow): string {
  const said = ventText(s);
  if (!said) return "";
  const arrow = s.direction != null && s.vent ? `<svg class="ar" viewBox="0 0 16 16" style="transform:rotate(${(s.direction + 180) % 360}deg)"><path d="M8 14V3M4 7l4-4 4 4"/></svg>` : "";
  return `<span class="pl" title="${esc(said)}"><span aria-hidden="true">${arrow}${thin(`${s.vent} km/h`)}</span><span class="sr">${esc(said)}</span></span>`;
}

/** A tile's rain: of the last hour, else of the last 6 minutes; blue while it rains. */
export function rainPill(s: StationNow): string {
  const v = s.pluie_1h ?? s.pluie_6min;
  if (v == null) return "";
  const hour = s.pluie_1h != null;
  const said = thin(v > 0 ? `${fr(v)} mm de pluie ${hour ? "dans l'heure" : "en 6\u202fmin"}` : `pas de pluie mesurée ${hour ? "depuis 1\u202fh" : "en 6\u202fmin"}`);
  return `<span class="pl${v > 0 ? " wet" : ""}" title="${esc(said)}"><span aria-hidden="true"><svg class="dr" viewBox="0 0 16 16"><path d="M8 2C6 5 4 7.5 4 10a4 4 0 0 0 8 0c0-2.5-2-5-4-8z"/></svg>${thin(`${fr(v)} mm`)}</span><span class="sr">${esc(said)}</span></span>`;
}

/** « vent d'est 12 km/h, rafales 20 km/h ». */
export function ventText(s: StationNow): string | undefined {
  if (s.vent == null) return undefined;
  const from = s.direction != null ? `${FROM[Math.round(s.direction / 45) % 8]} ` : "";
  return thin(`vent ${from}${s.vent} km/h${s.rafales != null ? `, rafales ${s.rafales} km/h` : ""}`);
}

/** Rain of the last hour: deeper blue as it rains harder. */
function rainColor(mm: number): string {
  return mm >= 10 ? "#1b3f8f" : mm >= 4 ? "#2456b8" : mm >= 1 ? "#3a73d0" : "#5b8fd8";
}

// The veil's colours by temperature, lighter than the dots' (chip()), from the same 8 to 33 °C.
const VEIL: [number, number[]][] = [[8, [42, 106, 154]], [17, [36, 140, 120]], [24, [214, 168, 40]], [28, [222, 112, 40]], [33, [200, 48, 28]]];
const STOPS_LO = VEIL[0][0];
const STOPS_HI = VEIL[VEIL.length - 1][0];
const HIT = 66;

/** The island's altitudes on a small grid (scripts/build-altitudes.py), a file of public/; its address changes with it. */
export const ALT_PATH = `/altitudes-${altitudes.v}.png`;
/** Under the stations' sources: the altitudes of the colours estimated between them. */
export const ALTITUDES_CREDIT = { source: "IGN, RGE ALTI, pour les altitudes des couleurs estimées", licence: "Licence Ouverte 2.0", attribution: "IGN, RGE ALTI" };

// The stations whose value the map writes: the tour of the island; the others are dots, told on hover or tap.
const NAMED = new Set(["97418110", "97407520", "97415590", "97416463", "97417360", "97410238", "97419350", "97422440", "97424410", "97415566"]);

/** A dot of one layer (`l`): a disc with its value, or a small one without, told by the bubble. */
function dot(l: string, x: number, y: number, fill: string, label: string | undefined, hollow = false): string {
  const r = label ? 34 : 17;
  const shape = hollow
    ? `<circle class="sh l-${l}" cx="${x}" cy="${y}" r="${r - 3}" style="fill:#fff;stroke:${fill};stroke-width:5"/>`
    : `<circle class="sh l-${l}" cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
  return shape + (label ? `<text class="mv l-${l}" x="${x}" y="${y + 11}">${esc(label)}</text>` : "");
}

/**
 * One link per station for both layers, each drawing its own dot (`l-t`, `l-p`, shown by the page's CSS) and giving
 * the bubble its value (`data-tvt`, `data-tvp`); a station without a measure of the layer shown is hidden (`has-…`).
 * Its name for a screen reader says every measure, the wind included.
 */
function station(s: StationNow, named: boolean, rain: number | undefined, hour: boolean): string {
  const [x, y] = project(s.lon, s.lat);
  const span = hour ? "1\u202fh" : "6\u202fmin";
  const v = {
    t: s.temperature != null ? thin(deg(s.temperature)) : undefined,
    p: rain == null ? undefined : rain > 0 ? thin(`${fr(rain)} mm en ${span}`) : thin(`pas de pluie mesurée en ${span}`),
  };
  const has = Object.entries(v).filter(([, x]) => x).map(([k]) => ` has-${k}`).join("");
  const place = `${shortName(s.nom)} · ${metres(s.altitude_m)}`;
  const said = `${place} : ${[v.t, v.p, ventText(s)].filter(Boolean).join(", ")}, mesures de ${hm(s.time)}${by(s)}, voir le détail`;
  const shapes =
    (s.temperature != null ? dot("t", x, y, chip(s.temperature), named ? `${Math.round(s.temperature)}°` : undefined) : "") +
    (rain != null ? (rain > 0 ? dot("p", x, y, rainColor(rain), named || rain >= 1 ? fr(Math.round(rain * 10) / 10) : undefined) : dot("p", x, y, "#7d93a8", undefined, true)) : "");
  const data = Object.entries(v).map(([k, x]) => (x ? ` data-tv${k}="${esc(x)}"` : "")).join("");
  return `<a class="mk${has}" href="#${stationId(s.nom)}" aria-label="${esc(said)}" data-tp="${esc(place)}" data-td="mesurée à\u00a0${hm(s.time)}${esc(by(s))}"${data}>` +
    `<circle class="hit" cx="${x}" cy="${y}" r="${named ? HIT : HIT / 2}" style="fill:transparent;stroke:none"/>${shapes}</a>`;
}

export function stationsMap(list: StationNow[], altPath = ALT_PATH): string {
  // The rain of the last hour; of the last 6 minutes where no station has the hour yet (a copy just after a restart).
  const hour = list.some((s) => s.pluie_1h != null);
  const mm = (s: StationNow) => (hour ? s.pluie_1h : s.pluie_6min);
  const t = list.filter((s) => s.temperature != null);
  const nRain = list.filter((s) => mm(s) != null).length;
  const latest = list.reduce((m, s) => (s.time > m ? s.time : m), "");
  const named = (s: StationNow) => NAMED.has(s.id ?? "");
  // The named ones last, over the dots.
  // A station with neither measure (a wind beacon) is in the list under the map, not on it.
  const drawn = list.filter((s) => s.temperature != null || mm(s) != null);
  const top = `<g class="sts">${[...drawn].sort((a, b) => Number(named(a)) - Number(named(b))).map((s) => station(s, named(s), mm(s), hour)).join("")}</g>`;
  // The veil's data: each station's place on the map, altitude and temperature; the script does the rest.
  const voile = JSON.stringify(t.map((s) => [...project(s.lon, s.lat), s.altitude_m, s.temperature]));
  // A canvas rather than an image: the site's policy lets no picture be made in the page (img-src 'self').
  const overlay = `<foreignObject class="l-t" width="${W}" height="${H}" clip-path="url(#isl-clip)"><canvas class="voile" data-voile="${esc(voile)}" data-alt="${esc(altPath)}" width="1" height="1"></canvas></foreignObject>`;
  const n = (k: number, one: string, many: string) => `${k} ${k > 1 ? many : one}`;
  // A tab and a legend per measure that at least one station has; the first shown without a choice.
  const layers = [
    t.length && { id: "t", tab: "Température", legend: `<span class="lgs">${thin(deg(STOPS_LO))}<i class="vgrad"></i>${thin(deg(STOPS_HI))}</span>${n(t.length, "station", "stations")}, température mesurée sous abri, la plus récente à ${hm(latest)}. Entre les stations, les couleurs sont <b>estimées selon l'altitude</b> : ce n'est pas une mesure.` },
    nRain && { id: "p", tab: hour ? "Pluie 1 h" : "Pluie 6 min", legend: `${n(nRain, "pluviomètre", "pluviomètres")}, ${hour ? "pluie de la dernière heure en mm" : "pluie des 6 dernières minutes seulement, en mm"}, la plus récente à ${hm(latest)}${hour ? "" : " : l'heure complète n'est pas encore disponible"}. Cercle vide : pas de pluie mesurée.` },
  ].filter((l): l is { id: string; tab: string; legend: string } => !!l);
  const tabs = `<div class="tabs aqtabs" role="radiogroup" aria-label="Mesure affichée sur la carte">` +
    layers.map((l, i) => `<input type="radio" name="wxl" id="wxl-${l.id}"${i ? "" : ' class="on" checked'}><label for="wxl-${l.id}">${l.tab}</label>`).join("") + `</div>`;
  const legend = layers.map((l, i) => `<span class="lg lg-${l.id}${i ? "" : " on"}">${l.legend}</span>`).join("");
  const bubble = `<a class="mtip" data-mtip hidden aria-hidden="true" tabindex="-1" href="#stations"><span class="mt-p"></span><b class="mt-v"></b><span class="mt-d"></span><span class="mt-go">Voir la station →</span></a>`;
  return `<figure class="card mapcard airmap wxmap">${tabs}` +
    islandMap({ overlay, top, peaks: true, label: `Carte de La Réunion (974) : les ${drawn.length} stations météo et leur dernière mesure, à ${hm(latest)}` }) +
    bubble + `<figcaption class="note">${legend}</figcaption></figure>`;
}

/** The veil, computed in the browser: the altitude explains most of it, the stations the rest (inverse distance). */
const VOILE_SCRIPT = `const vo=document.querySelector("[data-voile]");if(vo){const st=JSON.parse(vo.dataset.voile),im=new Image();im.onload=()=>{
const w=im.width,h=im.height,c=vo;c.width=w;c.height=h;const g=c.getContext("2d");g.drawImage(im,0,0);const a=g.getImageData(0,0,w,h).data;
const n=st.length;let sz=0,st2=0,sz2=0,szt=0;st.forEach(([,,z,t])=>{sz+=z;st2+=t;sz2+=z*z;szt+=z*t});let b=(n*szt-sz*st2)/(n*sz2-sz*sz);if(!(b<-.003&&b>-.01))b=-.0065;const k=(st2-b*sz)/n;
const p=st.map(([x,y,z,t])=>[x*w/${W},y*h/${H},t-(k+b*z)]);const S=${JSON.stringify(VEIL)};
const col=(t)=>{let i=0;while(i<S.length-2&&t>S[i+1][0])i++;const[[t0,c0],[t1,c1]]=[S[i],S[i+1]],f=Math.min(1,Math.max(0,(t-t0)/(t1-t0)));return c0.map((v,j)=>v+(c1[j]-v)*f)};
const o=g.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,v=a[i];if(!v)continue;let sw=0,sr=0;for(const[px,py,r]of p){const d=(px-x)**2+(py-y)**2+.5,q=1/d;sw+=q;sr+=q*r}
const[R,G,B]=col(k+b*(v-1)*${altitudes.pas_m}+sr/sw);o.data[i]=R;o.data[i+1]=G;o.data[i+2]=B;o.data[i+3]=215}g.putImageData(o,0,0)};im.src=vo.dataset.alt}`;

/** /meteo's own script: the stations' list (filter, sort, unfold), then the veil. */
export const METEO_SCRIPT = `const stl=document.getElementById("stl");if(stl){const sel=document.getElementById("stc"),bs=document.querySelectorAll("[data-s]");
const m=document.getElementById("stm"),open=()=>{stl.classList.remove("plie");if(m)m.parentElement.hidden=true};if(m)m.addEventListener("click",open);
const f=()=>{const c=sel.value;open();stl.querySelectorAll("li").forEach((li)=>{li.hidden=!!c&&li.dataset.c!==c})};sel.addEventListener("change",f);
bs.forEach((b)=>b.addEventListener("click",()=>{const k=b.dataset.s;open();bs.forEach((x)=>x.setAttribute("aria-pressed",x===b));
[...stl.children].sort((a,z)=>k==="n"?a.dataset.n.localeCompare(z.dataset.n,"fr"):k==="t"?(z.dataset.t===""?-99:+z.dataset.t)-(a.dataset.t===""?-99:+a.dataset.t):a.dataset.z-z.dataset.z).forEach((li)=>stl.append(li))}))}
${VOILE_SCRIPT}`;
