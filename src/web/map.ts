/**
 * The island as an inline SVG: coastline and communes from src/places/island.json (scripts/build-island.py), with
 * markers placed by the same projection. Colours come from the page's CSS, so the maps follow its light and dark themes.
 */
import island from "../places/island.json" with { type: "json" };
import relief from "./relief.json" with { type: "json" };
import { ACCUEILS } from "../providers/accueils-medias.js";

const [LON0, LAT0, LON1, LAT1] = island.bbox;
export const W = island.w;
export const H = island.h;
/** The island in relief (scripts/build-relief.py), a file of public/; its address changes with its content. */
export const RELIEF_PATH = `/relief-${relief.v}.webp`;

export function project(lon: number, lat: number): [number, number] {
  return [Math.round(((lon - LON0) / (LON1 - LON0)) * W), Math.round(((LAT1 - lat) / (LAT1 - LAT0)) * H)];
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** ` target="_blank"` for a link to a medium's home page: Freedom asks that it open « dans une nouvelle fenêtre ». */
export const fenetre = (lien?: string) => (lien && ACCUEILS.has(lien) ? ' target="_blank"' : "");

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
  /** A ring rather than a disc (round only): nothing measured lately. */
  hollow?: boolean;
  /** Its name in the tooltip only: for a crowded map where only a few markers need saying. */
  quiet?: boolean;
  /** Where a tap on it leads: the row of the page that details it, or the place's page. */
  href?: string;
  /** The value as said aloud, when `label` is a short form (« 24 °C » for « 24° »). */
  say?: string;
  /** The place as said aloud, when `name` already holds the value (« Saint-Pierre » for « Saint-Pierre : 3 libres »). */
  place?: string;
  /**
   * The bubble shown on hover, on a tap or on focus, with the page's script (bubbleOf()): the place, the value in
   * full, then its time and source. Said the same way to a screen reader, as the link's name.
   */
  tip?: { place: string; value: string; detail: string };
}

/** A commune of the map that leads somewhere: the card of its zone, its page. `say` is what the map shows of it. */
export interface ZoneLink {
  href: string;
  say?: string;
}

/** Wide enough for a finger on a phone, where the map is a third of its size: about 44 px across. */
const HIT = 66;

/**
 * Each linked marker's hit radius: at most half the way to the nearest other one, so that no two overlap and a tap
 * between them goes to the closer; never under the marker's own size.
 */
function hitRadii(markers: Marker[]): number[] {
  return spaced(markers.map((m) => project(m.lon, m.lat)), markers.map((m) => !!m.href), HIT, 34).map(Math.floor).map((r) => Math.max(34, r));
}

/** The same in any unit: at most `max`, at most half the way to the nearest other linked point, never under `min`. */
function spaced(at: number[][], linked: boolean[], max: number, min: number): number[] {
  return at.map(([x, y], i) => {
    let r = max;
    at.forEach(([x2, y2], j) => {
      if (j !== i && linked[j]) r = Math.min(r, Math.hypot(x2 - x, y2 - y) / 2);
    });
    return Math.max(min, r);
  });
}

const PEAKS = [
  { name: "Piton des Neiges", alt: "3 070 m", lon: 55.4783, lat: -21.0989 },
  { name: "Piton de la Fournaise", alt: "2 632 m", lon: 55.7083, lat: -21.2444 },
];

/** A pill's width for its label, and its height. */
const pillW = (m: Marker) => Math.max(64, m.label.length * 19 + 24);
const PILL_H = 48;
// Between two pills moved apart (their white edges never touch), and from a pill to the map's edge.
const GAP = 16;
// From a pill's edge to the centre of a place's dot (ties()): the dot with its white ring (12), the pill's white edge
// (2), and a little air.
const DOT = 18;

/** A pill at `at` still over its own place, the place's dot hidden under it whole: it stands on its place, untied. */
const onPlace = (m: Marker, at: [number, number]) => {
  const [x0, y0] = project(m.lon, m.lat);
  return Math.abs(at[0] - x0) <= pillW(m) / 2 - 12 && Math.abs(at[1] - y0) <= PILL_H / 2 - 12;
};

/**
 * Where to draw each marker so that no pill covers another (`apart`): those that would are pushed apart, each the
 * least, along the shorter way out, and kept inside the map; round markers stay where they are. No pill covers a place's
 * dot either, another's or its own once it has left it: half under a pill, a dot reads as a smudge (Saint-Denis's).
 * The same markers, the same places.
 */
function apart(markers: Marker[]): [number, number][] {
  const places = markers.map((m) => project(m.lon, m.lat));
  const p = places.map(([x, y]): [number, number] => [x, y]);
  const w = markers.map(pillW);
  const pill = markers.map((m) => !m.round);
  for (let round = 0; round < 200; round++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        if (!pill[i] || !pill[j]) continue;
        const dx = p[j][0] - p[i][0];
        const dy = p[j][1] - p[i][1];
        const ox = (w[i] + w[j]) / 2 + GAP - Math.abs(dx);
        const oy = PILL_H + GAP - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        // Half each; two at the same height or column apart in their order.
        if (ox < oy) {
          const s = dx < 0 ? -1 : 1;
          p[i][0] -= (s * ox) / 2;
          p[j][0] += (s * ox) / 2;
        } else {
          const s = dy < 0 ? -1 : 1;
          p[i][1] -= (s * oy) / 2;
          p[j][1] += (s * oy) / 2;
        }
      }
    }
    // A place stays where it is: the pill alone goes, all the way out, the shorter way that stays inside the map (a
    // place by the coast, at the top, sends it below or beside, never above).
    for (let i = 0; i < p.length; i++) {
      for (let j = 0; j < p.length; j++) {
        if (!pill[i] || !pill[j] || (i === j && onPlace(markers[i], p[i]))) continue;
        const [qx, qy] = places[j];
        const [hw, hh] = [w[i] / 2 + DOT, PILL_H / 2 + DOT];
        if (Math.abs(qx - p[i][0]) >= hw || Math.abs(qy - p[i][1]) >= hh) continue;
        const ways: [number, number][] = [[qx - hw, p[i][1]], [qx + hw, p[i][1]], [p[i][0], qy - hh], [p[i][0], qy + hh]];
        const inside = ways.filter(([x, y]) => x >= w[i] / 2 + GAP && x <= W - w[i] / 2 - GAP && y >= PILL_H / 2 + GAP && y <= H - PILL_H / 2 - GAP);
        const far = ([x, y]: [number, number]) => Math.abs(x - p[i][0]) + Math.abs(y - p[i][1]);
        const to = (inside.length ? inside : ways).reduce((a, b) => (far(b) < far(a) ? b : a));
        p[i] = [to[0], to[1]];
        moved = true;
      }
    }
    for (let i = 0; i < p.length; i++) {
      if (!pill[i]) continue;
      p[i][0] = Math.min(W - w[i] / 2 - GAP, Math.max(w[i] / 2 + GAP, p[i][0]));
      p[i][1] = Math.min(H - PILL_H / 2 - GAP, Math.max(PILL_H / 2 + GAP, p[i][1]));
    }
    if (!moved) break;
  }
  return p.map(([x, y]) => [Math.round(x), Math.round(y)]);
}

/** For each pill moved off its place (apart()), a dot at the place and a line to the pill: under every pill. */
function ties(markers: Marker[], at: [number, number][]): string {
  const out = markers.map((m, i) => {
    const [x0, y0] = project(m.lon, m.lat);
    const [x, y] = at[i];
    const fill = m.color ?? "var(--ink)";
    return !m.round && !onPlace(m, at[i])
      ? `<line x1="${x0}" y1="${y0}" x2="${x}" y2="${y}" stroke="${fill}" stroke-width="4"/><circle cx="${x0}" cy="${y0}" r="10" fill="${fill}" stroke="#fff" stroke-width="4"/>`
      : "";
  }).join("");
  return out ? `<g class="ties" aria-hidden="true">${out}</g>` : "";
}

/** `at`: where it is drawn, when moved from its place (apart()). */
function marker(m: Marker, hit = HIT, at?: [number, number]): string {
  const [x, y] = at ?? project(m.lon, m.lat);
  const fill = m.color ?? "var(--ink)";
  const w = pillW(m);
  const shape = m.round
    ? m.hollow
      ? `<circle class="sh" cx="${x}" cy="${y}" r="30" style="fill:#fff;stroke:${fill};stroke-width:8"/>`
      : `<circle class="sh" cx="${x}" cy="${y}" r="34" fill="${fill}"/>`
    : `<rect class="sh" x="${x - w / 2}" y="${y - 24}" width="${w}" height="48" rx="24" fill="${fill}"/>`;
  const inner = `<title>${esc(m.name)}</title>${shape}` +
    `<text x="${x}" y="${y + 11}" class="mv">${esc(m.label)}</text>` +
    (m.quiet ? "" : `<text x="${x}" y="${y + 66}" class="mn">${esc(m.name)}</text>`);
  if (!m.href) return `<g class="mk">${inner}</g>`;
  const said = m.tip ? `${m.tip.place} : ${m.tip.value}, ${m.tip.detail}, voir le détail` : `${m.place ?? m.name} : ${m.say ?? m.label}, voir le détail`;
  const tip = m.tip ? ` data-tp="${esc(m.tip.place)}" data-tv="${esc(m.tip.value)}" data-td="${esc(m.tip.detail)}"` : "";
  // The hit area under the marker, painted but invisible, so that a tap a little beside it still counts.
  return `<a class="mk" href="${esc(m.href)}" aria-label="${esc(said)}"${tip}>` +
    `<circle class="hit" cx="${x}" cy="${y}" r="${hit}" style="fill:transparent;stroke:none"/>${inner}</a>`;
}

/** Each linked commune as a link over its shape, invisible until hovered or focused. */
function zoneLinks(links: Record<string, ZoneLink>): string {
  const out = island.paths
    .filter((p) => links[p.nom])
    .map((p) => {
      const l = links[p.nom];
      const said = l.say ? `${p.nom} : ${l.say}, voir le détail` : `${p.nom}, voir sa page`;
      return `<a class="zn" href="${esc(l.href)}" aria-label="${esc(said)}"><title>${esc(p.nom)}</title><path d="${p.d}"/></a>`;
    })
    .join("");
  return out ? `<g class="zones">${out}</g>` : "";
}

/**
 * `highlight`: the commune whose page this is. `pin`: the place asked about, drawn as a dot with its name.
 * `peaks`: the two summits, for orientation on the island-wide map. `fills`: a colour per commune (the vigilance map).
 * Without `fills`, the land is the island's relief (the same image as the hero's), under the sea and coast of the
 * page's theme; with them, it stays flat so that the colours read.
 * `links` and the markers' `href` make the map a way into the page: with any of them, the map is a group of links
 * rather than an image, and works without the script.
 */
export function islandMap(opts: {
  markers?: Marker[];
  highlight?: string;
  pin?: { lon: number; lat: number; name: string };
  peaks?: boolean;
  fills?: Record<string, string>;
  /** A link per commune, over its shape. */
  links?: Record<string, ZoneLink>;
  /** The hero's island: the real relief (IGN altitudes, shaded), a lagoon glow along the coast, the two volcanoes marked. */
  relief?: boolean;
  /** Drawn over the land, under the markers: lines. */
  overlay?: string;
  /** Drawn over everything, the summits included: markers the page draws itself. */
  top?: string;
  /** Pills that would cover each other moved apart, each tied to its place (apart()). */
  apart?: boolean;
  /**
   * Markers in layers, one shown at a time by the page's CSS (`ly-<id>`, chosen by radio buttons, without a script):
   * the island drawn once for all of them; `on`, the one shown by default. Each layer is moved apart on its own, with
   * `apart`.
   */
  layers?: { id: string; markers: Marker[]; on?: boolean }[];
  label: string;
}): string {
  const paths = island.paths.map((p) => `<path d="${p.d}"/>`).join("");
  const hl = opts.highlight ? island.paths.find((p) => p.nom === opts.highlight) : undefined;
  const fills = island.paths
    .filter((p) => opts.fills?.[p.nom])
    .map((p) => `<path d="${p.d}" style="fill:${opts.fills![p.nom]}"/>`)
    .join("");
  // An image hides what it holds from screen readers: a map with links is a group, so that each link is reached.
  const linked = !!opts.links || !!opts.top || [...(opts.markers ?? []), ...(opts.layers ?? []).flatMap((l) => l.markers)].some((m) => m.href);
  const role = linked ? `role="group"` : `role="img"`;
  const zones = opts.links ? zoneLinks(opts.links) : "";
  const draw = (list: Marker[]) => {
    const radii = hitRadii(list);
    const at = opts.apart ? apart(list) : undefined;
    return (at ? ties(list, at) : "") + list.map((m, i) => marker(m, radii[i], at?.[i])).join("");
  };
  const markers = draw(opts.markers ?? []) + (opts.layers ?? []).map((l) => `<g class="ly ly-${esc(l.id)}${l.on ? " on" : ""}">${draw(l.markers)}</g>`).join("");
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
    return `<svg class="map relief" viewBox="0 0 ${W} ${H}" ${role} aria-label="${esc(opts.label)}">` +
      `<defs><g id="isl">${paths}</g>${defs}</defs>` +
      `<use href="#isl" class="halo" filter="url(#glow)"/><use href="#isl" class="coast"/><use href="#isl" class="ground"/>` +
      `<image href="${RELIEF_PATH}" width="${W}" height="${H}" preserveAspectRatio="none" clip-path="url(#isl-clip)"/>` +
      zones + peaks + markers + `</svg>`;
  }
  const terrain = !fills;
  const land = terrain
    ? `<use href="#isl" class="land"/><image href="${RELIEF_PATH}" width="${W}" height="${H}" preserveAspectRatio="none" clip-path="url(#isl-clip)"/>`
    : `<use href="#isl" class="land"/>${fills}`;
  return `<svg class="map${terrain ? " terrain" : ""}" viewBox="0 0 ${W} ${H}" ${role} aria-label="${esc(opts.label)}">` +
    `<defs><g id="isl">${paths}</g>${terrain ? `<clipPath id="isl-clip">${paths}</clipPath>` : ""}</defs>` +
    `<rect class="sea" width="${W}" height="${H}" rx="28"/>` +
    `<use href="#isl" class="coast"/>${land}<use href="#isl" class="borders"/>` +
    (opts.overlay ?? "") + zones + extra + markers + (opts.top ?? "") + `</svg>`;
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

// ---------------------------------------------------------------- a commune, close up

/** The bounds of a commune's outline, in the map's units: its path is « M » then relative « l » steps. */
function boundsOf(d: string): [number, number, number, number] {
  let x = 0, y = 0;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [, c, a, b] of d.matchAll(/([Ml])(-?[\d.]+)[, ]?(-?[\d.]+)/g)) {
    [x, y] = c === "M" ? [+a, +b] : [x + +a, y + +b];
    [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  }
  return [x0, y0, x1, y1];
}

export interface Spot {
  lon: number;
  lat: number;
  /** Its row in the page (`#<href>`), which the page's script also finds by `data-i`. */
  i: number;
  /** Its kind, which the page's filter hides by. */
  t: string;
  /** Its family, its colour (the legend's). */
  f: string;
  /** What it is, said aloud and on hover. */
  name: string;
}

/** The width the map is drawn at on a phone of 390 px, in its card: what a finger's 44 px are worth in the map's units. */
const PHONE_PX = 340;

/**
 * A commune close up (the children's page of a commune): the relief and the coast as on the island's map, the other
 * communes dimmed, its outline marked, and a dot per spot. The dots keep their size on screen when the page's script
 * zooms (a stroke that does not scale); each is a link to its row, its hit area as wide as a finger on a phone and no
 * wider than half the way to the next one. The frame is the commune's and its spots', 1:1 to 4:3, in `data-box`.
 */
export function communeMap(opts: { commune: string; spots: Spot[]; label: string; id?: string }): string {
  const shape = island.paths.find((p) => p.nom === opts.commune);
  if (!shape) return "";
  // A tenth of the map's unit is 7 m: enough for a dot.
  const at = opts.spots.map((s) => exact(s.lon, s.lat).map((v) => Math.round(v * 10) / 10));
  let [x0, y0, x1, y1] = boundsOf(shape.d);
  for (const [x, y] of at) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  let w = (x1 - x0) * 1.08;
  let h = (y1 - y0) * 1.08;
  if (w / h < 1) w = h;
  else if (w / h > 4 / 3) h = (w * 3) / 4;
  const box = [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h].map((v) => Math.round(v * 100) / 100);
  const unit = w / PHONE_PX;
  const radii = spaced(at, at.map(() => true), 22 * unit, 9 * unit);
  const paths = island.paths.map((p) => `<path d="${p.d}"/>`).join("");
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const dots = opts.spots.map((s, k) => {
    const [x, y] = at[k];
    // Its title names the link, aloud and on hover.
    return `<a class="sp" href="#lieu-${s.i}" data-i="${s.i}" data-t="${esc(s.t)}"><title>${esc(s.name)}</title>` +
      `<circle class="hit" cx="${x}" cy="${y}" r="${r2(radii[k])}"/><path class="rg" d="M${x} ${y}h0"/><path class="pt f-${esc(s.f)}" d="M${x} ${y}h0"/></a>`;
  }).join("");
  return `<svg${opts.id ? ` id="${opts.id}"` : ""} class="map terrain zoom commune" viewBox="${box.join(" ")}" data-box="${box.join(" ")}" role="group" aria-label="${esc(opts.label)}">` +
    `<defs><g id="isl">${paths}</g><clipPath id="isl-clip">${paths}</clipPath><clipPath id="com-clip"><path d="${shape.d}"/></clipPath></defs>` +
    `<rect class="sea" x="${r2(box[0] - w)}" y="${r2(box[1] - h)}" width="${r2(w * 3)}" height="${r2(h * 3)}"/>` +
    `<use href="#isl" class="coast"/><use href="#isl" class="land"/>` +
    `<image href="${RELIEF_PATH}" width="${W}" height="${H}" preserveAspectRatio="none" clip-path="url(#isl-clip)"/>` +
    // The island dimmed, then the commune's relief again over it, clear.
    `<use href="#isl" class="dim"/><image href="${RELIEF_PATH}" width="${W}" height="${H}" preserveAspectRatio="none" clip-path="url(#com-clip)"/>` +
    `<path class="hl" d="${shape.d}"/><g class="spots">${dots}</g></svg>`;
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
