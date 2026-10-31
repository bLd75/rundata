/**
 * Bus journeys from one place to another (/bus/itineraire): the direct trips and those with one change, on the
 * timetables of every network (D1), with a short walk from one stop to another to change bus. Three reads of the
 * database a search, whatever it finds: the patterns passing at both ends, then their trips and their stops in order.
 * Timetables only: what the networks plan, not where their buses are.
 */
import { distanceKm } from "../geo.js";
import { resolvePlace } from "../places/resolve.js";
import * as transit from "../providers/transit.js";
import { findStops, parseQuery, type Departure, tripPath } from "./transports.js";

/** The longest walk to change bus, as the crow flies, and the detour a street adds to it. */
export const WALK_MAX_M = 400;
const DETOUR = 1.3;
/** 4.5 km/h. */
const WALK_M_PER_MIN = 75;
/** Time kept to change bus, on top of the walk: buses run late more often than early. */
export const CHANGE_S = 120;
/** At most this many stops at each end: a commune's main stops, not its hundreds. */
export const ZONE_MAX = 80;
/** A commune's stops this close to its centre, besides its busiest. */
const ZONE_KM = 1.5;
/** At most this many rows read for a search: past it, the page asks for a more precise start or end. */
export const ROWS_MAX = 2000;
/** How long a journey may take, at most. */
const WINDOW_S = 5 * 3600;
/** A service day, as the networks count it, runs from 03:00 to 03:00 the next morning. */
export const DAY_START_S = 3 * 3600;
/** Hours looked through first. */
const NEAR_S = 3 * 3600;
export const SHOWN = 5;

/** One end of a journey, as understood. */
export interface End {
  /** « Église Petite-Île », « Petite-Île », « Plage de l'Hermitage ». */
  nom: string;
  /** A stop named, a commune's main stops, or the stops near a place. */
  sorte: "arret" | "commune" | "lieu";
  commune?: string;
  /** Each stop (island-wide index) with the walk to it from the place asked, in seconds: none for a stop or a commune. */
  stops: Map<number, number>;
}

const walkSeconds = (m: number) => Math.round(((m * DETOUR) / WALK_M_PER_MIN) * 60);

/** A commune's main stops: its busiest (those with a page for search engines) and those near its centre. */
function communeStops(commune: string): Map<number, number> {
  const centre = resolvePlace(commune)?.lieu;
  const groups = transit.GROUPS.filter((g) => g.commune === commune)
    .map((g) => ({ g, km: centre ? distanceKm(centre.lon, centre.lat, g.lon, g.lat) : 0, busy: transit.pageOfStop(g.ids[0])?.indexe ?? false }))
    .filter((x) => x.busy || x.km <= ZONE_KM)
    .sort((a, b) => Number(b.busy) - Number(a.busy) || a.km - b.km);
  const out = new Map<number, number>();
  for (const { g } of groups) for (const id of g.ids) if (out.size < ZONE_MAX) out.set(id, 0);
  return out;
}

/** The stops within 600 m of a place, else the 3 nearest within 2 km, with the walk to each. */
function placeStops(lon: number, lat: number): Map<number, number> {
  const all = transit.GROUPS.map((g) => ({ g, m: distanceKm(lon, lat, g.lon, g.lat) * 1000 })).filter((x) => x.m <= 2000).sort((a, b) => a.m - b.m);
  const close = all.filter((x) => x.m <= 600);
  const out = new Map<number, number>();
  for (const { g } of (close.length ? close : all.slice(0, 3)).slice(0, ZONE_MAX)) for (const id of g.ids) out.set(id, walkSeconds(distanceKm(lon, lat, transit.stop(id).lon, transit.stop(id).lat) * 1000));
  return out;
}

/** What a start or an end says: a stop by its name, a commune alone, or a place (« aéroport », « plage de Boucan »). */
export function endOf(asked: string): End | undefined {
  const { reseau, commune, words } = parseQuery(asked);
  if (!words.length && commune && !reseau) return { nom: commune, sorte: "commune", commune, stops: communeStops(commune) };
  const { groups, near } = findStops(asked);
  // A stop matching only some words (« Plage » for « plage de l'Hermitage »): the place, when it is known.
  const all = (g: transit.StopGroup) => words.every((w) => g.words.has(w) || (w.length >= 4 && [...g.words].some((x) => x.startsWith(w))));
  const place = groups.length && !near.length && !all(groups[0]) ? resolvePlace(asked)?.lieu : undefined;
  if (groups.length && !near.length && !place) {
    const stops = new Map(groups.flatMap((g) => g.ids.map((id) => [id, 0] as const)).slice(0, ZONE_MAX));
    return { nom: groups[0].nom, sorte: "arret", commune: groups[0].commune, stops };
  }
  const lieu = place ?? resolvePlace(asked)?.lieu;
  if (!lieu) return undefined;
  const stops = placeStops(lieu.lon, lieu.lat);
  return stops.size ? { nom: lieu.nom, sorte: "lieu", commune: lieu.commune || undefined, stops } : undefined;
}

/** A ride on one bus. Times in seconds after midnight of the day asked (past 86 400 the next day, below 0 the day before). */
export interface Leg {
  reseau: string;
  ligne: string;
  direction: string;
  depart: number;
  arrivee: number;
  /** Stops (island-wide index). */
  de: number;
  a: number;
  /** The page of its trip (web/trajet.ts). */
  trajet?: string;
}

export interface Journey {
  /** One leg, or two with a change. */
  legs: Leg[];
  /** The walk to the first stop, to change, and from the last stop, in seconds. */
  marche_depart: number;
  marche_changement?: number;
  marche_arrivee: number;
  /** Leaving the place asked, and reaching the other: the walks included. */
  depart: number;
  arrivee: number;
}

export interface Search {
  trajets: Journey[];
  /** Reads of the database and rows they gave: what a search costs. */
  lectures: { requetes: number; lignes: number };
  /** Too many stops or lines at the ends to look through: the page asks for a more precise start or end. */
  trop_large?: boolean;
  /** The hours looked through, in seconds after midnight of the day asked. */
  fenetre: { de: number; a: number };
}

type Day = { ymd: number; weekday: number; shift: number };
/** The day asked, and the day before for the buses after midnight: a trip of the day before starting at 24:30 runs at 00:30. */
const daysOf = (ymd: number): Day[] => {
  const d = new Date(Date.UTC(Math.floor(ymd / 10000), (Math.floor(ymd / 100) % 100) - 1, ymd % 100));
  const before = new Date(d.getTime() - 86_400_000);
  const asYmd = (x: Date) => Number(x.toISOString().slice(0, 10).replace(/-/g, ""));
  return [
    { ymd, weekday: (d.getUTCDay() + 6) % 7, shift: 0 },
    { ymd: asYmd(before), weekday: (before.getUTCDay() + 6) % 7, shift: 86400 },
  ];
};

/** The network of a pattern. */
const netOf = (pattern: number) => transit.ROUTES[transit.ENDS[pattern]?.[0]]?.[0];

/** Stops close enough to walk between them to change bus, found through a grid of about 500 m. */
let grid: Map<string, number[]> | undefined;
const near = new Map<number, [number, number][]>();
const CELL = 0.005;
const cellOf = (lon: number, lat: number) => `${Math.floor(lon / CELL)}|${Math.floor(lat / CELL)}`;
function walkable(id: number): [number, number][] {
  const known = near.get(id);
  if (known) return known;
  if (!grid) {
    grid = new Map();
    for (const g of transit.GROUPS) for (const s of g.ids) {
      const { lon, lat } = transit.stop(s);
      const k = cellOf(lon, lat);
      grid.set(k, [...(grid.get(k) ?? []), s]);
    }
  }
  const { lon, lat } = transit.stop(id);
  const [x, y] = [Math.floor(lon / CELL), Math.floor(lat / CELL)];
  const out: [number, number][] = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of grid.get(`${x + i}|${y + j}`) ?? []) {
    const o = transit.stop(s);
    const m = distanceKm(lon, lat, o.lon, o.lat) * 1000;
    if (m <= WALK_MAX_M) out.push([s, s === id ? 0 : walkSeconds(m)]);
  }
  near.set(id, out);
  return out;
}

/** A pattern's trips running on the day asked or after midnight of the day before, as [time of its start, trip, service day], by time. */
function runs(p: transit.Pattern, days: Day[]): [number, string, number][] {
  const net = netOf(p.id);
  const out: [number, string, number][] = [];
  for (const [service, start, trip] of p.trips) for (const d of days) if (transit.serviceRuns(net, service, d.ymd, d.weekday)) out.push([start - d.shift, trip, d.ymd]);
  return out.sort((a, b) => a[0] - b[0]);
}

/** The first of these runs leaving at `offset` after its start no earlier than `t`, by bisection. */
function firstFrom(list: [number, string, number][], offset: number, t: number): [number, string, number] | undefined {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][0] + offset < t) lo = mid + 1;
    else hi = mid;
  }
  return list[lo];
}

const legOf = (pattern: transit.Pattern, run: [number, string, number], de: number, a: number, offDe: number, offA: number): Leg => {
  const [net, short] = transit.ROUTES[pattern.route];
  const trajet = tripPath({ reseau: net, pattern: pattern.id, trip: run[1], jour: run[2], stop: de } as Departure);
  return { reseau: transit.NETWORKS[net]?.nom ?? net, ligne: short, direction: pattern.headsign.replace(/\s+quai\s+\S+$/i, ""), depart: run[0] + offDe, arrivee: run[0] + offA, de, a, ...(trajet ? { trajet } : {}) };
};

/**
 * The journeys from `from` to `to` on day `ymd` (YYYYMMDD), leaving after `time` (seconds after midnight) or, with
 * `arriveBy`, arriving before it: direct, or with one change and a walk of at most 400 m between the two stops. Of
 * those, the ones no other beats (leaving later and arriving sooner, or as soon with fewer changes), the first 5.
 */
export async function journeys(from: End, to: End, ymd: number, time: number, arriveBy = false): Promise<Search> {
  const days = daysOf(ymd);
  // The patterns passing at each end, all day: one row of the database a stop. A bus at its terminus leaves from
  // nowhere, so the passes do not have it: those ending at the end are found by their last stop.
  const all = await transit.passes([...new Set([...from.stops.keys(), ...to.stops.keys()])]);
  const read = { requetes: 1, lignes: new Set(all.map((p) => p.stop)).size };
  // The 3 hours after the time asked (before it, to arrive), then the rest of the day, from 03:00 to 03:00 the next
  // morning, when they have nothing: « no more bus that day » is then said of the whole day.
  const whole: [number, number] = arriveBy ? [DAY_START_S, time] : [time, DAY_START_S + 86400];
  const near: [number, number] = arriveBy ? [Math.max(whole[0], time - NEAR_S), time] : [time, Math.min(whole[1], time + NEAR_S)];
  const first = await within(from, to, days, all, near, arriveBy, read);
  if (first.trajets.length || first.trop_large || (near[0] === whole[0] && near[1] === whole[1])) return first;
  const day = await within(from, to, days, all, whole, arriveBy, read);
  return day.trop_large ? { ...first, lectures: day.lectures } : day;
}

/** The journeys between `lo` and `hi` (seconds after midnight of the day asked), with the passes already read. */
async function within(from: End, to: End, days: Day[], all: Awaited<ReturnType<typeof transit.passes>>, [lo, hi]: [number, number], arriveBy: boolean, read: { requetes: number; lignes: number }): Promise<Search> {
  const mayPass = (pattern: number, offset: number, a: number, b: number) => {
    const net = netOf(pattern);
    return net !== undefined && days.some((d) => transit.mayRun(pattern, offset, net, d.ymd, d.weekday, a + d.shift, b + d.shift));
  };
  // Leaving in the hours looked through, or arriving in them: a journey takes at most WINDOW_S.
  const [leaveLo, leaveHi] = arriveBy ? [lo - WINDOW_S, hi] : [lo, hi];
  const [reachLo, reachHi] = arriveBy ? [lo, hi] : [lo, hi + WINDOW_S];
  // A bus passing at several stops of the start is taken at the last of them, the walk counted: the same bus, left later.
  const latest = new Map<number, (typeof all)[number]>();
  for (const p of all) {
    if (!from.stops.has(p.stop) || !mayPass(p.pattern, p.offset, leaveLo, leaveHi)) continue;
    const kept = latest.get(p.pattern);
    if (!kept || p.offset - from.stops.get(p.stop)! > kept.offset - from.stops.get(kept.stop)!) latest.set(p.pattern, p);
  }
  const starts = [...latest.values()];
  const endIds = new Set(all.filter((p) => to.stops.has(p.stop) && mayPass(p.pattern, p.offset, reachLo, reachHi)).map((p) => p.pattern));
  transit.ENDS.forEach(([, , last], pattern) => {
    if (to.stops.has(last) && mayPass(pattern, 0, reachLo - WINDOW_S, reachHi)) endIds.add(pattern);
  });
  const ids = [...new Set([...starts.map((p) => p.pattern), ...endIds])];
  const window = { de: lo, a: hi };
  if (read.lignes + 2 * ids.length > ROWS_MAX) return { trajets: [], lectures: { ...read }, fenetre: window, trop_large: true };
  if (!starts.length || !endIds.size) return { trajets: [], lectures: { ...read }, fenetre: window };
  const [pats, order] = await Promise.all([transit.patterns(ids), transit.patternStops(ids)]);
  read.requetes += 2;
  read.lignes += pats.size + (order?.size ?? 0);
  const timetable = new Map([...pats].map(([id, p]) => [id, runs(p, days)]));

  // Where each bus to the end stops there, and when after its start: from its stops in order, its terminus included;
  // from the passes when the database has not the stops of its pattern.
  const ends = new Map<number, { stop: number; offset: number }[]>();
  for (const pattern of endIds) {
    const stops = order?.get(pattern)?.stops;
    const list = stops
      ? stops.filter(([s]) => to.stops.has(s)).map(([stop, offset]) => ({ stop, offset }))
      : all.filter((p) => p.pattern === pattern && to.stops.has(p.stop)).map(({ stop, offset }) => ({ stop, offset }));
    if (list.length) ends.set(pattern, list);
  }

  // For each stop where a bus to the end passes before it: that bus, its offset there, and the best of its stops at
  // the end after it (the one reached soonest, the walk from it included).
  const toEnd = new Map<number, { pattern: number; offset: number; a: number; offA: number; then: number }[]>();
  for (const pattern of ends.keys()) {
    const stops = order?.get(pattern)?.stops;
    if (!stops) continue;
    let best: { a: number; offA: number; then: number } | undefined;
    for (let k = stops.length - 1; k >= 0; k--) {
      const [s, off] = stops[k];
      if (to.stops.has(s)) {
        const then = off + to.stops.get(s)!;
        if (!best || then < best.then) best = { a: s, offA: off, then };
      }
      if (best && off < best.offA) toEnd.set(s, [...(toEnd.get(s) ?? []), { pattern, offset: off, ...best }]);
    }
  }

  const found: Journey[] = [];
  for (const s of starts) {
    const p1 = pats.get(s.pattern);
    if (!p1) continue;
    const walkIn = from.stops.get(s.stop)!;
    // Where one may change from this bus to one for the end, the same for each of its trips: worked out once.
    const changes: { x: number; offX: number; y: number; walk: number; c: NonNullable<ReturnType<typeof toEnd.get>>[number] }[] = [];
    for (const [x, offX] of order?.get(s.pattern)?.stops ?? []) {
      if (offX <= s.offset) continue;
      for (const [y, walk] of walkable(x)) {
        for (const c of toEnd.get(y) ?? []) if (c.pattern !== s.pattern && transit.ENDS[c.pattern]?.[0] !== p1.route && pats.has(c.pattern)) changes.push({ x, offX, y, walk, c });
      }
    }
    for (const run of timetable.get(s.pattern) ?? []) {
      const leave = run[0] + s.offset;
      if (leave < leaveLo || leave > leaveHi) continue;
      // Direct: the same bus passes at the end afterwards.
      for (const e of ends.get(s.pattern) ?? []) {
        if (e.offset <= s.offset) continue;
        const walkOut = to.stops.get(e.stop)!;
        found.push({ legs: [legOf(p1, run, s.stop, e.stop, s.offset, e.offset)], marche_depart: walkIn, marche_arrivee: walkOut, depart: leave - walkIn, arrivee: run[0] + e.offset + walkOut });
      }
      // One change: off at a later stop, a walk of at most 400 m, then the first bus to the end.
      let best: { k: number; next: [number, string, number]; arrivee: number } | undefined;
      changes.forEach(({ offX, walk, c }, k) => {
        const next = firstFrom(timetable.get(c.pattern) ?? [], c.offset, run[0] + offX + walk + CHANGE_S);
        if (next && (!best || next[0] + c.then < best.arrivee)) best = { k, next, arrivee: next[0] + c.then };
      });
      if (best) {
        const { x, offX, y, walk, c } = changes[best.k];
        found.push({
          legs: [legOf(p1, run, s.stop, x, s.offset, offX), legOf(pats.get(c.pattern)!, best.next, y, c.a, c.offset, c.offA)],
          marche_depart: walkIn,
          ...(walk ? { marche_changement: walk } : {}),
          marche_arrivee: to.stops.get(c.a)!,
          depart: leave - walkIn,
          arrivee: best.arrivee,
        });
      }
    }
  }
  return { trajets: chosen(found, lo, hi, arriveBy), lectures: { ...read }, fenetre: window };
}

/**
 * Of the journeys found, those in the hours asked that no other beats: one leaving no sooner and arriving no later,
 * with no more changes. Then the first 5 leaving after the time asked; or, to arrive before it, the last 5 to leave, the last first.
 */
export function chosen(found: Journey[], lo: number, hi: number, arriveBy: boolean): Journey[] {
  const inTime = found.filter((j) => (arriveBy ? j.arrivee >= lo && j.arrivee <= hi : j.depart >= lo && j.depart <= hi));
  const beats = (a: Journey, b: Journey) =>
    a.depart >= b.depart && a.arrivee <= b.arrivee && a.legs.length <= b.legs.length && (a.depart > b.depart || a.arrivee < b.arrivee || a.legs.length < b.legs.length);
  const seen = new Set<string>();
  const kept = inTime
    .filter((j) => !inTime.some((o) => beats(o, j)))
    .filter((j) => {
      // The same buses from both sides of a road, or from two stops of a commune: once.
      const k = j.legs.map((l) => `${l.ligne}|${l.depart}|${l.arrivee}`).join(">");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const byDepart = (a: Journey, b: Journey) => a.depart - b.depart || a.arrivee - b.arrivee;
  // To arrive before a time, the one leaving last comes first: the bus to take, then the earlier ones in case.
  return arriveBy ? kept.sort((a, b) => b.depart - a.depart || b.arrivee - a.arrivee).slice(0, SHOWN) : kept.sort(byDepart).slice(0, SHOWN);
}
