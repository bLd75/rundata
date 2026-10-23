/**
 * Bus timetables of La Réunion: the GTFS files of the seven networks (transport.data.gouv.fr, Licence Ouverte),
 * prepared by scripts/build-transit.py. Stops, lines and service calendars are bundled (src/transit/network.json);
 * which patterns pass at a stop and their trips live in the D1 database, under the same build id.
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

export const BUILD: string = network.build;
export const NETWORKS: Record<string, { nom: string; exploitant: string; donnees: string; valide_jusqu_au: string | null }> = network.networks;
/** [network, short name, long name] by route index. */
export const ROUTES = network.routes as unknown as [string, string, string][];
/** [network, name, lat, lon, commune] by stop index. */
const STOPS = network.stops as unknown as [string, string, number, number, string][];
/** [days Monday first as 7 bits, first day, last day, added days, removed days], days as YYYYMMDD. */
const SERVICES = network.services as unknown as Record<string, [number, number, number, number[], number[]][]>;

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

export interface Pattern {
  id: number;
  route: number;
  headsign: string;
  /** [service, start in seconds after the service day's midnight (may pass 24 h), GTFS trip id]. */
  trips: [number, number, string][];
}

/** For each stop, the patterns passing there with their time offset from the trip's start. */
export async function passes(ids: number[]): Promise<{ stop: number; pattern: number; offset: number }[]> {
  if (!db) throw new Error("horaires indisponibles ici");
  count();
  const rows = await db.all<{ id: number; passes: string }>(
    "SELECT id, passes FROM stop_passes WHERE build = ? AND id IN (SELECT value FROM json_each(?))",
    BUILD,
    JSON.stringify(ids),
  );
  return rows.flatMap((r) => (JSON.parse(r.passes) as [number, number][]).map(([pattern, offset]) => ({ stop: r.id, pattern, offset })));
}

export async function patterns(ids: number[]): Promise<Map<number, Pattern>> {
  if (!db) throw new Error("horaires indisponibles ici");
  count();
  const rows = await db.all<{ id: number; route: number; headsign: string; trips: string }>(
    "SELECT id, route, headsign, trips FROM pattern WHERE build = ? AND id IN (SELECT value FROM json_each(?))",
    BUILD,
    JSON.stringify(ids),
  );
  return new Map(rows.map((r) => [r.id, { id: r.id, route: r.route, headsign: r.headsign, trips: JSON.parse(r.trips) }]));
}
