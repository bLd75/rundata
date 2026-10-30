/**
 * The island as an inline SVG: coastline and communes from src/places/island.json (scripts/build-island.py), with
 * markers placed by the same projection. Colours come from the page's CSS, so the maps follow its light and dark themes.
 */
import island from "../places/island.json" with { type: "json" };
import relief from "./relief.json" with { type: "json" };
import routes from "./routes.json" with { type: "json" };
import { ACCUEILS } from "../providers/accueils-medias.js";

const [LON0, LAT0, LON1, LAT1] = island.bbox;
export const W = island.w;
export const H = island.h;
/** The island in relief (scripts/build-relief.py), a file of public/; its address changes with its content. */
export const RELIEF_PATH = `/relief-${relief.v}.webp`;

/**
 * The credit of the island's map, for a page that names its own sources (the footer then names none): the communes'
 * contours (scripts/build-island.py), and what the IGN gives when it is drawn: the relief (scripts/build-relief.py),
 * the roads and the names of places (scripts/build-routes.py).
 */
export function mapCredit(html: string): string | undefined {
  if (!html.includes('<use href="#isl"')) return undefined;
  const ign = [
    html.includes(RELIEF_PATH) && ["relief", "RGE ALTI"],
    html.includes('<g class="rd"') && [html.includes('<g class="nm"') ? "routes et noms de lieux" : "routes", "BD TOPO"],
  ].filter((x): x is string[] => !!x);
  const what = ign.length === 2 ? `${ign[0][0]}, ${ign[1][0]}` : ign[0]?.[0];
  // The background the visitor picks on a zoomed map, named by FONDS_SCRIPT once chosen.
  const fond = html.includes('class="tabs fonds"') ? '<span class="fd-c"></span>' : "";
  return `<p class="sources">Carte : contours des communes de geo.api.gouv.fr${what ? `, ${what} de l'IGN (${ign.map((x) => x[1]).join(", ")})${fond}, sous Licence Ouverte Etalab 2.0` : " (Licence Ouverte Etalab 2.0)"}.</p>`;
}

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
  /** The figure's colour, when white would not read on `color` (a light green pill). */
  ink?: string;
  /** A disc 1.4 times the others' size, with a thick white edge (round only): the one to see first, its shape saying it,
   * not a colour that would read as an alert (a river rising on /crues). */
  big?: boolean;
  /** A triangle, point up, the size of a disc: a hot spot seen by satellite (/feux), its shape saying what it is. */
  triangle?: boolean;
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
 * The same markers, the same places. `widths`: the pills' own, for pills drawn elsewhere (the wind's, meteo-carte.ts).
 * `aside`: how much further a pill may go sideways than up or down (the wind's: two places on one point side by side,
 * which leaves the room above and below to a commune's name).
 */
export function apart(markers: Marker[], widths = markers.map(pillW), aside = 1): [number, number][] {
  const places = markers.map((m) => project(m.lon, m.lat));
  const p = places.map(([x, y]): [number, number] => [x, y]);
  const w = widths;
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
        if (ox < oy * aside) {
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
  const shape = m.triangle
    ? `<path class="sh" d="M${x} ${y - 38}L${x + 37} ${y + 28}H${x - 37}Z" fill="${fill}"/>`
    : m.round
    ? m.hollow
      ? `<circle class="sh" cx="${x}" cy="${y}" r="22" style="fill:none;stroke:${fill};stroke-width:6"/>`
      : m.big
      ? `<circle class="sh" cx="${x}" cy="${y}" r="48" fill="${fill}" style="stroke:#fff;stroke-width:9"/>`
      : `<circle class="sh" cx="${x}" cy="${y}" r="34" fill="${fill}"/>`
    : `<rect class="sh" x="${x - w / 2}" y="${y - 24}" width="${w}" height="48" rx="24" fill="${fill}"/>`;
  const inner = `<title>${esc(m.name)}</title>${shape}` +
    (m.big ? `<text x="${x}" y="${y + 15}" class="mv" style="font-size:42px">${esc(m.label)}</text>` : `<text x="${x}" y="${y + 11}" class="mv"${m.ink ? ` style="fill:${m.ink}"` : ""}>${esc(m.label)}</text>`) +
    (m.quiet ? "" : `<text x="${x}" y="${y + 66}" class="mn">${esc(m.name)}</text>`);
  if (!m.href) return `<g class="mk">${inner}</g>`;
  const said = m.tip ? `${m.tip.place} : ${m.tip.value}, ${m.tip.detail}, voir le détail` : `${m.place ?? m.name} : ${m.say ?? m.label}, voir le détail`;
  const tip = m.tip ? ` data-tp="${esc(m.tip.place)}" data-tv="${esc(m.tip.value)}" data-td="${esc(m.tip.detail)}"` : "";
  // What the bubble on hover says, and the list of close points on a tap (carte-points.ts); a marker with a bubble has its own.
  const lines = m.tip ? [] : [m.place ?? m.name, m.say ?? m.label];
  // The hit area under the marker, painted but invisible, so that a tap a little beside it still counts.
  return `<a class="mk" href="${esc(m.href)}" aria-label="${esc(said)}"${tip}${pointData(lines)}>` +
    `<circle class="hit" cx="${x}" cy="${y}" r="${hit}" style="fill:transparent;stroke:none"/>${inner}</a>`;
}

/** A point's lines for carte-points.ts: its name, then its kind or value, then its address or time. */
const pointData = (lines: (string | undefined)[]) =>
  (["pn", "p2", "p3"] as const).map((k, i) => (lines[i] ? ` data-${k}="${esc(lines[i]!)}"` : "")).join("");

/** Each linked commune as a link over its shape, invisible until hovered or focused. */
function zoneLinks(links: Record<string, ZoneLink>, named = false): string {
  const out = island.paths
    .filter((p) => links[p.nom])
    .map((p) => {
      const l = links[p.nom];
      const said = l.say ? `${p.nom} : ${l.say}, voir le détail` : `${p.nom}, voir sa page`;
      return `<a class="zn" href="${esc(l.href)}"${named ? ' tabindex="-1" aria-hidden="true"' : ` aria-label="${esc(said)}"`}><title>${esc(p.nom)}</title><path d="${p.d}"/></a>`;
    })
    .join("");
  return out ? `<g class="zones">${out}</g>` : "";
}

// ---------------------------------------------------------------- roads and names of places, to tell where a point is

/** The bounds of a road of routes.json: « M » then relative moves, numbers only. */
function lineBounds(d: string): Box {
  const n = d.match(/-?(?:\d+\.?\d*|\.\d+)/g)!.map(Number);
  let [x, y] = n;
  let b: Box = [x, y, x, y];
  for (let i = 2; i + 1 < n.length; i += 2) {
    x += n[i];
    y += n[i + 1];
    b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  }
  return b;
}

/** x0, y0, x1, y1, in the map's units. */
type Box = [number, number, number, number];
const touch = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** The roads of the maps close up (scripts/build-routes.py), with their bounds: a map takes those in its frame. */
const CLOSE = [routes.axes, routes.departementales].flatMap((list, k) => list.map((d) => ({ main: !k, d, b: lineBounds(d) })));

/**
 * The roads, under a map's data, the same width on screen at any zoom: on the island's map, the main ones alone (one
 * path); in a frame `[x, y, w, h]`, the main departmental roads as well, those that cross it.
 */
function roadsLayer(frame?: number[]): string {
  const cut: Box | undefined = frame && [frame[0], frame[1], frame[0] + frame[2], frame[1] + frame[3]];
  const of = (main: boolean) => (cut ? CLOSE.filter((r) => r.main === main && touch(r.b, cut)).map((r) => r.d).join("") : main ? routes.ile : "");
  const [a, d] = [of(true), of(false)];
  // Each drawn twice, its dark edge then its line; the departmental roads under the main ones.
  const def = (id: string, path: string) => (path ? `<path id="${id}" vector-effect="non-scaling-stroke" d="${path}"/>` : "");
  const use = (id: string, path: string, cls: string) => (path ? `<use href="#${id}" class="rh${cls}"/><use href="#${id}" class="rt${cls}"/>` : "");
  return `<g class="rd" aria-hidden="true"><defs>${def("rd-d", d)}${def("rd-a", a)}</defs>${use("rd-d", d, " dp")}${use("rd-a", a, "")}</g>`;
}

/** The island's map on a phone names these six (marketing): the prefecture, the sub-prefectures and the cirques. */
const SIX = new Set(["Saint-Denis", "Saint-Paul", "Saint-Pierre", "Saint-Benoît", "Cilaos", "Salazie"]);

/** A name's size on screen, in px (marketing): a commune's, any other place's. NOMS_SCRIPT gives a commune 13 px on a map 640 px wide or more. */
const namePx = (rank: number) => (rank ? 11 : 12);

/** About how wide a name is, in ems of the system font: enough for the server's own placement (NOMS_SCRIPT measures). */
const EM = 0.56;

/**
 * The names of places over a map, under its points: the communes, then, close up (`close`), the places of the frame
 * by importance. `frame` is the part of the map shown, `unit` its units per pixel on a phone (PHONE_PX), `busy` what a
 * name must not touch: points, pills and labels. A name is shown only if it touches nothing there nor a name already
 * shown, on its place or around it (NUDGE: a name stands for an area; a commune or a big quarter a little further, FAR),
 * so the lesser ones go first; a commune's name only on it, its middle and most of it (mostlyOn()), or at sea off its
 * coast, never on another, and on the island's map up to 6 times its size from its town, beyond 3 facing it (AROUND, coastNear()). On the island's map, a phone names only the six (SIX). `within`: the commune of the map
 * (`commune`), the places of importance 2 named only inside it, those of importance 3 only if far from all else
 * (isolated()), and the commune's own name always, first, at the free place inside it or off its coast nearest its
 * centre if none around is free (marketing). This is the placement for a phone and without a script: NOMS_SCRIPT does it again at the
 * map's real size, after each zoom. `hide`: none shown until then, for a map whose points the server does not know (`top`).
 */
function namesLayer(opts: {
  frame: number[]; unit: number; busy: Box[]; close?: boolean; hide?: boolean; within?: [number, number][]; centre?: [number, number]; commune?: string;
}): string {
  const [fx, fy, fw, fh] = opts.frame;
  const u = opts.unit;
  const shown: Box[] = [];
  const all = (routes.noms as [string, number, number, number][])
    .filter(([, rank, x, y]) => (opts.close || !rank) && x >= fx && x <= fx + fw && y >= fy && y <= fy + fh)
    .filter(([, rank, x, y]) => rank < 2 || !opts.within || (inRing(x, y, opts.within) && (rank === 2 || isolated(x, y))));
  // A name once in a frame (marketing): the most important of the places so named, then the nearest the centre.
  const [cx, cy] = opts.centre ?? [fx + fw / 2, fy + fh / 2];
  const far = ([, , x, y]: [string, number, number, number]) => (x - cx) ** 2 + (y - cy) ** 2;
  const best = new Map<string, [string, number, number, number]>();
  for (const n of all) {
    const o = best.get(n[0]);
    if (!o || n[1] < o[1] || (n[1] === o[1] && far(n) < far(o))) best.set(n[0], n);
  }
  const own = (nom: string, rank: number) => !!opts.within && !rank && nom === opts.commune;
  const list = all.filter((n) => best.get(n[0]) === n).sort((a, b) => +own(b[0], b[1]) - +own(a[0], a[1]));
  const at = new Map<(typeof list)[number], [number, number] | undefined>();
  const place = (n: (typeof list)[number], look = false) => {
    const [nom, rank, x, y] = n;
    const fs = namePx(rank) * u;
    const half = (nom.length * EM * fs) / 2 + 2 * u;
    const boxAt = ([dx, dy]: [number, number]): Box => [x + dx - half, y + dy - fs * 0.6 - 2 * u, x + dx + half, y + dy + fs * 0.6 + 2 * u];
    // A commune's name, never on another commune (marketing): its middle inside its own, the commune of the map's whole
    // inside it, or at sea off its coast.
    const ring = rank ? undefined : LAND[COMMUNES.get(nom) ?? -1]?.ring;
    // On the island's map, a commune's name stands for its town (marketing): up to 6 times its size from it, beyond 3
    // times facing it, and at sea only where the nearest coast is the commune's.
    const isle = !opts.close && !!ring;
    const fits = (d: [number, number], far = false) => {
      const b = boxAt(d);
      if (b[0] < fx || b[1] < fy || b[2] > fx + fw || b[3] > fy + fh || [...opts.busy, ...shown].some((o) => touch(o, b))) return false;
      if (!ring) return true;
      if (far && !facesOwn([x + d[0], y + d[1]], [x, y], ring, fs / 2)) return false;
      const sea = () => towardsOwn([x + d[0], y + d[1]], [x, y], ring, fs / 2) && (!isle || coastNear(x + d[0], y + d[1], fs / 2).has(COMMUNES.get(nom)!));
      if (own(nom, rank)) return [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].every(([px, py]) => inRing(px, py, ring)) || (offCoast(b) && sea());
      // Another commune's name, on the whole of it (marketing): its middle and half of it or more on its commune, or at
      // sea off its coast. Measured on 9 points across by 3 up and down.
      return mostlyOn([x + d[0] - half + 2 * u, y + d[1] - fs * 0.6, x + d[0] + half - 2 * u, y + d[1] + fs * 0.6], ring, sea);
    };
    let d: [number, number] | undefined;
    if (isle) {
      const k = AROUND.find(([i, j]) => fits([(i * fs) / 2, (j * fs) / 2], i * i + j * j > NEAR));
      d = k && [(k[0] * fs) / 2, (k[1] * fs) / 2];
    }
    else if (!look) d = (rank < 2 ? [...NUDGE, ...FAR] : NUDGE).map(([a, b, c]) => [a * half + b * fs, c * fs] as [number, number]).find((d) => fits(d));
    else {
      const grid: [number, number][] = [];
      for (let gx = fx + half; gx <= fx + fw - half; gx += fs / 2) for (let gy = fy + fs; gy <= fy + fh - fs; gy += fs / 2) grid.push([gx - x, gy - y]);
      grid.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
      d = grid.find((d) => fits(d));
    }
    if (d) shown.push(boxAt(d));
    at.set(n, d);
    return d;
  };
  // The commune's own name, if nothing around its place is free: once the big names are placed, the free place inside
  // it or off its coast nearest that place.
  let late: (typeof list)[number] | undefined;
  for (const n of list) {
    if (late && n[1] > 1) {
      place(late, true);
      late = undefined;
    }
    if (opts.hide || (!opts.close && !SIX.has(n[0]))) continue;
    if (!place(n) && own(n[0], n[1])) late = n;
  }
  if (late) place(late, true);
  const texts = list.map((n) => {
    const [nom, rank, x, y] = n;
    const d = at.get(n);
    const fs = namePx(rank) * u;
    const wide = !opts.close && !SIX.has(nom);
    return `<text x="${r2(x + (d?.[0] ?? 0))}" y="${r2(y + (d?.[1] ?? 0))}" data-x="${x}" data-y="${y}" font-size="${r2(fs)}" data-r="${rank}"${wide ? ' data-w=""' : ""}${!rank && COMMUNES.has(nom) ? ` data-k="${COMMUNES.get(nom)}"` : ""}${own(nom, rank) ? ' data-c=""' : ""}${d ? "" : ' class="nx"'}>${esc(nom)}</text>`;
  });
  return texts.length ? `<g class="nm" aria-hidden="true"${opts.close ? "" : ' data-i=""'} stroke-width="${r2(3 * u)}">${texts.join("")}</g>` : "";
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Where a name may stand (marketing): on its place, then beside it on the right, on the left, above, below, then
 * aslant, then the same a little further, clear of a station on its place. Each `[a, b, c]`: across, `a` half its
 * width and `b` its size; up and down, `c` its size. The same in NOMS_SCRIPT.
 */
const NUDGE: [number, number, number][] = [
  [0, 0, 0], [1, 0.3, 0], [-1, -0.3, 0], [0, 0, -1.1], [0, 0, 1.1], [1, 0, -1.1], [-1, 0, -1.1], [1, 0, 1.1], [-1, 0, 1.1],
  [1, 1.3, 0], [-1, -1.3, 0], [0, 0, -2], [0, 0, 2],
];

/**
 * Where a commune or a big quarter (importance 0 or 1) may also stand: on the right, on the left, above, below, then
 * aslant, a quarter of its size further each time, up to 3 times its size from its place (the user: a quarter is an
 * area of several km). Further, it is not shown at that width. The same in NOMS_SCRIPT.
 */
const FAR = Array.from({ length: 12 }, (_, k) => (k + 1) / 4).flatMap((g) => {
  const c = 1.1 + g;
  return [[1, g, 0], [-1, -g, 0], [0, 0, -c], [0, 0, c], [1, g, -c], [-1, -g, -c], [1, g, c], [-1, -g, c]] as [number, number, number][];
});

/**
 * Where a commune's name may stand on the island's map (marketing), its middle half its size apart each time: the
 * nearest its town first, up to 6 times its size from it; beyond 3 times (NEAR, in half sizes squared), only facing its
 * town (facesOwn()). Further, it is not shown at that width. The same in NOMS_SCRIPT.
 */
export const AROUND = Array.from({ length: 25 * 25 }, (_, k) => [(k % 25) - 12, Math.floor(k / 25) - 12] as [number, number])
  .filter(([i, j]) => i * i + j * j <= 144)
  .sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
const NEAR = 36;

/** Kilometres per unit of the map, across and up and down alike. */
const KM = ((LON1 - LON0) * 111.32 * Math.cos((((LAT0 + LAT1) / 2) * Math.PI) / 180)) / W;

/**
 * Whether a place of importance 3 is far from all else, a landmark in an empty area (the user, the îlets of Mafate,
 * Grand Bassin): 3 km or more from any main or departmental road, or 1.5 km or more from any name of importance 0 to
 * 2 and 1 km or more from any road. Measured once per place.
 */
function isolated(x: number, y: number): boolean {
  const key = `${x} ${y}`;
  let v = ISOLATED.get(key);
  if (v === undefined) {
    const road = roadKm(x, y, 3 / KM);
    const name = Math.min(...(routes.noms as [string, number, number, number][]).filter((n) => n[1] <= 2).map((n) => Math.hypot(n[2] - x, n[3] - y))) * KM;
    v = road >= 3 || (name >= 1.5 && road >= 1);
    ISOLATED.set(key, v);
  }
  return v;
}
const ISOLATED = new Map<string, boolean>();

/** The distance in km from a point to the nearest road of routes.json, looked for up to `reach` units away. */
function roadKm(x: number, y: number, reach: number): number {
  let best = Infinity;
  for (const r of CLOSE) {
    if (r.b[0] > x + reach || r.b[2] < x - reach || r.b[1] > y + reach || r.b[3] < y - reach) continue;
    const n = r.d.match(/-?(?:\d+\.?\d*|\.\d+)/g)!.map(Number);
    let [ax, ay] = n;
    for (let i = 2; i + 1 < n.length; i += 2) {
      const [bx, by] = [ax + n[i], ay + n[i + 1]];
      const [dx, dy] = [bx - ax, by - ay];
      const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
      [ax, ay] = [bx, by];
    }
  }
  return best * KM;
}

/** The outlines of the communes, with their bounds: land is inside one of them. */
const LAND = island.paths.map((p) => ringOf(p.d)).map((ring) => {
  const [xs, ys] = [ring.map((q) => q[0]), ring.map((q) => q[1])];
  return { ring, b: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as Box };
});
/** Each commune's outline in LAND (and in the maps' `#isl`), by its name. */
const COMMUNES = new Map(island.paths.map((p, k) => [p.nom, k]));
const onLand = (x: number, y: number) => LAND.some((l) => x >= l.b[0] && x <= l.b[2] && y >= l.b[1] && y <= l.b[3] && inRing(x, y, l.ring));

/** Whether a box is all at sea: its corners and middle. */
const offCoast = (b: Box) =>
  ![[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]], [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]].some(([px, py]) => onLand(px, py));

/** Whether the first land on the way from `from` to `to` (a commune's place), in steps of `step`, is the commune's own. */
function towardsOwn(from: [number, number], to: [number, number], ring: [number, number][], step: number): boolean {
  const n = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step);
  for (let k = 1; k <= n; k++) {
    const [px, py] = [from[0] + ((to[0] - from[0]) * k) / n, from[1] + ((to[1] - from[1]) * k) / n];
    if (onLand(px, py)) return inRing(px, py, ring);
  }
  return false;
}

/**
 * Whether a name faces its commune's town (marketing): from its middle towards the town, the first land met, its middle's
 * own if on land, is the commune's.
 */
function facesOwn(from: [number, number], to: [number, number], ring: [number, number][], step: number): boolean {
  return onLand(from[0], from[1]) ? inRing(from[0], from[1], ring) : towardsOwn(from, to, ring, step);
}

/**
 * Whether a name's box is on its commune (marketing): of 9 points across by 3 up and down, its middle and 14 or more on
 * the commune, or at sea when `sea()` says it is off the commune's coast.
 */
function mostlyOn(b: Box, ring: [number, number][], sea: () => boolean): boolean {
  let atSea: boolean | undefined;
  let ok = 0, mid = false;
  for (let a = 0; a <= 8; a++)
    for (let j = 0; j <= 2; j++) {
      const [px, py] = [b[0] + ((b[2] - b[0]) * a) / 8, b[1] + (b[3] - b[1]) * (0.2 + 0.3 * j)];
      const v = inRing(px, py, ring) || (!onLand(px, py) && (atSea ??= sea()));
      if (v) ok++;
      if (a === 4 && j === 1) mid = v;
    }
  return mid && ok >= 14;
}

/**
 * The communes of the coast nearest a point at sea (marketing: a name at sea off its own coast, by the eye, not only on
 * the way to its town): those met first on circles around it, `step` wider each time, up to 12 steps.
 */
function coastNear(x: number, y: number, step: number): Set<number> {
  for (let r = 1; r <= 12; r++) {
    const near = new Set<number>();
    for (let a = 0; a < 16; a++) {
      const [px, py] = [x + r * step * Math.cos((a * Math.PI) / 8), y + r * step * Math.sin((a * Math.PI) / 8)];
      LAND.forEach((l, k) => px >= l.b[0] && px <= l.b[2] && py >= l.b[1] && py <= l.b[3] && inRing(px, py, l.ring) && near.add(k));
    }
    if (near.size) return near;
  }
  return new Set();
}

/** Where a commune's name stands on the maps: its chef-lieu (routes.json, rank 0). */
function chefLieu(commune: string): [number, number] | undefined {
  const n = (routes.noms as [string, number, number, number][]).find(([nom, rank]) => !rank && nom === commune);
  return n && [n[2], n[3]];
}

/** The points of a commune's outline (src/places/island.json: « M » then relative moves). */
function ringOf(d: string): [number, number][] {
  let x = 0, y = 0;
  return [...d.matchAll(/([Ml])(-?[\d.]+)[, ]?(-?[\d.]+)/g)].map(([, c, a, b]) => ([x, y] = c === "M" ? [+a, +b] : [x + +a, y + +b]) as [number, number]);
}

/** Whether a point is inside a ring (even-odd). */
function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** What a marker covers, its pill or its disc, at `at` (where apart() put it) or on its place. */
function markerBox(m: Marker, at?: [number, number]): Box {
  const [x, y] = at ?? project(m.lon, m.lat);
  const [hw, hh] = m.round ? [36, 36] : [pillW(m) / 2 + 2, PILL_H / 2 + 2];
  return [x - hw, y - hh, x + hw, y + hh];
}

/**
 * The page's script for the names of places (namesLayer()), on every map that has them: each name at its size on
 * screen, then shown only if it touches no point, label or name already shown, on its place or around it (NUDGE, and
 * FAR for a commune or a big quarter), a commune's name on it, its middle and 14 of 27 points of it, or at sea off its coast (`home`, the outlines
 * of `#isl` by `data-k`), the commune's own name (`data-c`) after the big ones if nothing around its place is free
 * (`look`), and on the island's map (`data-i`) a commune's name up to 6 times its size from its town, beyond 3 facing it (`face`), at sea only
 * where the nearest coast is the commune's (`town`, AROUND), as the server does for a phone. First the summits' names (`peaks`): below the summit, else above, on the right, on the
 * left, then aslant on either side, the first that touches no point (else the one that covers the least); the name
 * moves, never the station. What is hidden takes no room (the wind's pills under the temperatures, the summits'
 * names on a phone). Again when the map changes size, when the commune's map zooms (its viewBox) and when a tab
 * changes the points shown.
 */
export const NOMS_SCRIPT = `(()=>{const P=${JSON.stringify(NUDGE).replace(/</g, "\\u003c")},A=[...Array(625)].map((_,k)=>[k%25-12,Math.floor(k/25)-12]).filter(([i,j])=>i*i+j*j<=144).sort((a,b)=>a[0]*a[0]+a[1]*a[1]-(b[0]*b[0]+b[1]*b[1])),NEAR=${NEAR},F=[...Array(12)].flatMap((_,k)=>{const g=(k+1)/4,c=1.1+g;return[[1,g,0],[-1,-g,0],[0,0,-c],[0,0,c],[1,g,-c],[-1,-g,-c],[1,g,c],[-1,-g,c]]}),hit=(a,b)=>a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3];
const run=(svg)=>{const g=svg.querySelector(".nm"),vb=svg.viewBox.baseVal,cw=svg.clientWidth;if(!g||!vb||!vb.width||!cw)return;
const u=vb.width/cw,wide=cw>=640,p=2*u,busy=[],kept=[],box=(b,r)=>[b.x-r-p,b.y-r-p,b.x+b.width+r+p,b.y+b.height+r+p],
free=(b)=>b[0]>=vb.x&&b[1]>=vb.y&&b[2]<=vb.x+vb.width&&b[3]<=vb.y+vb.height&&![...busy,...kept].some((o)=>hit(o,b));const shown=(e)=>{for(;e&&e!==svg;e=e.parentNode)if(getComputedStyle(e).display==="none")return false;return true};
svg.querySelectorAll(".mk .sh,.mk .mn,.sp:not(.off) .rg,.pin,.ties circle,.trk-start,.rj-st circle,.wt line,.wt circle").forEach((e)=>{let b;if(!shown(e))return;try{b=e.getBBox()}catch{return}const r=e.matches(".rg")?9*u:0;if(b.width||b.height||r&&e.getClientRects().length)busy.push(box(b,r))});
const marks=[];svg.querySelectorAll(".pk").forEach((k)=>{const ts=[...k.querySelectorAll("text")],at=(d)=>ts.forEach((t)=>{if(t.dataset.x===undefined){t.dataset.x=t.getAttribute("x");t.dataset.y=t.getAttribute("y")}t.setAttribute("x",+t.dataset.x+d[0]);t.setAttribute("y",+t.dataset.y+d[1])});
let T;if(!shown(k))return;try{at([0,0]);T=k.querySelector("path").getBBox()}catch{return}if(!T.width)return;marks.push(box(T,0));let B=null;for(const t of ts){if(!shown(t))continue;const q=t.getBBox();if(q.width)B=B?[Math.min(B[0],q.x),Math.min(B[1],q.y),Math.max(B[2],q.x+q.width),Math.max(B[3],q.y+q.height)]:[q.x,q.y,q.x+q.width,q.y+q.height]}if(!B)return;
const s=4*u,cy=T.y+T.height/2-(B[1]+B[3])/2,hb=(B[3]-B[1])/2,R=T.x+T.width+s-B[0],L=T.x-s-B[2],at2=(d)=>[B[0]+d[0]-p,B[1]+d[1]-p,B[2]+d[0]+p,B[3]+d[1]+p],
ds=[[0,0],[0,T.y-s-B[3]],[R,cy],[L,cy],[R,cy-hb],[L,cy-hb],[R,cy+hb],[L,cy+hb]],over=(d)=>{const a=at2(d);return busy.reduce((n,o)=>n+Math.max(0,Math.min(a[2],o[2])-Math.max(a[0],o[0]))*Math.max(0,Math.min(a[3],o[3])-Math.max(a[1],o[1])),0)},
go=ds.find((d)=>free(at2(d)))||ds.reduce((m,d)=>(over(d)<over(m)?d:m));
at(go);marks.push(at2(go))});busy.push(...marks);
g.setAttribute("stroke-width",3*u);const isl=[...svg.querySelectorAll("#isl path")],pt=isl.length&&svg.createSVGPoint&&svg.createSVGPoint(),bx=isl.map((q)=>q.getBBox()),
isle=g.hasAttribute("data-i"),near=(x,y,st)=>{for(let r=1;r<=12;r++){const s=new Set();for(let a=0;a<16;a++){const l=land(x+r*st*Math.cos(a*Math.PI/8),y+r*st*Math.sin(a*Math.PI/8));if(l>=0)s.add(l)}if(s.size)return s}return new Set()},
on=(k,x,y)=>{const r=bx[k];if(r.width&&(x<r.x||y<r.y||x>r.x+r.width||y>r.y+r.height))return false;pt.x=x;pt.y=y;return isl[k].isPointInFill(pt)},land=(x,y)=>isl.findIndex((q,k)=>on(k,x,y)),
home=(b,t)=>{if(t.dataset.k===undefined||!pt)return true;const k=+t.dataset.k,c=[[b[0],b[1]],[b[2],b[1]],[b[0],b[3]],[b[2],b[3]]],mx=(b[0]+b[2])/2,my=(b[1]+b[3])/2;
const tx=+t.dataset.x,ty=+t.dataset.y,st=+t.getAttribute("font-size")/2,n=Math.ceil(Math.hypot(tx-mx,ty-my)/st),
sea=()=>{for(let i=1;i<=n;i++){const l=land(mx+(tx-mx)*i/n,my+(ty-my)*i/n);if(l>=0)return l===k&&(!isle||near(mx,my,st).has(k))}return false};
if(t.hasAttribute("data-c"))return c.every(([x,y])=>on(k,x,y))||!c.concat([[mx,my]]).some(([x,y])=>land(x,y)>=0)&&sea();
let s,ok=0,mid=false;const x0=b[0]+p,x1=b[2]-p,y0=b[1]+p,y1=b[3]-p;for(let a=0;a<=8;a++)for(let j=0;j<=2;j++){const x=x0+(x1-x0)*a/8,y=y0+(y1-y0)*(.2+.3*j),v=on(k,x,y)||land(x,y)<0&&(s===undefined?s=sea():s);if(v)ok++;if(a===4&&j===1)mid=v}
return mid&&ok>=14},
face=(b,t)=>{const mx=(b[0]+b[2])/2,my=(b[1]+b[3])/2,tx=+t.dataset.x,ty=+t.dataset.y,n=Math.ceil(Math.hypot(tx-mx,ty-my)/(+t.getAttribute("font-size")/2));for(let i=0;i<=n;i++){const l=land(mx+(tx-mx)*i/n,my+(ty-my)*i/n);if(l>=0)return l===+t.dataset.k}return false},
town=(t,fs)=>{const b0=box(t.getBBox(),0),tx=+t.dataset.x,ty=+t.dataset.y,cx=(b0[0]+b0[2])/2,cy=(b0[1]+b0[3])/2;
for(const [i,j] of A){const dx=tx+i*fs/2-cx,dy=ty+j*fs/2-cy,b=[b0[0]+dx,b0[1]+dy,b0[2]+dx,b0[3]+dy];if(free(b)&&home(b,t)&&(i*i+j*j<=NEAR||face(b,t))){t.setAttribute("x",tx+dx);t.setAttribute("y",ty+dy);kept.push(b);return true}}return false},
look=(t)=>{t.classList.remove("nx");t.setAttribute("x",t.dataset.x);t.setAttribute("y",t.dataset.y);const b0=box(t.getBBox(),0),st=+t.getAttribute("font-size")/2,ds=[];
for(let dx=vb.x-b0[0];b0[2]+dx<=vb.x+vb.width;dx+=st)for(let dy=vb.y-b0[1];b0[3]+dy<=vb.y+vb.height;dy+=st)ds.push([dx,dy]);ds.sort((a,b)=>a[0]*a[0]+a[1]*a[1]-b[0]*b[0]-b[1]*b[1]);
for(const [dx,dy] of ds){const b=[b0[0]+dx,b0[1]+dy,b0[2]+dx,b0[3]+dy];if(free(b)&&home(b,t)){t.setAttribute("x",+t.dataset.x+dx);t.setAttribute("y",+t.dataset.y+dy);kept.push(b);return}}t.classList.add("nx")};
let late=null;for(const t of g.children){if(late&&+t.dataset.r>1){look(late);late=null}const fs=(t.dataset.r==="0"?(wide?13:12):11)*u;t.setAttribute("font-size",fs);t.classList.remove("nx");
if(t.hasAttribute("data-w")&&!wide){t.classList.add("nx");continue}t.setAttribute("x",t.dataset.x);t.setAttribute("y",t.dataset.y);const h=t.getBBox().width/2+p;let ok=isle&&t.dataset.k!==undefined&&pt?town(t,fs):false;
if(!(isle&&t.dataset.k!==undefined&&pt))for(const [ka,kb,kc] of +t.dataset.r<2?[...P,...F]:P){t.setAttribute("x",+t.dataset.x+ka*h+kb*fs);t.setAttribute("y",+t.dataset.y+kc*fs);const b=box(t.getBBox(),0);if(free(b)&&home(b,t)){kept.push(b);ok=true;break}}
if(!ok){t.classList.add("nx");if(t.hasAttribute("data-c"))late=t}}if(late)look(late)};
const maps=[...document.querySelectorAll("svg.map")].filter((s)=>s.querySelector(".nm"));const wait=new Map(),later=(s)=>{clearTimeout(wait.get(s));wait.set(s,setTimeout(()=>run(s),120))};
maps.forEach((s)=>{run(s);if(window.ResizeObserver)new ResizeObserver(()=>later(s)).observe(s);new MutationObserver(()=>later(s)).observe(s,{attributes:true,attributeFilter:["viewBox"]})});
document.addEventListener("change",()=>maps.forEach(later))})();`;

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
  /** Drawn over the land, under the roads: the colours of a measure (the weather's canvases). */
  under?: string;
  /** Drawn over the land and the roads, under the markers: lines, points of a layer. */
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
  /**
   * The communes' names the page places itself (carte-communes.ts), in place of those placed here, each a link: the
   * communes' own links are then for the mouse only, so that a keyboard or a screen reader meets each commune once.
   */
  names?: string;
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
  const zones = opts.links ? zoneLinks(opts.links, !!opts.names) : "";
  // What the names of places must not touch (namesLayer()).
  const busy: Box[] = [];
  const draw = (list: Marker[]) => {
    const radii = hitRadii(list);
    const at = opts.apart ? apart(list) : undefined;
    list.forEach((m, i) => {
      busy.push(markerBox(m, at?.[i]));
      if (at && !m.round && !onPlace(m, at[i])) busy.push(markerBox({ ...m, round: true }));
    });
    return (at ? ties(list, at) : "") + list.map((m, i) => marker(m, radii[i], at?.[i])).join("");
  };
  const markers = draw(opts.markers ?? []) + (opts.layers ?? []).map((l) => `<g class="ly ly-${esc(l.id)}${l.on ? " on" : ""}">${draw(l.markers)}</g>`).join("");
  let extra = "";
  if (hl) extra += `<path class="hl" d="${hl.d}"/>`;
  if (opts.peaks) {
    for (const p of PEAKS) {
      const [x, y] = project(p.lon, p.lat);
      // The summit and its two lines (23 units high): names keep off them (NOMS_SCRIPT moves the lines off a point).
      const half = (p.name.length * EM * 23) / 2;
      busy.push([x - 16, y - 16, x + 16, y + 12], [x - half, y + 26, x + half, y + 78]);
      extra += `<g class="pk"><path d="M${x - 14} ${y + 10}L${x} ${y - 14}L${x + 14} ${y + 10}Z"/>` +
        `<text x="${x}" y="${y + 40}">${esc(p.name)}</text><text x="${x}" y="${y + 66}">${p.alt}</text></g>`;
    }
  }
  if (opts.pin) {
    const [x, y] = project(opts.pin.lon, opts.pin.lat);
    const half = (opts.pin.name.length * EM * 34) / 2;
    busy.push([x - 36, y - 36, x + 36, y + 36], [x - half, y - 84, x + half, y - 40]);
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
  // The names over the relief only: on the maps in colours (fills), the colours are the data.
  const names = opts.names ?? (terrain ? namesLayer({ frame: [0, 0, W, H], unit: W / PHONE_PX, busy, hide: !!opts.top }) : "");
  return `<svg class="map${terrain ? " terrain" : ""}" viewBox="0 0 ${W} ${H}" ${role} aria-label="${esc(opts.label)}">` +
    `<defs><g id="isl">${paths}</g>${terrain ? `<clipPath id="isl-clip">${paths}</clipPath>` : ""}</defs>` +
    `<rect class="sea" width="${W}" height="${H}" rx="28"/>` +
    `<use href="#isl" class="coast"/>${land}<use href="#isl" class="borders"/>` +
    (opts.under ?? "") + roadsLayer() + (opts.overlay ?? "") + zones + extra + names + markers + (opts.top ?? "") + `</svg>`;
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
  const frame = [x0, y0, w, h].map((v) => Math.round(v * 100) / 100);
  const box = frame.join(" ");
  const names = namesLayer({ frame, unit: w / PHONE_PX, busy: [[sx - r * 2, sy - r * 2, sx + r * 2, sy + r * 2]], close: true });
  return `<svg class="map terrain zoom" viewBox="${box}" data-fd="t" role="img" aria-label="${esc(opts.label)}">` +
    `<defs><g id="isl">${paths}</g><clipPath id="isl-clip">${paths}</clipPath></defs>` +
    `<rect class="sea" x="${x0 - w}" y="${y0 - h}" width="${w * 3}" height="${h * 3}"/>` +
    `<use href="#isl" class="coast"/><use href="#isl" class="land"/>` +
    `<image href="${RELIEF_PATH}" width="${W}" height="${H}" preserveAspectRatio="none" clip-path="url(#isl-clip)"/>` +
    `<g id="fd-t" class="fd"></g>` + roadsLayer(frame) + names +
    opts.lines.map((l) => `<path class="trk-halo" d="${d(l)}"/><path class="trk ${esc(l.etat)}" d="${d(l)}"/>`).join("") +
    `<circle class="trk-start" cx="${sx}" cy="${sy}" r="${Math.round(r * 100) / 100}"/></svg>` + fondChoice("t");
}

// ---------------------------------------------------------------- the IGN's backgrounds, on the zoomed maps

/** Where the IGN serves its tiles (Géoplateforme, WMTS, Licence Ouverte): the only other site the pages' images come from. */
export const IGN_TUILES = "https://data.geopf.fr";

/**
 * The backgrounds of a zoomed map, the relief by default. The IGN's are its tiles in Web Mercator, each laid by its own
 * corners on the map's plain longitude and latitude (less than a metre off within a tile), at the zoom level of the
 * screen's pixels, and fetched only once the visitor has picked one. The Plan has its own roads and names: ours are
 * hidden over it. Its credit joins the line « Carte : » (mapCredit()).
 */
export const FONDS = [
  { id: "relief", nom: "Relief" },
  { id: "plan", nom: "Plan IGN", credit: "Plan IGN", attente: "Chargement du plan…", layer: "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", format: "png", max: 18 },
  { id: "photo", nom: "Photo aérienne", credit: "Photo aérienne IGN", attente: "Chargement de la photo aérienne…", layer: "ORTHOIMAGERY.ORTHOPHOTOS", format: "jpeg", max: 19 },
];

/** The choice under a zoomed map: shown by its script only, which then draws the tiles in the map's `fd-<key>`. */
function fondChoice(key: string): string {
  // The loading message, laid by the script over the map's bottom left corner: it takes no room under the buttons and
  // moves nothing when it shows.
  return `<p class="fd-w" id="fd-w-${key}" role="status"></p><div class="tabs fonds" role="radiogroup" aria-label="Fond de la carte" data-fd="${key}" hidden>` +
    FONDS.map((f, i) => `<input type="radio" name="fd-${key}" id="fd-${key}-${f.id}" value="${f.id}"${i ? "" : " checked"}><label for="fd-${key}-${f.id}">${f.nom}</label>`).join("") +
    `</div><script>${FONDS_SCRIPT}</script>`;
}

// The characters that could end a <script> or a line of JavaScript inside a string written into one, each as \uXXXX.
const UNSAFE: Record<string, string> = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "/": "\\u002f", "\u2028": "\\u2028", "\u2029": "\\u2029" };
/** A value written as a JavaScript literal inside an inline <script>. */
const inScript = (v: unknown) => JSON.stringify(v).replace(/[<>&\/\u2028\u2029]/g, (c) => UNSAFE[c]);

// New tiles only once a pinch or a drag has stopped (250 ms): the Géoplateforme takes at most 40 requests a second
// from one address, and a view asks for 96 tiles at most, a level lower if the screen's would take more (a wide map on
// a dense screen). The tiles of the new view are laid over the old ones, which go once every tile the view wants has
// come (`sweep`, after each tile): those of the latest view only, so that a view's last tile, coming after the
// next view was asked, takes nothing of the next one away. A tile refused (the Géoplateforme's limit, a lost
// connection) is asked again 1.5 s, then 3 s later, the old tiles kept meanwhile; after a third refusal, the relief shows
// under its place until the map moves.
export const FONDS_SCRIPT = `(()=>{const T=${inScript(Object.fromEntries(FONDS.filter((f) => f.layer).map((f) => [f.id, { credit: f.credit, attente: f.attente, layer: f.layer, format: f.format, max: f.max }])))},A=${LON0},B=${LAT0},C=${LON1},D=${LAT1},W=${W},H=${H},NS="http://www.w3.org/2000/svg";
const X=(o)=>(o-A)/(C-A)*W,Y=(a)=>(D-a)/(D-B)*H,lon=(x)=>A+x/W*(C-A),lat=(y)=>D-y/H*(D-B),n=(z)=>2**z,
tlon=(t,z)=>t/n(z)*360-180,tlat=(t,z)=>Math.atan(Math.sinh(Math.PI*(1-2*t/n(z))))*180/Math.PI,
tx=(o,z)=>Math.floor((o+180)/360*n(z)),ty=(a,z)=>{const r=a*Math.PI/180;return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n(z))},r3=(v)=>String(Math.round(v*1000)/1000);
document.querySelectorAll(".fonds[data-fd]:not([data-on])").forEach((f)=>{const k=f.dataset.fd,svg=document.querySelector('svg[data-fd="'+k+'"]'),g=document.getElementById("fd-"+k),msg=document.getElementById("fd-w-"+k);if(!svg||!g)return;f.dataset.on="1";
let cur=null,timer=0,slow=0,pend=0,epoch=0,want=new Set();const have=new Map(),tries=new Map(),again=new Set(),quiet=()=>{clearTimeout(slow);slow=0;if(msg)msg.textContent=""},
sweep=()=>{for(const key of want){const im=have.get(key);if(im?!im.dataset.ok:again.has(key))return}have.forEach((im,key)=>{if(!want.has(key)){im.remove();have.delete(key)}})},
place=()=>{const p=msg&&msg.offsetParent;if(!p)return;const a=p.getBoundingClientRect(),b=svg.getBoundingClientRect();msg.style.left=b.left-a.left-p.clientLeft+8+"px";msg.style.top=b.bottom-a.top-p.clientTop-msg.offsetHeight-8+"px"};
const draw=()=>{if(!cur)return;const v=svg.viewBox.baseVal,px=svg.getBoundingClientRect().width||340,dpp=v.width/W*(C-A)/px;
let z=Math.max(9,Math.min(cur.max,Math.round(Math.log2(360*Math.min(devicePixelRatio||1,2)/(256*dpp))))),x0,x1,y0,y1;
for(;;z--){x0=tx(lon(v.x),z);x1=tx(lon(v.x+v.width),z);y0=ty(lat(v.y),z);y1=ty(lat(v.y+v.height),z);if(z<=9||(x1-x0+1)*(y1-y0+1)<=96)break}
want=new Set();
for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=cur.layer+"/"+z+"/"+x+"/"+y;want.add(key);if(have.has(key)||again.has(key)||tries.get(key)>2)continue;
const im=document.createElementNS(NS,"image"),l=X(tlon(x,z)),t=Y(tlat(y,z)),w=X(tlon(x+1,z))-l,h=Y(tlat(y+1,z))-t;
im.setAttribute("x",r3(l));im.setAttribute("y",r3(t));im.setAttribute("width",r3(w*1.004));im.setAttribute("height",r3(h*1.004));im.setAttribute("preserveAspectRatio","none");
pend++;const ep=epoch,fin=()=>{if(ep===epoch&&--pend===0)quiet()};
if(!slow&&!(msg&&msg.textContent)){const say=cur.attente;slow=setTimeout(()=>{if(msg){msg.textContent=say;place()}},1000)}
im.addEventListener("load",()=>{im.dataset.ok="1";fin();sweep()},{once:true});im.addEventListener("error",()=>{im.remove();have.delete(key);fin();const t=(tries.get(key)||0)+1;tries.set(key,t);
if(t<3){again.add(key);setTimeout(()=>{again.delete(key);if(want.has(key))draw();else sweep()},1500*t)}sweep()},{once:true});
im.setAttribute("href","${IGN_TUILES}/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER="+cur.layer+"&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX="+z+"&TILEROW="+y+"&TILECOL="+x+"&FORMAT=image/"+cur.format);
g.appendChild(im);have.set(key,im)}sweep()};
const later=()=>{clearTimeout(timer);timer=setTimeout(()=>{tries.clear();place();draw()},250)};
f.addEventListener("change",(e)=>{const id=e.target.value;cur=T[id]||null;epoch++;pend=0;quiet();have.forEach((im)=>im.remove());have.clear();again.clear();svg.classList.remove("fd-plan","fd-photo");if(cur)svg.classList.add("fd-"+id);
document.querySelectorAll(".fd-c").forEach((s)=>{s.textContent=cur?", "+cur.credit:""});draw()});
new MutationObserver(later).observe(svg,{attributes:true,attributeFilter:["viewBox"]});addEventListener("resize",later);f.hidden=false})})();`;

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
  /** What it is, said aloud. */
  name: string;
  /** What the bubble on hover and the list of close points say of it (carte-points.ts): its name, kind and address. */
  tip?: { name: string; kind?: string; address?: string };
}

/** The width the map is drawn at on a phone of 390 px, in its card: what a finger's 44 px are worth in the map's units. */
const PHONE_PX = 340;

/**
 * A commune close up (the children's page of a commune): the relief and the coast as on the island's map, the other
 * communes dimmed, its outline marked, and a dot per spot. The dots keep their size on screen when the page's script
 * zooms (a stroke that does not scale); each is a link to its row, its hit area as wide as a finger on a phone and no
 * wider than half the way to the next one. The frame is the commune's and its spots', 1:1 to 4:3, in `data-box`.
 * `controls` (the zoom's buttons) go between the map and the choice of its base, the order of every zoomed map.
 */
export function communeMap(opts: { commune: string; spots: Spot[]; label: string; id?: string; controls?: string }): string {
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
    return `<a class="sp" href="#lieu-${s.i}" data-i="${s.i}" data-t="${esc(s.t)}"${pointData(s.tip ? [s.tip.name, s.tip.kind, s.tip.address] : [s.name])}><title>${esc(s.name)}</title>` +
      `<circle class="hit" cx="${x}" cy="${y}" r="${r2(radii[k])}"/><path class="rg" d="M${x} ${y}h0"/><path class="pt f-${esc(s.f)}" d="M${x} ${y}h0"/></a>`;
  }).join("");
  const fd = esc(opts.id ?? "c");
  return `<svg${opts.id ? ` id="${opts.id}"` : ""} class="map terrain zoom commune" viewBox="${box.join(" ")}" data-box="${box.join(" ")}" data-fd="${fd}" role="group" aria-label="${esc(opts.label)}">` +
    `<defs><g id="isl">${paths}</g><clipPath id="isl-clip">${paths}</clipPath><clipPath id="com-clip"><path d="${shape.d}"/></clipPath></defs>` +
    `<rect class="sea" x="${r2(box[0] - w)}" y="${r2(box[1] - h)}" width="${r2(w * 3)}" height="${r2(h * 3)}"/>` +
    `<use href="#isl" class="coast"/><use href="#isl" class="land"/>` +
    `<image href="${RELIEF_PATH}" width="${W}" height="${H}" preserveAspectRatio="none" clip-path="url(#isl-clip)"/>` +
    // The island dimmed, then the commune's relief again over it, clear; the IGN's tiles likewise, once chosen.
    `<g id="fd-${fd}" class="fd"></g>` +
    `<use href="#isl" class="dim"/><image href="${RELIEF_PATH}" width="${W}" height="${H}" preserveAspectRatio="none" clip-path="url(#com-clip)"/>` +
    `<use href="#fd-${fd}" clip-path="url(#com-clip)"/>` +
    roadsLayer(box) + `<path class="hl" d="${shape.d}"/>` +
    namesLayer({ frame: box, unit, busy: at.map(([x, y]) => [x - 10 * unit, y - 10 * unit, x + 10 * unit, y + 10 * unit]), close: true, within: ringOf(shape.d), centre: chefLieu(opts.commune), commune: opts.commune }) +
    `<g class="spots">${dots}</g></svg>` + (opts.controls ?? "") + fondChoice(fd);
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
