/**
 * The particles measured by sensors that private people set up and share on Sensor.Community, a citizen network of
 * sensors (DbCL 1.0). Not calibrated nor checked by Atmo Réunion: said apart from its index (providers/atmo.ts), always
 * under it, without an index, a colour or a threshold.
 *
 * The network's filter by area gives the measures of its last 5 minutes. The scheduled event reads it for the whole
 * island every 15 minutes (`collect`, worker.ts) and keeps in KV each sensor's last measure for 2 hours, written when
 * it changed or an hour after; pages and tools read that copy (`capteurs`), never the network. A sensor is said by its commune
 * alone: never its identifier, nor its place, which the network publishes as precise as an address. Its identifier is
 * kept in the store only, to tell one sensor's measures from another's.
 */
import type { Cached } from "../cache.js";
import { getJson } from "../http.js";
import { placeAt } from "../places/resolve.js";
import { distanceKm } from "../geo.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "sensor_community",
  nom: "Capteurs amateurs de particules partagés sur Sensor.Community",
  organisme: "Sensor.Community, réseau citoyen de capteurs (Stuttgart), d'après les capteurs de particuliers",
  licence: "DbCL 1.0",
  attribution: "Sensor.Community",
  url: "https://sensor.community/",
};

/** The network's general map, never a sensor's page. */
export const CARTE = "https://maps.sensor.community/";
export const DBCL = "https://opendatacommons.org/licenses/dbcl/1-0/";
/** The official guide to build and share an airRohr sensor, read on 29/10/2026 at 10:53. */
export const GUIDE = "https://sensor.community/en/sensors/airrohr/";

// The island and its sea, as south, west, north, east.
const URL = "https://data.sensor.community/airrohr/v1/filter/box=-21.42,55.20,-20.85,55.87";

/** Written by the scheduled event (`collect`), read by worker.ts. */
export const KV_KEY = "capteurs:air";
export const KV_TTL_SECONDS = 86_400;
/** Every 15 minutes, at 10, 25, 40 and 55 past (UTC). */
export const REFRESH_EVERY = 15;
export const REFRESH_OFFSET = 10;
export const refreshDue = (now: Date) => (((now.getUTCMinutes() - REFRESH_OFFSET) % REFRESH_EVERY) + REFRESH_EVERY) % REFRESH_EVERY < 5;
/** A sensor is said only if it measured within this. */
export const WINDOW_MS = 2 * 3600_000;
// Farther than this from every place of the gazetteer, a point is at sea or off the island.
const ISLAND_KM = 10;

export interface Capteur {
  /** The network's identifier of the sensor: kept in the store, never said. */
  cle: string;
  commune: string;
  /** µg/m³. */
  pm10?: number;
  pm2_5?: number;
  /** When it measured (ISO, UTC), as the network says. */
  mesure_a: string;
}

export interface Copie {
  /** When the scheduled event last read the network (ISO, UTC). */
  lu: string;
  capteurs: Capteur[];
}

type Entry = {
  timestamp: string;
  location: { latitude: string; longitude: string; indoor?: number };
  sensor: { id: number };
  sensordatavalues: { value_type: string; value: string }[];
};

const value = (e: Entry, type: string) => {
  const v = e.sensordatavalues.find((x) => x.value_type === type)?.value;
  const n = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * The sensors of the island in an answer of the network: those outdoors with a value of particles (P1 is PM10, P2
 * PM2,5), each by its commune; its time in UTC, as the network writes it.
 */
export function parse(entries: Entry[]): Capteur[] {
  const out: Capteur[] = [];
  for (const e of entries) {
    if (e.location.indoor) continue;
    const pm10 = value(e, "P1");
    const pm2_5 = value(e, "P2");
    if (pm10 === undefined && pm2_5 === undefined) continue;
    const lat = Number(e.location.latitude);
    const lon = Number(e.location.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const place = placeAt(lon, lat);
    if (distanceKm(lon, lat, place.lon, place.lat) > ISLAND_KM) continue;
    out.push({
      cle: String(e.sensor.id),
      commune: place.commune,
      ...(pm10 !== undefined && { pm10 }),
      ...(pm2_5 !== undefined && { pm2_5 }),
      mesure_a: `${e.timestamp.replace(" ", "T")}Z`,
    });
  }
  return out;
}

/** Each sensor's latest measure, among those kept and those read, if within the last 2 hours. */
export function merge(before: Capteur[], read: Capteur[], now: Date): Capteur[] {
  const by = new Map<string, Capteur>();
  for (const c of [...before, ...read]) {
    const had = by.get(c.cle);
    if (!had || Date.parse(c.mesure_a) > Date.parse(had.mesure_a)) by.set(c.cle, c);
  }
  return [...by.values()]
    .filter((c) => now.getTime() - Date.parse(c.mesure_a) <= WINDOW_MS)
    .sort((a, b) => a.commune.localeCompare(b.commune, "fr") || a.mesure_a.localeCompare(b.mesure_a));
}

// Unchanged, the copy is written again past this, so that its time says when the network was last read (an empty
// list is a reading too): 24 writes a day at most with no sensor.
const REWRITE_MS = 3600_000;

/**
 * The scheduled event's read: the network's last 5 minutes over the island, merged with the copy. Writes it when the
 * sensors kept changed, or when it was written an hour ago or more.
 */
export async function collect(before: Copie | null, write: (copie: Copie) => Promise<void>, now = new Date()): Promise<string> {
  const read = parse(await getJson<Entry[]>(SOURCE.id, URL, 20_000));
  const capteurs = merge(before?.capteurs ?? [], read, now);
  const said = `${read.length} lus, ${capteurs.length} des 2 dernières heures`;
  const same = before && JSON.stringify(capteurs) === JSON.stringify(before.capteurs);
  if (same && now.getTime() - Date.parse(before.lu) < REWRITE_MS) return `${said}, inchangés : non réécrits`;
  await write({ lu: now.toISOString(), capteurs });
  return `${said}, écrits`;
}

let reader: (() => Promise<Copie | null>) | undefined;
let memo: { at: number; copie: Copie } | undefined;

/** In the Worker: read the sensors from the KV store, where the scheduled event writes them, and the network never. */
export function configure(read: (() => Promise<Copie | null>) | undefined) {
  reader = read;
  memo = undefined;
}

// The scheduled event writes every 15 minutes at most: the copy is asked of KV once in that time by an isolate.
const FRESH_MS = 15 * 60_000;

/**
 * The stored sensors of the last 2 hours, their time the scheduled event's last write; null where nothing is
 * configured (a local server, the tests), as the Worker alone has them. Fails while the store has no copy.
 * Read from KV directly and kept in memory, never through the data center's cache: 1 subrequest instead of 3 in the
 * build of /air's copy, which the scheduled event's budget counts (BUDGET.md).
 */
export async function capteurs(now = new Date()): Promise<Cached<Copie> | null> {
  if (!reader) return null;
  if (!memo || now.getTime() - memo.at >= FRESH_MS) {
    const v = await reader();
    if (!v) throw new Error("capteurs amateurs absents du stockage");
    memo = { at: now.getTime(), copie: v };
  }
  const v = memo.copie;
  return { value: { ...v, capteurs: v.capteurs.filter((x) => now.getTime() - Date.parse(x.mesure_a) <= WINDOW_MS) }, fetchedAt: new Date(v.lu), stale: false };
}
