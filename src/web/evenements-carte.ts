/**
 * The map of /evenements: the events of tonight, tomorrow or the weekend over the island, one genre or all, chosen by
 * radio buttons and CSS, without a script.
 * - A round per commune, at its centre, with the number of its events: where the source gives only the commune, never
 *   drawn as if at an address.
 * - A small point only where the source gives the venue's position (the « Y aller » of the list), leading to the event,
 *   or to the list when several share the venue.
 * Each pair of a time and a genre is a layer of islandMap (`ly-<time>-<genre>`), or a line saying nothing was found:
 * the page's own CSS shows the one of the buttons checked. Nothing read: the agenda's copy, already there.
 * A map that filters (marketing's charter of the maps, 31/10/2026): in the content, the width of the page.
 */
import { resolvePlace } from "../places/resolve.js";
import { occurrences, type EventRow } from "../tools/agenda.js";
import { COUNT_COLOR, legende } from "./carte-legende.js";
import { esc, fenetre, islandMap, type Marker, project } from "./map.js";

type Row = Pick<EventRow, "titre" | "date" | "quand" | "autres_dates" | "commune" | "lieu" | "lien" | "genres" | "position" | "source">;

const localDay = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
const addDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
const count = (n: number) => `${n} événement${n > 1 ? "s" : ""}`;

/** Tonight: on today from 17:00, or still going at 18:00, or with no hour given; a run of days only from its first evening. */
function tonight(r: Row, today: string): boolean {
  const os = occurrences(r);
  if (!os.length) return r.date.slice(0, 10) === today && (r.date.length === 10 || r.date.slice(11, 16) >= "17:00");
  return os.some((o) => o.du <= today && today <= o.au &&
    (o.du === o.au ? !o.debut || o.debut >= "17:00" || (o.fin ?? "") >= "18:00" : o.du === today && !!o.debut && o.debut >= "17:00"));
}

/** On that day, at any hour. */
function onDay(r: Row, day: string): boolean {
  const os = occurrences(r);
  return os.length ? os.some((o) => o.du <= day && day <= o.au) : r.date.slice(0, 10) === day;
}

/** A commune's round: its events counted, at the commune's centre, never at an address. */
export interface Rond { commune: string; lon: number; lat: number; nombre: number }
/** A venue its source places: its events counted; the title, link and source of the event when it is alone. */
export interface Point { lieu: string; lon: number; lat: number; nombre: number; titre: string; lien?: string; source?: string }
/** The layer of a list of events, as data: what /evenements draws, and any other map can (a page of layers). */
export interface Couche { ronds: Rond[]; points: Point[] }

/** The rounds of the communes, then the points of the venues the sources place. */
export function couche(rows: Row[]): Couche {
  const byCommune = new Map<string, number>();
  for (const r of rows) if (r.commune) byCommune.set(r.commune, (byCommune.get(r.commune) ?? 0) + 1);
  const ronds = [...byCommune].flatMap(([commune, nombre]): Rond[] => {
    const at = resolvePlace(commune)?.lieu;
    return at ? [{ commune, lon: at.lon, lat: at.lat, nombre }] : [];
  });
  const venues = new Map<string, Row[]>();
  for (const r of rows) if (r.position) venues.set(`${r.position.lat},${r.position.lon}`, [...(venues.get(`${r.position.lat},${r.position.lon}`) ?? []), r]);
  const points = [...venues.values()].map(([r, ...more]): Point => ({
    lieu: r.lieu?.split(", ")[0] || r.commune || r.titre, lon: r.position!.lon, lat: r.position!.lat, nombre: more.length + 1, titre: r.titre,
    ...(!more.length && { lien: r.lien, source: r.source }),
  }));
  return { ronds, points };
}

/** The rounds as islandMap's markers, each leading to `href`. */
export const rondsMarkers = (ronds: Rond[], href: string): Marker[] =>
  ronds.map((r) => ({ lon: r.lon, lat: r.lat, label: String(r.nombre), round: true, quiet: true, color: COUNT_COLOR, place: r.commune, say: count(r.nombre), name: `${r.commune} : ${count(r.nombre)}`, href }));

// A round's radius (map.ts, marker()) and a point's, with room for their white edges: a point never on a round's figure.
const ROUND_R = 34;
const POINT_R = 17;
const CLEAR = ROUND_R + POINT_R + 6;

/**
 * Where a point is drawn: on its place, or, when that is under a round, beside the round, on the side of its place,
 * else the nearest side free of every round. Its bubble still says its own place.
 */
export function beside([x, y]: [number, number], rounds: [number, number][]): [number, number] {
  const free = (px: number, py: number) => rounds.every(([rx, ry]) => Math.hypot(px - rx, py - ry) >= CLEAR);
  if (free(x, y)) return [x, y];
  const [rx, ry] = rounds.reduce((a, b) => (Math.hypot(x - b[0], y - b[1]) < Math.hypot(x - a[0], y - a[1]) ? b : a));
  const from = x === rx && y === ry ? 0 : Math.atan2(y - ry, x - rx);
  for (let k = 0; k < 12; k++) {
    const a = from + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
    // A unit further, so that rounding to whole units keeps it clear.
    const [px, py] = [Math.round(rx + (CLEAR + 1) * Math.cos(a)), Math.round(ry + (CLEAR + 1) * Math.sin(a))];
    if (free(px, py)) return [px, py];
  }
  return [x, y];
}

/**
 * The points as SVG, under the rounds (islandMap's `overlay`): a small point, the venue's name, and the event with its
 * source as in the list, leading to it; several events at one venue lead to `href`. `rounds`: where the rounds are,
 * which a point keeps off (beside()).
 */
export function pointsSvg(points: Point[], href: string, rounds: [number, number][] = []): string {
  return points.map((p) => {
    const [x, y] = beside(project(p.lon, p.lat), rounds);
    const what = p.nombre > 1 ? count(p.nombre) : p.titre;
    const to = p.nombre === 1 && p.lien ? p.lien : href;
    // An event's own link leads to its announcement, on the publisher's site; several events, to the list.
    const out = to.startsWith("http");
    return `<a class="mk evp" href="${esc(to)}"${out ? ` rel="noopener"${fenetre(to)}` : ""} aria-label="${esc(`${p.lieu} : ${what}, ${out ? "voir l'annonce" : "voir le détail"}`)}"${out ? ` data-pv="annonce"` : ""} data-pn="${esc(p.lieu)}" data-p2="${esc(what)}"${p.source ? ` data-p3="${esc(`Source\u00a0: ${p.source}`)}"` : ""}>` +
      `<circle class="hit" cx="${x}" cy="${y}" r="30" style="fill:transparent;stroke:none"/><title>${esc(`${p.lieu} : ${what}`)}</title><circle class="sh" cx="${x}" cy="${y}" r="${POINT_R}"/></a>`;
  }).join("");
}

// A venue, a place without a value: a small point edged in white, in its category's colour (the charter's « point de
// lieu », Okabe-Ito's sky blue), apart from the rounds' count and from the yellow that marks what a page is about.
const POINT = "#56b4e9";
// Under the text on a phone: its drawing waits until it nears the screen (content-visibility), the first paint does not
// (slow 4G at 390 px: +118 ms instead of +217 ms).
const STYLE = ".evmap{content-visibility:auto;contain-intrinsic-size:auto 560px}.evmap .tabs{margin-bottom:.45rem}.evmap .tabs label{white-space:nowrap;font-size:.82rem;padding:.22rem .62rem}" +
  `.evmap .evp .sh{fill:${POINT};stroke:#fff;stroke-width:5;paint-order:stroke}.evmap .ev0{margin:.4rem 0 0}`;

const TIMES = [["soir", "Ce soir", "ce soir"], ["demain", "Demain", "demain"], ["we", "Ce week-end", "ce week-end"]] as const;

/**
 * The map's figure, or nothing without an event in any of the three. `weekend`: the agenda's own weekend
 * (tools/agenda.ts, `ce_week_end`), the same as /evenements/ce-week-end's. `ligne`: the legend's line of nature,
 * source and time (HTML).
 */
export function eventsMap(rows: Row[], weekend: Row[], genres: [string, string][], now: Date, ligne: string): string {
  const today = localDay(now);
  const tomorrow = addDay(today);
  const of: Record<(typeof TIMES)[number][0], Row[]> = { soir: rows.filter((r) => tonight(r, today)), demain: rows.filter((r) => onDay(r, tomorrow)), we: weekend };
  if (!TIMES.some(([t]) => of[t].length)) return "";
  const on = TIMES.find(([t]) => of[t].length)![0];
  // The genres of the three, in the list's order; « tous » first.
  const present = new Set(TIMES.flatMap(([t]) => of[t].flatMap((r) => r.genres)));
  const kinds: [string, string][] = [["", "Tous"], ...genres.filter(([g]) => present.has(g))];

  const layers: { id: string; markers: Marker[] }[] = [];
  let under = "";
  let empty = "";
  const shown: string[] = [];
  for (const [t, , said] of TIMES) {
    kinds.forEach(([g, nom], i) => {
      const id = `${t}-${i}`;
      shown.push(id);
      const list = g ? of[t].filter((r) => r.genres.includes(g)) : of[t];
      if (!list.length) {
        empty += `<p class="note ev0 ly ly-${id}">${esc(`Rien de trouvé ${said}${g ? ` en « ${nom.toLowerCase()} »` : ""} dans les agendas lus.`)}</p>`;
        return;
      }
      const { ronds, points } = couche(list);
      layers.push({ id, markers: rondsMarkers(ronds, "#jours") });
      if (points.length) under += `<g class="ly ly-${id}">${pointsSvg(points, "#jours", ronds.map((r) => project(r.lon, r.lat)))}</g>`;
    });
  }

  const radios = (name: string, items: [string, string][], checked: string) =>
    items.map(([v, label]) => `<input type="radio" name="${name}" id="${name}-${v}"${v === checked ? " checked" : ""}><label for="${name}-${v}">${esc(label)}</label>`).join("");
  const times = `<div class="tabs evt" role="radiogroup" aria-label="Quand">${radios("evt", TIMES.map(([t, l]) => [t, l]), on)}</div>`;
  // Always there, its « Tous » checked, which the rules below read; out of sight with a single genre or none.
  const genre = `<div class="tabs evg" role="radiogroup" aria-label="Genre"${kinds.length > 2 ? "" : ' style="display:none"'}>${radios("evg", kinds.map(([, l], i) => [String(i), l]), "0")}</div>`;
  // One rule per pair: the layer, or its line, of the time and the genre checked. Without :has, the first pair.
  const css = `${STYLE}.evmap .ly{display:none}.evmap .ly-${on}-0{display:inline}.evmap p.ly-${on}-0{display:block}` +
    `.evmap:has(.tabs input:checked:not([id$="-${on}"],#evg-0)) .ly-${on}-0{display:none}` +
    shown.map((id) => { const [t, i] = id.split("-"); return `.evmap:has(#evt-${t}:checked):has(#evg-${i}:checked) .ly-${id}{display:${empty.includes(`ly-${id}"`) ? "block" : "inline"}}`; }).join("");
  const label = "Carte de La Réunion (974) : les événements de ce soir, de demain ou du week-end, par commune";
  return `<figure class="card mapcard evmap"><style>${css}</style>${times}${genre}` +
    islandMap({ layers, overlay: under, label }) + empty +
    `<figcaption class="note">${legende([
      { forme: "rond", couleur: COUNT_COLOR, texte: "3", dit: "événements de la commune" },
      { forme: "point", couleur: POINT, dit: "lieu de l'événement, d'après l'annonce" },
    ], ligne)}</figcaption></figure>`;
}
