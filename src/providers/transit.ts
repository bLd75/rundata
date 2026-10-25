/**
 * Bus timetables of La Réunion: the GTFS files of the seven networks (transport.data.gouv.fr, Licence Ouverte),
 * prepared by scripts/build-transit.py. Stops, lines and service calendars are bundled (src/transit/network.json);
 * which patterns pass at a stop and their trips live in the D1 database. There, each network's rows have ids local to
 * the network and are filed under its feed, a fingerprint of their content, so a network that did not change keeps
 * its rows from one build to the next.
 */
import { count } from "../budget.js";
import { normalize } from "../places/resolve.js";
import network from "../transit/network.json" with { type: "json" };
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "gtfs_reunion",
  nom: "Horaires théoriques des réseaux de bus de La Réunion (GTFS)",
  organisme: "Région Réunion (Car Jaune), CINOR (Citalis), TCO (Kar'Ouest), CIVIS (Alternéo), CASUD (CarSud), CIREST (Estival)",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Réseaux de transport de La Réunion, via transport.data.gouv.fr",
  url: "https://transport.data.gouv.fr",
};

/** The part of a D1 database used here. */
export interface TransitDb {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

let db: TransitDb | undefined;

/** The timetables need the D1 database, so they exist in the Worker only. */
export function configure(d: TransitDb | undefined) {
  db = d;
}
export const enabled = () => db !== undefined;

export interface Network {
  nom: string;
  exploitant: string;
  donnees: string;
  valide_jusqu_au: string | null;
  /** Its rows in the database. */
  feed: string;
  /** Its patterns' stops in the database (pattern_stops), under a fingerprint of their own; absent from an older build. */
  stops_feed?: string;
  /** Where its stops, lines and patterns start in the island-wide numbering. */
  first_stop: number;
  first_route: number;
  first_pattern: number;
  /** Its real-time feed (GTFS-RT), and the GTFS ids of its stops and lines in their order here, which the feed uses. */
  temps_reel?: { flux: string; arrets: string[]; lignes: string[] };
}
export const NETWORKS: Record<string, Network> = network.networks;
/** Networks in their numbering order. */
const ORDER = Object.values(NETWORKS).sort((a, b) => a.first_stop - b.first_stop);
/** The network that a stop (or a pattern) of the island-wide numbering belongs to. */
const owner = (id: number, first: (n: Network) => number) => ORDER.reduce((found, n) => (first(n) <= id ? n : found), ORDER[0]);
const byFeed = new Map(ORDER.map((n) => [n.feed, n]));
/** [network, short name, long name] by route index. */
export const ROUTES = network.routes as unknown as [string, string, string][];
/** [network, name, lat, lon, commune] by stop index. */
const STOPS = network.stops as unknown as [string, string, number, number, string][];
/** [days Monday first as 7 bits, first day, last day, added days, removed days], days as YYYYMMDD. */
const SERVICES = network.services as unknown as Record<string, [number, number, number, number[], number[]][]>;
/** [first start, last start, services…] of each pattern's trips, by pattern index: what it runs, without reading it. */
const SPANS: number[][] = network.patterns;
/** [route, first stop, last stop] of each pattern, by pattern index. */
export const ENDS = network.ends as unknown as [number, number, number][];
/** The patterns of each route. */
const ROUTE_PATTERNS = new Map<number, number[]>();
ENDS.forEach(([route], i) => ROUTE_PATTERNS.set(route, [...(ROUTE_PATTERNS.get(route) ?? []), i]));
export const patternsOf = (route: number) => ROUTE_PATTERNS.get(route) ?? [];
/** The services a pattern's trips run on, from the bundle. */
export const servicesOf = (pattern: number) => (SPANS[pattern] ?? []).slice(2);

export interface Stop {
  id: number;
  reseau: string;
  nom: string;
  commune: string;
  lat: number;
  lon: number;
}
/** A stop of the island-wide numbering, a bus station's bay named as the station. */
export function stop(id: number): Stop {
  const [reseau, name, lat, lon, commune] = STOPS[id];
  return { id, reseau, nom: name.replace(/\s+quai\s+\S+$/i, ""), commune, lat, lon };
}

/** The stops of a network that share a name in one commune: both sides of the road, usually. */
export interface StopGroup {
  reseau: string;
  nom: string;
  commune: string;
  ids: number[];
  lat: number;
  lon: number;
  /** The words of its name, normalized. */
  words: Set<string>;
}

/** Normalized, with « St » and « Ste » written out, as stop names use both. */
export const expand = (s: string) => normalize(s).replace(/\bst\b/g, "saint").replace(/\bste\b/g, "sainte");

export const GROUPS: StopGroup[] = (() => {
  const by = new Map<string, StopGroup>();
  STOPS.forEach(([net, name, lat, lon, commune], id) => {
    // A bus station's bays (« Gare Routière Du Tampon Quai A » to « Quai Q ») are one stop for a traveller.
    const nom = name.replace(/\s+quai\s+\S+$/i, "");
    const key = `${net}|${expand(nom)}|${commune}`;
    const g = by.get(key);
    if (g) {
      g.ids.push(id);
      g.lat += (lat - g.lat) / g.ids.length;
      g.lon += (lon - g.lon) / g.ids.length;
    } else {
      by.set(key, { reseau: net, nom, commune, ids: [id], lat, lon, words: new Set(expand(nom).split(" ")) });
    }
  });
  return [...by.values()];
})();

export function serviceRuns(net: string, service: number, day: number, weekday: number): boolean {
  const s = SERVICES[net]?.[service];
  if (!s) return false;
  const [days, first, last, added, removed] = s;
  if (removed.includes(day)) return false;
  if (added.includes(day)) return true;
  // weekday: 0 for Monday; Monday is the highest of the 7 bits.
  return day >= first && day <= last && ((days >> (6 - weekday)) & 1) === 1;
}

/**
 * Whether a pattern may stop, `offset` seconds after its start, between `from` and `to` (seconds after the local midnight
 * of `day`) on a trip of a service running that day; told from its first and last start, before its trips are read.
 */
export function mayRun(pattern: number, offset: number, net: string, day: number, weekday: number, from: number, to: number): boolean {
  const span = SPANS[pattern];
  if (!span) return true;
  const [first, last, ...services] = span;
  return first + offset <= to && last + offset >= from && services.some((s) => serviceRuns(net, s, day, weekday));
}

export interface Pattern {
  id: number;
  route: number;
  headsign: string;
  /** [service, start in seconds after the service day's midnight (may pass 24 h), GTFS trip id]. */
  trips: [number, number, string][];
}

/** [feed, local id] pairs, as the database knows them, for a query. */
const keys = (ids: number[], first: (n: Network) => number, feed = (n: Network) => n.feed) =>
  JSON.stringify(ids.map((id) => { const n = owner(id, first); return [feed(n), id - first(n)]; }));

const JOIN = "JOIN json_each(?) k ON t.feed = json_extract(k.value, '$[0]') AND t.id = json_extract(k.value, '$[1]')";

/** For each stop, the patterns passing there with their time offset from the trip's start. */
export async function passes(ids: number[]): Promise<{ stop: number; pattern: number; offset: number }[]> {
  if (!db) throw new Error("horaires indisponibles ici");
  count();
  const rows = await db.all<{ feed: string; id: number; passes: string }>(
    `SELECT t.feed, t.id, t.passes FROM passes t ${JOIN}`,
    keys(ids, (n) => n.first_stop),
  );
  return rows.flatMap((r) => {
    const n = byFeed.get(r.feed)!;
    return (JSON.parse(r.passes) as [number, number][]).map(([pattern, offset]) => ({ stop: n.first_stop + r.id, pattern: n.first_pattern + pattern, offset }));
  });
}

export async function patterns(ids: number[]): Promise<Map<number, Pattern>> {
  if (!db) throw new Error("horaires indisponibles ici");
  count();
  const rows = await db.all<{ feed: string; id: number; route: number; headsign: string; trips: string }>(
    `SELECT t.feed, t.id, t.route, t.headsign, t.trips FROM patterns t ${JOIN}`,
    keys(ids, (n) => n.first_pattern),
  );
  return new Map(
    rows.map((r) => {
      const n = byFeed.get(r.feed)!;
      const id = n.first_pattern + r.id;
      return [id, { id, route: n.first_route + r.route, headsign: r.headsign, trips: JSON.parse(r.trips) }];
    }),
  );
}

export interface PatternStops {
  /** GTFS direction_id, when the network gives it. */
  sens: number | null;
  /** [stop (island-wide index), seconds after the trip's start], terminus included. */
  stops: [number, number][];
}

/**
 * The stops of these patterns in their order, or undefined when the database does not have them (a build older than
 * the table, a network whose rows are not written): the caller then says it has no list, and does not fail.
 */
export async function patternStops(ids: number[]): Promise<Map<number, PatternStops> | undefined> {
  if (!db) throw new Error("horaires indisponibles ici");
  const wanted = ids.filter((id) => owner(id, (n) => n.first_pattern).stops_feed);
  if (!wanted.length) return undefined;
  count();
  let rows: { feed: string; id: number; sens: number | null; stops: string }[];
  try {
    rows = await db.all(`SELECT t.feed, t.id, t.sens, t.stops FROM pattern_stops t ${JOIN}`, keys(wanted, (n) => n.first_pattern, (n) => n.stops_feed!));
  } catch (err) {
    // No such table: the database was not given it yet, or the deployment went back to an older one.
    console.error("arrêts des parcours indisponibles :", err instanceof Error ? err.message : err);
    return undefined;
  }
  if (!rows.length) return undefined;
  const byStopsFeed = new Map(ORDER.filter((n) => n.stops_feed).map((n) => [n.stops_feed!, n]));
  return new Map(
    rows.flatMap((r) => {
      const n = byStopsFeed.get(r.feed);
      if (!n) return [];
      const stops = (JSON.parse(r.stops) as [number, number][]).map(([st, o]) => [n.first_stop + st, o] as [number, number]);
      return [[n.first_pattern + r.id, { sens: r.sens, stops }] as const];
    }),
  );
}
