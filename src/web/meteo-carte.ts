/**
 * The map at the top of /meteo: every station that measured, one measure at a time (temperature, rain of the last
 * hour, wind), and under the temperatures a veil estimated between the stations with the altitude, drawn by the
 * page's script from a small grid of the island's altitudes (scripts/build-altitudes.py). Under the wind, particles
 * carried by a wind estimated between the anemometers, on a veil of its speed. The points are the measures; the veils
 * and the particles, estimates, say so in their legends.
 */
import { INSEE } from "../places/insee.js";
import { sun } from "../providers/calendrier.js";
import altitudes from "./altitudes.json" with { type: "json" };
import { fr } from "../tools/format.js";
import type { StationNow } from "./data.js";
import { esc, H, islandMap, project, W } from "./map.js";
import { PATH as PLUIE_RADAR } from "./pluie-radar.js";
import { PATH as PLUIE_RETRO } from "./pluie-retro.js";
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
// The radar's rain, class 1 to 8 (web/pluie-radar.ts): a wash deeper as it rains harder.
const RAIN_WASH = ["rgba(120,170,230,.35)", "rgba(100,155,225,.45)", "rgba(80,135,215,.5)", "rgba(60,115,205,.55)", "rgba(45,95,190,.6)", "rgba(35,75,175,.65)", "rgba(80,40,160,.65)", "rgba(150,30,140,.7)"];
// The wind's colours by speed, in km/h, after the usual wind maps: blue when calm, red in a storm.
const WIND: [number, number[]][] = [[0, [70, 104, 176]], [10, [46, 150, 172]], [20, [74, 170, 98]], [30, [222, 184, 62]], [45, [222, 112, 46]], [60, [178, 44, 72]]];
const STOPS_LO = VEIL[0][0];
const STOPS_HI = VEIL[VEIL.length - 1][0];
const HIT = 66;

/** The island's altitudes on a small grid (scripts/build-altitudes.py), a file of public/; its address changes with it. */
export const ALT_PATH = `/altitudes-${altitudes.v}.png`;
/** Under the stations' sources: the altitudes of the colours estimated between them. */
export const ALTITUDES_CREDIT = { source: "IGN, RGE ALTI, pour les altitudes des couleurs estimées", licence: "Licence Ouverte 2.0", attribution: "IGN, RGE ALTI" };
/** And the radar's rain of the rain layer (web/pluie-radar.ts). */
export const RADAR_CREDIT = { source: "Météo-France, lame d'eau radar, pour la pluie estimée", licence: "Licence Ouverte 2.0", attribution: "Météo-France" };

/** The middle of the island: a coast's side and its sea are told from it. */
const MIDDLE = { lon: 55.53, lat: -21.13 };
/** A coast's anemometer: this high at most. */
const COAST_M = 150;

/**
 * The land breeze: at night, the air cooled on the slopes flows down to the sea. Said when the coast's anemometers blow
 * towards the sea on two sides of the island at least (most of a side's): by day the trade wind blows seaward too, but
 * on the west coast only. A side is a quarter of the island seen from its middle (north, east, south, west); a coast's
 * sea, straight away from the middle; seaward, a wind that goes within 60° of it. The night, the latest measure's,
 * between sunset and sunrise.
 */
export function landBreeze(list: StationNow[]): boolean {
  const live = list.filter((s) => !s.stale);
  const latest = live.reduce((m, s) => (s.time > m ? s.time : m), "");
  if (!latest) return false;
  const t = Date.parse(latest);
  const { lever, coucher } = sun(new Date(t + 4 * 3600_000).toISOString().slice(0, 10), MIDDLE.lon, MIDDLE.lat);
  if (t >= lever.getTime() && t <= coucher.getTime()) return false;
  // Seaward and all the coast's winds, by side.
  const sides = [0, 1, 2, 3].map(() => [0, 0]);
  const k = Math.cos((MIDDLE.lat * Math.PI) / 180);
  for (const s of live) {
    if (s.altitude_m > COAST_M || !s.vent || s.direction == null) continue;
    const x = (s.lon - MIDDLE.lon) * k, y = s.lat - MIDDLE.lat, a = (s.direction * Math.PI) / 180;
    // The wind goes the other way from where it comes: (-sin, -cos) east and north.
    const sea = (-Math.sin(a) * x - Math.cos(a) * y) / Math.hypot(x, y) >= 0.5;
    const side = sides[Math.round((((Math.atan2(x, y) * 180) / Math.PI + 360) % 360) / 90) % 4];
    side[1]++;
    if (sea) side[0]++;
  }
  return sides.filter(([n, all]) => n * 2 > all).length >= 2;
}

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

/** A wind measure on the map: an arrow where it goes and the speed in km/h, in a dark pill over the particles. */
function windMark(x: number, y: number, s: StationNow): string {
  const arrow = s.direction != null && s.vent
    ? `<path d="M0 10V-10M-7-3l7-7 7 7" transform="translate(${x - 22} ${y}) rotate(${(s.direction + 180) % 360})"/>`
    : `<circle cx="${x - 22}" cy="${y}" r="5"/>`;
  return `<g class="sh l-v wv"><rect x="${x - 46}" y="${y - 24}" width="96" height="48" rx="24"/>${arrow}<text x="${x + 18}" y="${y + 11}">${s.vent}</text></g>`;
}

/**
 * One link per station for every layer, each drawing its own dot (`l-t`, `l-p`, `l-v`, shown by the page's CSS) and
 * giving the bubble its value (`data-tvt`, `data-tvp`, `data-tvv`); a station without a measure of the layer shown is
 * hidden (`has-…`). Its name for a screen reader says every measure.
 */
function station(s: StationNow, named: boolean, rain: number | undefined, hour: boolean): string {
  const [x, y] = project(s.lon, s.lat);
  const span = hour ? "1\u202fh" : "6\u202fmin";
  const v = {
    t: s.temperature != null ? thin(deg(s.temperature)) : undefined,
    p: rain == null ? undefined : rain > 0 ? thin(`${fr(rain)} mm en ${span}`) : thin(`pas de pluie mesurée en ${span}`),
    v: ventText(s),
  };
  const has = Object.entries(v).filter(([, x]) => x).map(([k]) => ` has-${k}`).join("");
  const place = `${shortName(s.nom)} · ${metres(s.altitude_m)}`;
  const said = `${place} : ${[v.t, v.p, v.v].filter(Boolean).join(", ")}, mesures de ${hm(s.time)}${by(s)}, voir le détail`;
  const shapes =
    (s.temperature != null ? dot("t", x, y, chip(s.temperature), named ? `${Math.round(s.temperature)}°` : undefined) : "") +
    (rain != null ? (rain > 0 ? dot("p", x, y, rainColor(rain), named || rain >= 1 ? fr(Math.round(rain * 10) / 10) : undefined) : dot("p", x, y, "#7d93a8", undefined, true)) : "") +
    (s.vent != null ? windMark(x, y, s) : "");
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
  const w = list.filter((s) => s.vent != null);
  // The named ones last, over the dots.
  const drawn = list.filter((s) => s.temperature != null || mm(s) != null || s.vent != null);
  // The replay's time, on the sea at the top left; shown only while it plays (pluie-retro.ts).
  const top = `<g class="sts">${[...drawn].sort((a, b) => Number(named(a)) - Number(named(b))).map((s) => station(s, named(s), mm(s), hour)).join("")}</g>` +
    (nRain || w.length ? `<text class="rj-h" x="34" y="92" aria-hidden="true"></text>` : "");
  // The veil's data: each station's place on the map, altitude and temperature; the script does the rest.
  const voile = JSON.stringify(t.map((s) => [...project(s.lon, s.lat), s.altitude_m, s.temperature]));
  // A canvas rather than an image: the site's policy lets no picture be made in the page (img-src 'self').
  // The wind's data: each anemometer's place and where its wind goes, in km/h along the map's x and y (y down).
  // A wind without its direction says nothing of where the air goes: left out (a calm is a measure, and stays).
  const wd = w.filter((s) => s.direction != null || s.vent === 0);
  const vent = JSON.stringify(wd.map((s) => {
    const a = ((s.direction ?? 0) * Math.PI) / 180, v = s.vent!;
    return [...project(s.lon, s.lat), Math.round(-Math.sin(a) * v * 10) / 10, Math.round(Math.cos(a) * v * 10) / 10];
  }));
  const fo = (l: string, canvas: string) => `<foreignObject class="l-${l}" width="${W}" height="${H}" clip-path="url(#isl-clip)">${canvas}</foreignObject>`;
  const overlay = fo("t", `<canvas class="voile" data-voile="${esc(voile)}" data-alt="${esc(altPath)}" width="1" height="1"></canvas>`) +
    (nRain ? fo("p", `<div class="vt"><canvas class="voile" data-pluie="${PLUIE_RADAR}" data-alt="${esc(altPath)}" width="1" height="1"></canvas><canvas class="flux" width="1" height="1"></canvas></div>`) : "") +
    (wd.length ? fo("v", `<div class="vt"><canvas class="voile" data-vent="${esc(vent)}" data-alt="${esc(altPath)}" width="1" height="1"></canvas><canvas class="flux" width="1" height="1"></canvas></div>`) : "");
  const n = (k: number, one: string, many: string) => `${k} ${k > 1 ? many : one}`;
  // A tab and a legend per measure that at least one station has; the first shown without a choice.
  const layers = [
    t.length && { id: "t", tab: "Température", legend: `<span class="lgs">${thin(deg(STOPS_LO))}<i class="vgrad"></i>${thin(deg(STOPS_HI))}</span>${n(t.length, "station", "stations")}, température mesurée sous abri, la plus récente à ${hm(latest)}. Entre les stations, les couleurs sont <b>estimées selon l'altitude</b> : ce n'est pas une mesure.` },
    nRain && { id: "p", tab: hour ? "Pluie 1 h" : "Pluie 6 min", legend: `${n(nRain, "pluviomètre", "pluviomètres")}, ${hour ? "pluie de la dernière heure en mm" : "pluie des 6 dernières minutes seulement, en mm"}, la plus récente à ${hm(latest)}${hour ? "" : " : l'heure complète n'est pas encore disponible"}. Point blanc : pas de pluie mesurée. <span data-radar hidden></span>` },
    w.length && { id: "v", tab: "Vent", legend: `<span class="lgs">0<i class="vgrad wgrad"></i>${thin("60 km/h")}</span>${n(w.length, "anémomètre", "anémomètres")}, vent moyen mesuré en km/h, le plus récent à ${hm(latest)}. La flèche montre où va le vent (un vent d'est vient de l'est).${landBreeze(list) ? " La nuit, l'air descend des pentes vers la mer (brise de terre)." : ""} Entre les stations, le mouvement et les couleurs sont <b>estimés</b> à partir des stations voisines : ce n'est pas une mesure.` },
  ].filter((l): l is { id: string; tab: string; legend: string } => !!l);
  const tabs = `<div class="tabs aqtabs" role="radiogroup" aria-label="Mesure affichée sur la carte">` +
    layers.map((l, i) => `<input type="radio" name="wxl" id="wxl-${l.id}"${i ? "" : ' class="on" checked'}><label for="wxl-${l.id}">${l.tab}</label>`).join("") + `</div>`;
  // Each legend, and the replay's in its place while it plays.
  const legend = layers.map((l, i) => `<span class="lg lg-${l.id}${i ? "" : " on"}"><span class="lg-now">${l.legend}</span>${l.id === "t" ? "" : `<span class="rj-lg"></span>`}</span>`).join("");
  const replay = nRain || w.length
    ? `<span class="rj" data-retro="${PLUIE_RETRO}" hidden><button type="button">Revoir les 3\u00a0dernières heures</button><input type="range" min="0" max="0" step="1" value="0" aria-label="Heure de l'image" hidden></span>`
    : "";
  const bubble = `<a class="mtip" data-mtip hidden aria-hidden="true" tabindex="-1" href="#stations"><span class="mt-p"></span><b class="mt-v"></b><span class="mt-d"></span><span class="mt-go">Voir la station →</span></a>`;
  return `<figure class="card mapcard airmap wxmap">${tabs}` +
    islandMap({ under: overlay, top, peaks: true, label: `Carte de La Réunion (974) : les ${drawn.length} stations météo et leur dernière mesure, à ${hm(latest)}` }) +
    bubble + `<figcaption class="note">${legend}${replay}</figcaption></figure>`;
}

/** The veil, computed in the browser: the altitude explains most of it, the stations the rest (inverse distance). */
const VOILE_SCRIPT = `const vo=document.querySelector("[data-voile]");if(vo){const st=JSON.parse(vo.dataset.voile),im=new Image();im.onload=()=>{
const w=im.width,h=im.height,c=vo;c.width=w;c.height=h;const g=c2d(c);g.drawImage(im,0,0);const a=g.getImageData(0,0,w,h).data;
const n=st.length;let sz=0,st2=0,sz2=0,szt=0;st.forEach(([,,z,t])=>{sz+=z;st2+=t;sz2+=z*z;szt+=z*t});let b=(n*szt-sz*st2)/(n*sz2-sz*sz);if(!(b<-.003&&b>-.01))b=-.0065;const k=(st2-b*sz)/n;
const p=st.map(([x,y,z,t])=>[x*w/${W},y*h/${H},t-(k+b*z)]);const S=${JSON.stringify(VEIL)};
const col=(t)=>{let i=0;while(i<S.length-2&&t>S[i+1][0])i++;const[[t0,c0],[t1,c1]]=[S[i],S[i+1]],f=Math.min(1,Math.max(0,(t-t0)/(t1-t0)));return c0.map((v,j)=>v+(c1[j]-v)*f)};
const o=g.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,v=a[i];if(!v)continue;let sw=0,sr=0;for(const[px,py,r]of p){const d=(px-x)**2+(py-y)**2+.5,q=1/d;sw+=q;sr+=q*r}
const[R,G,B]=col(k+b*(v-1)*${altitudes.pas_m}+sr/sw);o.data[i]=R;o.data[i+1]=G;o.data[i+2]=B;o.data[i+3]=215}g.putImageData(o,0,0)};im.src=vo.dataset.alt}`;

/**
 * What the wind and the rain share in the browser: a canvas animated about 30 frames a second, only while its layer
 * is shown, the map on screen and the tab in front; drawn again when the map's width changes (a phone's address bar
 * that hides changes its height alone); one still picture for those who ask for less motion, or when nothing moves
 * (`o.moving()`). `o.ready()` says when its data has come; the function returned, called then, starts it; `o.again()`
 * draws it all again, for the replay's images.
 */
const ANIM = `const anim=(o)=>{const inp=document.getElementById(o.id);let run=false,seen=false,raf=0,last=0,cw=0;
const loop=(t)=>{raf=requestAnimationFrame(loop);if(t-last<32)return;last=t;o.frame()};
const go=()=>{const on=inp&&inp.checked&&seen&&!document.hidden&&o.ready();if(on&&!run){run=true;const r=o.fl.getBoundingClientRect();cw=Math.round(r.width);o.size(r);
if(o.moving&&!o.moving()||matchMedia("(prefers-reduced-motion: reduce)").matches){o.still();return}raf=requestAnimationFrame(loop)}else if(!on&&run){run=false;cancelAnimationFrame(raf)}};
new IntersectionObserver((e)=>{seen=e[0].isIntersecting;go()}).observe(o.fl.closest("figure"));document.addEventListener("visibilitychange",go);
document.querySelectorAll("[name=wxl]").forEach((i)=>i.addEventListener("change",go));addEventListener("resize",()=>{if(run&&Math.round(o.fl.getBoundingClientRect().width)!==cw){run=false;cancelAnimationFrame(raf);go()}});
o.again=()=>{if(run){run=false;cancelAnimationFrame(raf)}go()};return go};`;

/**
 * The wind, in the browser: the anemometers' winds spread on the altitudes' grid by inverse distance, coloured by speed
 * (the veil, drawn once), and particles carried by it, leaving a trail (the second canvas, one pixel a CSS pixel:
 * at the screen's full resolution the fading of the trails cost a slow phone three times as much). A number of
 * particles bound to the map's size; a picture of arrows for those who ask for less motion.
 */
const VENT_SCRIPT = `const ve=document.querySelector("[data-vent]");if(ve){const st=JSON.parse(ve.dataset.vent),fl=ve.nextElementSibling,im=new Image();
let w=0,h=0,U,V,M,land=[],ps=[],cw=0,ch=0,g;const S=${JSON.stringify(WIND)};
const col=(t)=>{let i=0;while(i<S.length-2&&t>S[i+1][0])i++;const[[t0,c0],[t1,c1]]=[S[i],S[i+1]],f=Math.min(1,Math.max(0,(t-t0)/(t1-t0)));return c0.map((v,j)=>v+(c1[j]-v)*f)};
const at=(x,y)=>{const gx=Math.min(w-1.001,Math.max(0,x*w/${W}-.5)),gy=Math.min(h-1.001,Math.max(0,y*h/${H}-.5)),i=gx|0,j=gy|0,fx=gx-i,fy=gy-j,k=j*w+i;
const m=(A)=>(A[k]*(1-fx)+A[k+1]*fx)*(1-fy)+(A[k+w]*(1-fx)+A[k+w+1]*fx)*fy;return[m(U),m(V)]};
const on_=(x,y)=>M[(Math.min(h-1,y*h/${H}|0))*w+Math.min(w-1,x*w/${W}|0)];
const born=(p)=>{const c=land[(Math.random()*land.length)|0];p.x=(c%w+Math.random())*${W}/w;p.y=((c/w|0)+Math.random())*${H}/h;p.a=(Math.random()*80)|0};
const o={fl,id:"wxl-v",ready:()=>land.length,
size:(r)=>{cw=fl.width=Math.max(1,Math.round(r.width));ch=fl.height=Math.max(1,Math.round(r.height));g=c2d(fl);
const n=Math.min(900,Math.round(r.width*r.height/150));ps=[];for(let i=0;i<n;i++){const p={};born(p);ps.push(p)}},
still:()=>{g.clearRect(0,0,cw,ch);g.strokeStyle="rgba(255,255,255,.9)";g.lineWidth=1.5;g.lineCap="round";const e=22*w/cw;
for(let j=e/2;j<h;j+=e)for(let i=e/2;i<w;i+=e){if(!M[(j|0)*w+(i|0)])continue;const[u,v]=at(i*${W}/w,j*${H}/h),q=Math.hypot(u,v);if(q<.5)continue;
const X=i*cw/w,Y=j*ch/h,dx=u/q*8,dy=v/q*8,a=Math.atan2(dy,dx);g.beginPath();g.moveTo(X-dx,Y-dy);g.lineTo(X+dx,Y+dy);
g.lineTo(X+dx-5*Math.cos(a-.5),Y+dy-5*Math.sin(a-.5));g.moveTo(X+dx,Y+dy);g.lineTo(X+dx-5*Math.cos(a+.5),Y+dy-5*Math.sin(a+.5));g.stroke()}},
frame:()=>{const s=cw/${W};g.globalCompositeOperation="destination-in";g.fillStyle="rgba(0,0,0,.94)";g.fillRect(0,0,cw,ch);g.globalCompositeOperation="source-over";
g.strokeStyle="rgba(255,255,255,.9)";g.lineWidth=Math.max(1.2,cw/330);g.beginPath();
for(const p of ps){const[u,v]=at(p.x,p.y),x=p.x+u*.3,y=p.y+v*.3;if(++p.a>100||x<0||y<0||x>=${W}||y>=${H}||!on_(x,y)){born(p);continue}g.moveTo(p.x*s,p.y*s);g.lineTo(x*s,y*s);p.x=x;p.y=y}g.stroke()}};const go=anim(o);
// The field of a set of anemometers: the live ones, or those of a round hour of the replay.
let A,x;const field=(sx)=>{const p=sx.map(([X,Y,u,v])=>[X*w/${W},Y*h/${H},u,v]),e=x.createImageData(w,h);land=[];for(let j=0;j<h;j++)for(let i=0;i<w;i++){const k=j*w+i;let sw=0,su=0,sv=0;
for(const[px,py,u,v]of p){const q=1/((px-i)**2+(py-j)**2+.5);sw+=q;su+=q*u;sv+=q*v}U[k]=su/sw;V[k]=sv/sw;if(!A[k*4])continue;M[k]=1;land.push(k);
const[R,G,B]=col(Math.hypot(U[k],V[k]));e.data[k*4]=R;e.data[k*4+1]=G;e.data[k*4+2]=B;e.data[k*4+3]=200}x.putImageData(e,0,0)};
RJ.v={show:(f,el)=>{if(!A)return;field(f.st);o.again();const n=f.st.length;el.textContent="Vent moyen sur 10\u00a0minutes, mesuré "+at_(f.fin)+" par "+n+(n>1?" anémomètres":" anémomètre")+" de Météo-France. Entre eux, le mouvement et les couleurs sont estimés. Les aéroports et les balises OpenWindMap ne sont pas dans ce rejeu."},
back:()=>{if(!A)return;field(st);o.again()}};
im.onload=()=>{w=im.width;h=im.height;const c=ve;c.width=w;c.height=h;x=c2d(c);x.drawImage(im,0,0);A=x.getImageData(0,0,w,h).data;U=new Float32Array(w*h);V=new Float32Array(w*h);M=new Uint8Array(w*h);
field(st);go()};im.src=ve.dataset.alt}`;

/**
 * The rain the radar sees, in the browser, asked for when the layer is first shown (web/pluie-radar.ts): its cells
 * washed in blue by class, hatched where the radars see badly (night and white stripes, which show on any relief; both
 * drawn once, at the screen's size), and drops falling
 * in the wet cells, more and faster where it rains harder (the second canvas, cleared each frame). The legend says the
 * image's time, that the radar sees no rain, or that its image is too old to say anything about now.
 */
const PLUIE_SCRIPT = `const pr=document.querySelector("[data-pluie]");if(pr){const fl=pr.nextElementSibling,say=document.querySelector("[data-radar]"),inp=document.getElementById("wxl-p");
let d=null,live=null,L=null,Lp=null,cells=[],acc=[],ds=[],cw=0,ch=0,g,asked=false;const K=${JSON.stringify(RAIN_WASH)},Wt=[0,1,2,3,5,8,12,18,26];
const BAD=" Hachures : zones que le radar voit mal, où la pluie peut être manquée.";
const when=(t)=>{const x=loc(t),n=loc(new Date().toISOString());return x.toISOString().slice(0,10)===n.toISOString().slice(0,10)?"de "+hm(t):"du "+p2(x.getUTCDate())+"/"+p2(x.getUTCMonth()+1)+" à "+hm(t)};
const radars=(l)=>{const of=(n)=>(n==="Colorado"?"du ":"de ")+n;return(l.length>1?"Radars ":"Radar ")+l.slice(0,-1).map(of).join(", ")+(l.length>1?" et ":"")+of(l[l.length-1])+" en défaut, selon Météo-France : de la pluie peut manquer sur la carte."};
const pick=()=>{const r=Math.random()*acc[acc.length-1];let a=0,b=acc.length-1;while(a<b){const m=(a+b)>>1;if(acc[m]<r)a=m+1;else b=m}return cells[a]};
const born=(p)=>{const k=pick(),c=+d.pluie[k];p.x=(k%d.w+Math.random())*cw/d.w;p.y=((k/d.w|0)+Math.random())*ch/d.h;p.v=.8+c*.25;p.l=3+c;p.a=0;p.m=5+(Math.random()*6|0)};
const drops=(n)=>{g.strokeStyle="rgba(255,255,255,.92)";g.lineWidth=1.4;g.lineCap="round";g.beginPath();for(const p of ds){g.moveTo(p.x,p.y);g.lineTo(p.x-p.l*.25,p.y-p.l)}g.stroke()};
const o={fl,id:"wxl-p",ready:()=>!!d,moving:()=>cells.length>0,
size:(r)=>{cw=fl.width=pr.width=Math.max(1,Math.round(r.width));ch=fl.height=pr.height=Math.max(1,Math.round(r.height));g=c2d(fl);
const x=c2d(pr),sx=cw/d.w,sy=ch/d.h,t=document.createElement("canvas");t.width=t.height=6;const tg=t.getContext("2d");tg.lineWidth=1.6;for(const[c,o]of[["rgba(11,31,54,.55)",0],["rgba(255,255,255,.5)",3]]){tg.strokeStyle=c;tg.beginPath();for(const k of[-6,0,6]){tg.moveTo(k+o-1,7);tg.lineTo(k+o+7,-1)}tg.stroke()}
const hatch=x.createPattern(t,"repeat");for(let k=0;k<d.w*d.h;k++){const c=d.pluie[k],X=(k%d.w)*sx,Y=(k/d.w|0)*sy;
if(c>"0"){x.fillStyle=K[+c-1];x.fillRect(X,Y,sx+.6,sy+.6)}if(d.mal_vu[k]==="1"){x.fillStyle=hatch;x.fillRect(X,Y,sx+.6,sy+.6)}}
ds=[];if(!cells.length)return;const n=Math.min(900,Math.max(25,Math.round(acc[acc.length-1]*.03*r.width*r.height/88e3)));for(let i=0;i<n;i++){const p={};born(p);p.a=(Math.random()*p.m)|0;ds.push(p)}},
still:()=>{g.clearRect(0,0,cw,ch);drops()},
frame:()=>{g.clearRect(0,0,cw,ch);for(const p of ds){p.y+=p.v;p.x-=p.v*.25;if(++p.a>p.m)born(p)}drops()}};const go=anim(o);
// The hatched square ties the sentence to the hatches on the map, however small they are; it never leaves its word.
const show=(el,t,bad,down)=>{el.textContent=t;if(bad){const i=document.createElement("i"),w=document.createElement("span");i.className="hsw";w.className="hsn";w.append(i,"\u00a0Hachures");el.append(" ",w,bad.slice(9))}if(down)el.append(down);el.hidden=false};
const land=()=>Lp||(Lp=new Promise((ok,ko)=>{const im=new Image();im.onload=()=>{const c=document.createElement("canvas");c.width=im.width;c.height=im.height;const x=c.getContext("2d");x.drawImage(im,0,0);
const a=x.getImageData(0,0,im.width,im.height).data;ok(L=a.filter((v,i)=>i%4===0))};im.onerror=ko;im.src=pr.dataset.alt}));
// A grid made the one drawn: its rainy cells of the island alone (the map shows nothing of the sea, where the radars
// also see), and whether the radars see badly somewhere on it.
const use=(j)=>{d=j;cells=[];acc=[];let bad="";for(let k=0;k<d.w*d.h;k++){if(!L[k])continue;const c=+d.pluie[k];if(c>0){cells.push(k);acc.push((acc[acc.length-1]||0)+Wt[c])}if(d.mal_vu[k]==="1")bad=BAD}return bad};
const say_=(j,bad,head,tail)=>show(head.el,(cells.length?"En bleu : la pluie estimée par le radar de Météo-France "+at_(j.fin)+" ; plus c'est foncé, plus elle est forte.":"Le radar de Météo-France ne voit pas de pluie "+(tail?"sur l'île ":"")+at_(j.fin)+".")+tail,bad,j.pannes.length?" "+radars(j.pannes):"");
const get=()=>{if(asked||!inp.checked)return;asked=true;Promise.all([fetch(pr.dataset.pluie).then((r)=>{if(!r.ok)throw new Error(String(r.status));return r.json()}),land()]).then(([j])=>{
if(L.length!==j.w*j.h)throw new Error("grille");
if(Date.now()-Date.parse(j.fin)>45*6e4){show(say,"Pas d'image radar récente : la dernière date "+when(j.fin)+" et n'est pas affichée.");return}live=j;
say_(j,use(j),{el:say},"");go()}).catch(()=>{})};
// The replay's images (pluie-retro.ts): each its own rain and hatches; a gap, nothing but its sentence.
const none=(w,h)=>({fin:"",pannes:[],w,h,pluie:"0".repeat(w*h),mal_vu:"0".repeat(w*h)});
const un=(s)=>s.split(",").map((r)=>r?r[0].repeat(parseInt(r.slice(1),36)):"").join("");
RJ.p={prep:land,show:(e,el,gr,tail)=>{if(!L||L.length!==gr.w*gr.h)return;if(e.trou){use(none(gr.w,gr.h));o.again();const one=Date.parse(e.a)-Date.parse(e.de)<=3e5;
show(el,one?"Pas d'image radar "+at_(e.a)+".":"Pas d'image radar de "+hm(e.de)+" à "+hm(e.a)+".");return}
const j={fin:e.fin,pannes:e.pannes,w:gr.w,h:gr.h,pluie:un(e.pluie),mal_vu:un(e.mal_vu)};const bad=use(j);o.again();say_(j,bad,{el},tail)},
back:()=>{if(live)use(live);else if(d)use(none(d.w,d.h));o.again()}};
inp.addEventListener("change",get);get()}`;

/**
 * The replay of the last 3 hours (pluie-retro.ts), under the rain and wind layers: asked when one of them is first
 * shown, to offer it only with 2 images or round hours at least; then each image in turn, every half second for the
 * radar's, every 2.5 s for the wind's, its time written on the map and read by the slider, the stations' dots hidden
 * (they say now). Back to now on the button or on another layer. No playing for those who ask for less motion: the
 * slider alone.
 */
const REJEU_SCRIPT = `const rc=document.querySelector("[data-retro]");if(rc){const fig=rc.closest("figure"),btn=rc.querySelector("button"),rng=rc.querySelector("input"),hh=fig.querySelector(".rj-h");
const lg={p:fig.querySelector(".lg-p .rj-lg"),v:fig.querySelector(".lg-v .rj-lg")};let J=null,asked=false,on="",fr=[],k=0,tm=0;
const lay=()=>["p","v"].find((l)=>{const i=document.getElementById("wxl-"+l);return i&&i.checked&&RJ[l]})||"";
const list=(l)=>!J?[]:l==="p"?(J.radar?J.radar.entrees:[]):J.vent;
const first=(l)=>{const e=list(l)[0];return e?(e.trou?e.de:e.fin):""};
// The history is full when it starts within 10 minutes of 3 hours ago; just after the release it starts later.
const full=(l)=>Date.parse(first(l))<=Date.now()-3*36e5+(l==="p"?6e5:36e5);
const upd=()=>{if(on)return;const l=lay();rc.hidden=!l||list(l).filter((e)=>!e.trou).length<2;if(!rc.hidden)btn.textContent=full(l)?"Revoir les 3\u00a0dernières heures":"Revoir depuis "+hm(first(l))};
const frame=()=>{const e=fr[k],one=e.trou&&Date.parse(e.a)-Date.parse(e.de)<=3e5;rng.value=String(k);
hh.textContent=e.trou?(one?hm(e.a):hm(e.de)+"–"+hm(e.a)):hm(e.fin);hh.classList.toggle("plage",!!e.trou&&!one);rng.setAttribute("aria-valuetext",e.trou?(one?"Pas d'image radar à "+hm(e.a):"Pas d'image radar de "+hm(e.de)+" à "+hm(e.a)):hm(e.fin));
RJ[on].show(e,lg[on],J.radar," Une image toutes les 5\u00a0minutes, "+(full("p")?"sur les 3\u00a0dernières heures.":"depuis "+hm(first("p"))+"."))};
const play=()=>{clearInterval(tm);if(!matchMedia("(prefers-reduced-motion: reduce)").matches)tm=setInterval(()=>{k=(k+1)%fr.length;frame()},on==="p"?500:2500)};
const start=()=>{on=lay();if(!on)return;fr=list(on);k=0;fig.classList.add("rejeu");rng.max=String(fr.length-1);rng.hidden=false;btn.textContent="Revenir à maintenant";frame();play()};
const stop=()=>{clearInterval(tm);const l=on;on="";fig.classList.remove("rejeu");rng.hidden=true;RJ[l].back();upd()};
const get=()=>{if(asked||!lay())return;asked=true;Promise.all([fetch(rc.dataset.retro).then((r)=>{if(!r.ok)throw new Error(String(r.status));return r.json()}),RJ.p?RJ.p.prep():0]).then(([j])=>{J=j;upd()}).catch(()=>{})};
btn.addEventListener("click",()=>on?stop():start());rng.addEventListener("input",()=>{clearInterval(tm);k=+rng.value;frame()});
document.querySelectorAll("[name=wxl]").forEach((i)=>i.addEventListener("change",()=>{if(on)stop();get();upd()}));get()}`;

/** /meteo's own script: the stations' list (filter, sort, unfold), then the veil, the wind and the radar's rain, and their replay. */
export const METEO_SCRIPT = `const stl=document.getElementById("stl");if(stl){const sel=document.getElementById("stc"),bs=document.querySelectorAll("[data-s]");
const m=document.getElementById("stm"),open=()=>{stl.classList.remove("plie");if(m)m.parentElement.hidden=true};if(m)m.addEventListener("click",open);
const f=()=>{const c=sel.value;open();stl.querySelectorAll("li").forEach((li)=>{li.hidden=!!c&&li.dataset.c!==c})};sel.addEventListener("change",f);
bs.forEach((b)=>b.addEventListener("click",()=>{const k=b.dataset.s;open();bs.forEach((x)=>x.setAttribute("aria-pressed",x===b));
[...stl.children].sort((a,z)=>k==="n"?a.dataset.n.localeCompare(z.dataset.n,"fr"):k==="t"?(z.dataset.t===""?-99:+z.dataset.t)-(a.dataset.t===""?-99:+a.dataset.t):a.dataset.z-z.dataset.z).forEach((li)=>stl.append(li))}))}
// What the layers share: the time in La Réunion (UTC+4, no summer time), « hier » before midnight, and the replay's hooks.
const p2=(n)=>String(n).padStart(2,"0"),loc=(t)=>new Date(Date.parse(t)+144e5),hm=(t)=>{const x=loc(t);return p2(x.getUTCHours())+":"+p2(x.getUTCMinutes())};
const at_=(t)=>(loc(t).toISOString().slice(0,10)===loc(new Date().toISOString()).toISOString().slice(0,10)?"à ":"hier à ")+hm(t),RJ={};
// The map's canvases drawn by the processor, not the graphics card: Safari puts a canvas drawn on the card in a layer
// of its own, which a foreignObject then paints unscaled, off the map and over the text below (iPhone, 29/10).
const c2d=(c)=>c.getContext("2d",{willReadFrequently:true});
${VOILE_SCRIPT}
${ANIM}
${VENT_SCRIPT}
${PLUIE_SCRIPT}
${REJEU_SCRIPT}`;
