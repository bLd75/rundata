/**
 * The island as an inline SVG: coastline and communes from src/places/island.json (scripts/build-island.py), with
 * markers placed by the same projection; and, for the cyclones, the ocean around it (src/web/ocean.json,
 * scripts/build-ocean.py). Colours come from the page's CSS, so the maps follow its light and dark themes.
 */
import island from "../places/island.json" with { type: "json" };
import relief from "./relief.json" with { type: "json" };
import ocean from "./ocean.json" with { type: "json" };

const [LON0, LAT0, LON1, LAT1] = island.bbox;
export const W = island.w;
export const H = island.h;
/** The island in relief (scripts/build-relief.py), served by src/web/site.ts; its address changes with its content. */
export const RELIEF_PATH = `/relief-${relief.v}.webp`;
export const reliefImage = () => relief.webp;

export function project(lon: number, lat: number): [number, number] {
  return [Math.round(((lon - LON0) / (LON1 - LON0)) * W), Math.round(((LAT1 - lat) / (LAT1 - LAT0)) * H)];
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface Marker {
  lon: number;
  lat: number;
  /** Short text inside the marker: « 24° », « 15 km/h ». */
  label: string;
  /** Name next to the marker on wide screens, and in the tooltip. */
  name: string;
  color?: string;
  /** Round for a temperature, a pill for anything else. */
  round?: boolean;
  /** Its name in the tooltip only: for a crowded map where only a few markers need saying. */
  quiet?: boolean;
}

const PEAKS = [
  { name: "Piton des Neiges", alt: "3 070 m", lon: 55.4783, lat: -21.0989 },
  { name: "Piton de la Fournaise", alt: "2 632 m", lon: 55.7083, lat: -21.2444 },
];

function marker(m: Marker): string {
  const [x, y] = project(m.lon, m.lat);
  const fill = m.color ?? "var(--ink)";
  const w = Math.max(64, m.label.length * 19 + 24);
  const shape = m.round
    ? `<circle cx="${x}" cy="${y}" r="34" fill="${fill}"/>`
    : `<rect x="${x - w / 2}" y="${y - 24}" width="${w}" height="48" rx="24" fill="${fill}"/>`;
  return `<g class="mk"><title>${esc(m.name)}</title>${shape}` +
    `<text x="${x}" y="${y + 11}" class="mv">${esc(m.label)}</text>` +
    (m.quiet ? "" : `<text x="${x}" y="${y + 66}" class="mn">${esc(m.name)}</text>`) + "</g>";
}

/**
 * `highlight`: the commune whose page this is. `pin`: the place asked about, drawn as a dot with its name.
 * `peaks`: the two summits, for orientation on the island-wide map. `fills`: a colour per commune (the vigilance map).
 * Without `fills`, the land is the island's relief (the same image as the hero's), under the sea and coast of the
 * page's theme; with them, it stays flat so that the colours read.
 */
export function islandMap(opts: {
  markers?: Marker[];
  highlight?: string;
  pin?: { lon: number; lat: number; name: string };
  peaks?: boolean;
  fills?: Record<string, string>;
  /** The hero's island: the real relief (IGN altitudes, shaded), a lagoon glow along the coast, the two volcanoes marked. */
  relief?: boolean;
  /** Drawn over the land, under the markers: lines. */
  overlay?: string;
  label: string;
}): string {
  const paths = island.paths.map((p) => `<path d="${p.d}"/>`).join("");
  const hl = opts.highlight ? island.paths.find((p) => p.nom === opts.highlight) : undefined;
  const fills = island.paths
    .filter((p) => opts.fills?.[p.nom])
    .map((p) => `<path d="${p.d}" style="fill:${opts.fills![p.nom]}"/>`)
    .join("");
  let extra = "";
  if (hl) extra += `<path class="hl" d="${hl.d}"/>`;
  if (opts.peaks) {
    for (const p of PEAKS) {
      const [x, y] = project(p.lon, p.lat);
      extra += `<g class="pk"><path d="M${x - 14} ${y + 10}L${x} ${y - 14}L${x + 14} ${y + 10}Z"/>` +
        `<text x="${x}" y="${y + 40}">${esc(p.name)}</text><text x="${x}" y="${y + 66}">${p.alt}</text></g>`;
    }
  }
  if (opts.pin) {
    const [x, y] = project(opts.pin.lon, opts.pin.lat);
    extra += `<g class="pin"><circle cx="${x}" cy="${y}" r="16"/><circle cx="${x}" cy="${y}" r="34" class="halo"/>` +
      `<text x="${x}" y="${y - 50}">${esc(opts.pin.name)}</text></g>`;
  }
  if (opts.relief) {
    // The relief image has the map's bounds and proportions, cut along the map's own coastline.
    const defs = `<clipPath id="isl-clip">${paths}</clipPath>` +
      `<filter id="glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>`;
    const peaks = PEAKS.map((p) => {
      const [x, y] = project(p.lon, p.lat);
      // The name above the summit: the stations around it carry their temperature just below.
      return `<g class="pk"><path d="M${x - 16} ${y + 12}L${x} ${y - 16}L${x + 16} ${y + 12}Z"/><text x="${x}" y="${y - 28}">${esc(p.name)}</text></g>`;
    }).join("");
    return `<svg class="map relief" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">` +
      `<defs><g id="isl">${paths}</g>${defs}</defs>` +
      `<use href="#isl" class="halo" filter="url(#glow)"/><use href="#isl" class="coast"/><use href="#isl" class="ground"/>` +
      `<image href="${RELIEF_PATH}" width="${W}" height="${H}" preserveAspectRatio="none" clip-path="url(#isl-clip)"/>` +
      peaks + (opts.markers ?? []).map(marker).join("") + `</svg>`;
  }
  const terrain = !fills;
  const land = terrain
    ? `<use href="#isl" class="land"/><image href="${RELIEF_PATH}" width="${W}" height="${H}" preserveAspectRatio="none" clip-path="url(#isl-clip)"/>`
    : `<use href="#isl" class="land"/>${fills}`;
  return `<svg class="map${terrain ? " terrain" : ""}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">` +
    `<defs><g id="isl">${paths}</g>${terrain ? `<clipPath id="isl-clip">${paths}</clipPath>` : ""}</defs>` +
    `<rect class="sea" width="${W}" height="${H}" rx="28"/>` +
    `<use href="#isl" class="coast"/>${land}<use href="#isl" class="borders"/>` +
    (opts.overlay ?? "") + extra + (opts.markers ?? []).map(marker).join("") + `</svg>`;
}

// ---------------------------------------------------------------- every hike and trail of the island

/** Douglas-Peucker on projected points: what the island's map can show of a line. */
function thin(xy: [number, number][], tol: number): [number, number][] {
  if (xy.length < 3) return xy;
  const keep = new Uint8Array(xy.length);
  keep[0] = keep[xy.length - 1] = 1;
  const stack: [number, number][] = [[0, xy.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [x1, y1] = xy[a];
    const [x2, y2] = xy[b];
    const len = Math.hypot(x2 - x1, y2 - y1);
    let best = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = xy[i];
      const d = len ? Math.abs((y2 - y1) * (x - x1) - (x2 - x1) * (y - y1)) / len : Math.hypot(x - x1, y - y1);
      if (d > best) [best, at] = [d, i];
    }
    if (at >= 0 && best > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return xy.filter((_, i) => keep[i]);
}

/** A line in the island's coordinates, about a unit (70 m) apart, relative moves: a few bytes a point. */
export function pathOf(points: [number, number][], tol = 0.6): string {
  const xy = thin(points.map(([lon, lat]) => exact(lon, lat) as [number, number]), tol).map(([x, y]) => [Math.round(x), Math.round(y)]);
  const out: string[] = [];
  let [px, py] = xy[0] ?? [0, 0];
  for (const [x, y] of xy.slice(1)) {
    if (x === px && y === py) continue;
    out.push(`${x - px} ${y - py}`);
    [px, py] = [x, y];
  }
  return out.length ? `M${xy[0][0]} ${xy[0][1]}l${out.join(" ").replace(/ -/g, "-")}` : "";
}

export interface HikeLine {
  k: string;
  genre: "randonnee" | "sentier";
  etat: string;
  d: string;
  href: string;
  nom: string;
}

/**
 * The island in relief with every hike and ONF trail: the trails open or unknown first, the hikes over them, the
 * closed trails on top so that no closure is hidden. `data-k` ties each line to its entry in the list below the map,
 * for the filter and for a click on it.
 */
export function hikesMap(lines: HikeLine[], label: string): string {
  const cls = (l: HikeLine) => (l.genre === "randonnee" ? "rte" : `trk ${l.etat === "fermé" ? "ferme" : l.etat || "inconnu"}`);
  // A link and a name on each of the few hundred lines would weigh more than the lines: the hikes get a name, and the
  // page's script opens the page of the line clicked, from the list.
  const draw = (l: HikeLine) => `<path class="${cls(l)}" data-k="${l.k}" d="${l.d}">${l.genre === "randonnee" ? `<title>${esc(l.nom)}</title>` : ""}</path>`;
  const under = lines.filter((l) => l.genre === "sentier" && l.etat !== "fermé");
  const routes = lines.filter((l) => l.genre === "randonnee");
  const closed = lines.filter((l) => l.genre === "sentier" && l.etat === "fermé");
  const svg = islandMap({ label, overlay: `<g class="lines">${[...under, ...routes, ...closed].map(draw).join("")}</g>` });
  return svg.replace('<svg class="map terrain"', '<svg id="hmap" class="map terrain hikes"');
}

// ---------------------------------------------------------------- a trail, close up

/** Unrounded, for a line drawn a few kilometres wide. */
const exact = (lon: number, lat: number) => [((lon - LON0) / (LON1 - LON0)) * W, ((LAT1 - lat) / (LAT1 - LAT0)) * H].map((v) => Math.round(v * 100) / 100);

export interface TraceLine {
  points: [number, number][];
  /** « ouvert », « ferme », « inconnu »: its colour. */
  etat: string;
}

/**
 * The island cropped around a trail: the relief and the coast as on the island's map, the trail drawn over it coloured
 * by its state, its start marked. The crop keeps the map's proportions and at least `minKm` across.
 */
export function traceMap(opts: { lines: TraceLine[]; label: string; minKm?: number }): string {
  const pts = opts.lines.flatMap((l) => l.points.map(([lon, lat]) => exact(lon, lat)));
  if (!pts.length) return "";
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const unitKm = ((LON1 - LON0) * 111.32 * Math.cos((((LAT0 + LAT1) / 2) * Math.PI) / 180)) / W;
  const min = (opts.minKm ?? 3) / unitKm;
  let w = Math.max(Math.max(...xs) - Math.min(...xs), min) * 1.25;
  let h = Math.max(Math.max(...ys) - Math.min(...ys), min) * 1.25;
  // The figure is 4:3, like the island's.
  if (w / h < 4 / 3) w = (h * 4) / 3;
  else h = (w * 3) / 4;
  const x0 = (Math.min(...xs) + Math.max(...xs)) / 2 - w / 2;
  const y0 = (Math.min(...ys) + Math.max(...ys)) / 2 - h / 2;
  const r = w / 90;
  const paths = island.paths.map((p) => `<path d="${p.d}"/>`).join("");
  const d = (l: TraceLine) => l.points.map(([lon, lat], i) => `${i ? "L" : "M"}${exact(lon, lat).join(" ")}`).join("");
  const [sx, sy] = exact(...opts.lines[0].points[0]);
  const box = [x0, y0, w, h].map((v) => Math.round(v * 100) / 100).join(" ");
  return `<svg class="map terrain zoom" viewBox="${box}" role="img" aria-label="${esc(opts.label)}">` +
    `<defs><g id="isl">${paths}</g><clipPath id="isl-clip">${paths}</clipPath></defs>` +
    `<rect class="sea" x="${x0 - w}" y="${y0 - h}" width="${w * 3}" height="${h * 3}"/>` +
    `<use href="#isl" class="coast"/><use href="#isl" class="land"/>` +
    `<image href="${RELIEF_PATH}" width="${W}" height="${H}" preserveAspectRatio="none" clip-path="url(#isl-clip)"/>` +
    opts.lines.map((l) => `<path class="trk-halo" d="${d(l)}"/><path class="trk ${esc(l.etat)}" d="${d(l)}"/>`).join("") +
    `<circle class="trk-start" cx="${sx}" cy="${sy}" r="${Math.round(r * 100) / 100}"/></svg>`;
}

/** The altitude along the trail: an area, the axes in km and m. */
export function profile(points: { km: number; ele: number }[], label: string): string {
  if (points.length < 2) return "";
  const PW = 640;
  const PH = 200;
  const pad = { l: 46, r: 12, t: 24, b: 26 };
  const km = points[points.length - 1].km || 1;
  const lo = Math.min(...points.map((p) => p.ele));
  const hi = Math.max(...points.map((p) => p.ele));
  const step = [50, 100, 200, 250, 500, 1000].find((s) => (hi - lo) / s <= 5) ?? 1000;
  const zLo = Math.floor(lo / step) * step;
  const zHi = Math.max(Math.ceil(hi / step) * step, zLo + step);
  const x = (k: number) => pad.l + (k / km) * (PW - pad.l - pad.r);
  const y = (z: number) => pad.t + (1 - (z - zLo) / (zHi - zLo)) * (PH - pad.t - pad.b);
  const f = (n: number) => Math.round(n * 10) / 10;
  const line = points.map((p, i) => `${i ? "L" : "M"}${f(x(p.km))} ${f(y(p.ele))}`).join("");
  const area = `${line}L${f(x(km))} ${PH - pad.b}L${pad.l} ${PH - pad.b}Z`;
  const kmStep = [0.5, 1, 2, 5, 10, 20, 50].find((s) => km / s <= 8) ?? 50;
  const ticksY = Array.from({ length: Math.round((zHi - zLo) / step) + 1 }, (_, i) => zLo + i * step);
  const ticksX = Array.from({ length: Math.floor(km / kmStep) + 1 }, (_, i) => i * kmStep);
  return `<svg class="profile" viewBox="0 0 ${PW} ${PH}" role="img" aria-label="${esc(label)}">` +
    ticksY.map((z) => `<line class="grid" x1="${pad.l}" x2="${PW - pad.r}" y1="${f(y(z))}" y2="${f(y(z))}"/><text class="ax" x="${pad.l - 6}" y="${f(y(z)) + 4}" text-anchor="end">${z}</text>`).join("") +
    ticksX.map((k) => `<text class="ax" x="${f(x(k))}" y="${PH - 8}" text-anchor="middle">${String(k).replace(".", ",")}</text>`).join("") +
    `<path class="fill" d="${area}"/><path class="line" d="${line}"/>` +
    `<text class="ax" x="${PW - pad.r}" y="${PH - 8}" text-anchor="end">km</text><text class="ax" x="${pad.l - 6}" y="12" text-anchor="end">m</text></svg>`;
}

// ---------------------------------------------------------------- the ocean around, for the cyclones

/** Small islands drawn as dots: too small for the coastline at this scale. */
const ISLETS = [
  { name: "Maurice", lon: 57.55, lat: -20.25 },
  { name: "Rodrigues", lon: 63.42, lat: -19.72 },
  { name: "Mayotte", lon: 45.15, lat: -12.82 },
  { name: "Comores", lon: 43.33, lat: -11.7 },
  { name: "Seychelles", lon: 55.45, lat: -4.62 },
];
const OW = 1000;
const KX = Math.cos((20 * Math.PI) / 180);

export interface Track {
  name: string;
  /** [lon, lat] observed so far, the last one being the system now. */
  past: [number, number][];
  /** [lon, lat] forecast by the RSMC. */
  forecast: [number, number][];
  /** The label at its last position: its stage, or its dates for a system over. */
  label: string;
  active: boolean;
}

/**
 * The south-west Indian Ocean, framed on the tracks and La Réunion, with rings at 500 and 1 000 km from the island:
 * the distances the cyclone bulletins speak in.
 */
export function oceanMap(opts: { tracks: Track[]; label: string; home: { lon: number; lat: number } }): string {
  const pts = [[opts.home.lon, opts.home.lat], ...opts.tracks.flatMap((t) => [...t.past, ...t.forecast])];
  let [lon0, lon1] = [Math.min(...pts.map((p) => p[0])) - 4, Math.max(...pts.map((p) => p[0])) + 4];
  let [lat0, lat1] = [Math.min(...pts.map((p) => p[1])) - 4, Math.max(...pts.map((p) => p[1])) + 4];
  // At least the island's neighbourhood, and the proportions of the frame.
  const grow = (a: number, b: number, span: number) => (b - a < span ? [(a + b) / 2 - span / 2, (a + b) / 2 + span / 2] : [a, b]);
  [lon0, lon1] = grow(lon0, lon1, 24);
  [lat0, lat1] = grow(lat0, lat1, 16);
  const ratio = 0.68;
  const wDeg = (lon1 - lon0) * KX;
  if ((lat1 - lat0) / wDeg < ratio) [lat0, lat1] = grow(lat0, lat1, wDeg * ratio);
  else [lon0, lon1] = grow(lon0, lon1, (lat1 - lat0) / ratio / KX);
  const H = Math.round(OW * ratio);
  const xy = (lon: number, lat: number) => [Math.round(((lon - lon0) / (lon1 - lon0)) * OW), Math.round(((lat1 - lat) / (lat1 - lat0)) * H)];
  const line = (p: number[][]) => p.map(([lon, lat], i) => `${i ? "L" : "M"}${xy(lon, lat).join(" ")}`).join("");

  const land = ocean.rings.map((r) => `${line(r)}Z`).join("");
  let grid = "";
  for (let lon = Math.ceil(lon0 / 10) * 10; lon < lon1; lon += 10) {
    const [x] = xy(lon, 0);
    grid += `<path class="grat" d="M${x} 0V${H}"/><text class="gl" x="${x + 8}" y="${H - 12}">${lon}° E</text>`;
  }
  for (let lat = Math.ceil(lat0 / 10) * 10; lat < lat1; lat += 10) {
    const [, y] = xy(0, lat);
    grid += `<path class="grat" d="M0 ${y}H${OW}"/><text class="gl" x="12" y="${y - 8}" style="text-anchor:start">${-lat}° S</text>`;
  }
  const [hx, hy] = xy(opts.home.lon, opts.home.lat);
  const kmPerPx = ((lat1 - lat0) * 111.2) / H;
  const rings = [500, 1000]
    .map((km) => `<circle class="ring" cx="${hx}" cy="${hy}" r="${Math.round(km / kmPerPx)}"/><text class="rl" x="${hx}" y="${hy - Math.round(km / kmPerPx) - 8}">${km === 1000 ? "1 000" : km} km</text>`)
    .join("");
  // Not along the edges, where their names would be cut.
  const islets = ISLETS.map((i) => ({ ...i, at: xy(i.lon, i.lat) }))
    .filter(({ at: [x, y] }) => x > 60 && x < OW - 60 && y > 20 && y < H - 40)
    .map(({ name, at: [x, y] }) => `<g class="islet"><circle cx="${x}" cy="${y}" r="5"/><text x="${x}" y="${y - 12}">${esc(name)}</text></g>`)
    .join("");
  // The island's name on the side of the nearest system, the system's on the other: +1 when it is east of the island.
  const nearest = opts.tracks.map((t) => t.past.at(-1)).filter((p): p is [number, number] => !!p)
    .sort((a, b) => Math.hypot(a[0] - opts.home.lon, a[1] - opts.home.lat) - Math.hypot(b[0] - opts.home.lon, b[1] - opts.home.lat))[0];
  const homeSide = nearest && nearest[0] > opts.home.lon ? 1 : -1;
  const away = (x: number) => (x >= hx ? 1 : -1);
  const tracks = opts.tracks
    .map((t) => {
      const now = t.past.at(-1);
      if (!now) return "";
      const [x, y] = xy(now[0], now[1]);
      const fc = t.forecast.length ? [now, ...t.forecast] : [];
      return `<g class="trk${t.active ? " on" : ""}"><title>${esc(t.name)}</title>` +
        `<path class="past" d="${line(t.past)}"/>` +
        (fc.length ? `<path class="fc" d="${line(fc)}"/>${t.forecast.map(([lon, lat]) => { const [fx, fy] = xy(lon, lat); return `<circle class="fp" cx="${fx}" cy="${fy}" r="6"/>`; }).join("")}` : "") +
        `<circle class="eye" cx="${x}" cy="${y}" r="${t.active ? 16 : 10}"/>` +
        // Its names on the side away from the island, whose own name is on the other side.
        `<text class="tn" x="${x + 28 * away(x)}" y="${y - 4}" style="text-anchor:${away(x) > 0 ? "start" : "end"}">${esc(t.name)}</text>` +
        `<text class="ts" x="${x + 28 * away(x)}" y="${y + 22}" style="text-anchor:${away(x) > 0 ? "start" : "end"}">${esc(t.label)}</text></g>`;
    })
    .join("");
  return `<svg class="map ocean" viewBox="0 0 ${OW} ${H}" role="img" aria-label="${esc(opts.label)}">` +
    `<rect class="sea" width="${OW}" height="${H}" rx="28"/>${grid}<path class="land" d="${land}"/><path class="shore" d="${land}"/>` +
    rings + islets +
    `<g class="home"><circle cx="${hx}" cy="${hy}" r="9"/><text x="${hx - 18 * homeSide}" y="${hy + 7}" style="text-anchor:${homeSide > 0 ? "end" : "start"}">La Réunion</text></g>` +
    tracks + `</svg>`;
}
