/**
 * The public charging points for electric cars: the stations of La Réunion (src/irve/stations.json, built by
 * scripts/build-irve.py from the national base of IRVE) and whether each point is free now, from the national live
 * file of the same access point, transport.data.gouv.fr. Licence Ouverte.
 *
 * The live file covers all of France (about 9 Mo, 125 000 points). The Worker reads La Réunion's part only, filtered
 * every 15 minutes by its scheduled event (`refresh`, worker.ts) and written to its KV store under `irve:etat`. The
 * Node server, given no reader, reads the national file itself.
 *
 * A point's time is when its status last changed, not when it was last checked: a point free since yesterday is
 * simply still free.
 */
import type { Cache } from "../cache.js";
import { getText } from "../http.js";
import data from "../irve/stations.json" with { type: "json" };
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "irve",
  nom: "Bornes de recharge pour véhicules électriques (base nationale des IRVE, données statiques et dynamiques)",
  organisme: "transport.data.gouv.fr, d'après les opérateurs de recharge (Freshmile, EZDrive…)",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Base nationale des IRVE, transport.data.gouv.fr",
  url: "https://transport.data.gouv.fr/datasets/beta-bases-nationales-des-points-de-recharge-pour-vehicules-electriques-en-france-irve",
};

export const LIVE_URL = "https://proxy.transport.data.gouv.fr/resource/consolidation-nationale-irve-dynamique";
// The scheduled event writes every 15 minutes; each data center reads its copy again after this.
const LIVE_SECONDS = 120;
/** The scheduled event writes La Réunion's part every 15 minutes, at 5, 20, 35 and 50 past the hour (UTC). */
export const REFRESH_EVERY = 15;
export const REFRESH_OFFSET = 5;
/** Kept 6 hours in KV: past that, the pages say the status is unknown rather than show an old one. */
export const LIVE_TTL_SECONDS = 6 * 3600;

export interface Point {
  id: string;
  kw: number;
  /** « Type 2 », « Combo CCS », « CHAdeMO », « prise domestique », « autre prise ». */
  prises: string[];
}

export interface Station {
  id: string;
  /** Who set it up, when that names the place (« Decathlon Saint-Denis »); often empty. */
  nom: string;
  /** The network whose app or card starts a charge (« Freshmile », « EZDrive »). */
  reseau: string;
  adresse: string;
  commune: string;
  lon: number;
  lat: number;
  implantation: string;
  horaires: string;
  tarif?: string;
  gratuit?: boolean;
  acces_reserve?: boolean;
  points: Point[];
}

export const STATIONS: Station[] = data.stations;
export const ATTRIBUTION: string = data.attribution;
export const IDS = new Set(STATIONS.flatMap((s) => s.points.map((p) => p.id)));

export type Etat = "en_service" | "hors_service" | "inconnu";
export type Occupation = "libre" | "occupe" | "reserve" | "inconnu";

/** La Réunion's part of the live file: [state, occupation, ISO time of the last change] per point id. */
export interface Live {
  /** ISO time the national file was read. */
  lu: string;
  points: Record<string, [Etat, Occupation, string]>;
}

/** Last Sunday of a month (0-based), as a UTC date at 01:00, when France changes its clocks. */
function lastSunday(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month + 1, 0, 1));
  return d.getTime() - d.getUTCDay() * 86_400_000;
}

/**
 * A time of the file as ISO UTC. Most are written with their offset; some operators (Freshmile among them) write
 * Paris time without it, which is UTC+2 in summer and UTC+1 in winter.
 */
export function timeOf(s: string): string {
  const t = s.trim().replace(" ", "T");
  if (/(Z|[+-]\d\d:?\d\d)$/.test(t)) {
    const ms = Date.parse(t.replace(/(\.\d{3})\d+/, "$1"));
    return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
  }
  const naive = Date.parse(`${t.replace(/(\.\d{3})\d+/, "$1")}Z`);
  if (!Number.isFinite(naive)) return "";
  const y = new Date(naive).getUTCFullYear();
  const summer = naive - 2 * 3_600_000 >= lastSunday(y, 2) && naive - 2 * 3_600_000 < lastSunday(y, 9);
  return new Date(naive - (summer ? 2 : 1) * 3_600_000).toISOString();
}

const ETATS = new Set<string>(["en_service", "hors_service", "inconnu"]);
const OCCUPATIONS = new Set<string>(["libre", "occupe", "reserve", "inconnu"]);

/**
 * The rows of the national CSV whose point is one of `ids`, read line by line without splitting the whole file.
 * Columns: id_pdc_itinerance, etat_pdc, occupation_pdc, horodatage, then the state of each plug (not kept).
 */
export function parseLive(csv: string, ids: Set<string> = IDS, now = new Date()): Live {
  const points: Live["points"] = {};
  const head = csv.slice(0, csv.indexOf("\n")).trim().split(",");
  const [ci, ce, co, ch] = ["id_pdc_itinerance", "etat_pdc", "occupation_pdc", "horodatage"].map((c) => head.indexOf(c));
  if ([ci, ce, co, ch].some((i) => i < 0)) throw new Error(`colonnes inattendues : ${head.join(",")}`);
  let i = csv.indexOf("\n") + 1;
  while (i > 0 && i < csv.length) {
    const end = csv.indexOf("\n", i);
    const line = csv.slice(i, end < 0 ? csv.length : end);
    i = end < 0 ? csv.length : end + 1;
    // The id comes first: most lines are left after one look at it.
    if (ci === 0 && !ids.has(line.slice(0, line.indexOf(",")))) continue;
    const f = line.trim().split(",");
    const id = f[ci];
    if (!ids.has(id)) continue;
    const etat = ETATS.has(f[ce]) ? (f[ce] as Etat) : "inconnu";
    const occupation = OCCUPATIONS.has(f[co]) ? (f[co] as Occupation) : "inconnu";
    const at = timeOf(f[ch] ?? "");
    // The file may list a point twice: the latest change wins.
    if (!points[id] || at > points[id][2]) points[id] = [etat, occupation, at];
  }
  return { lu: now.toISOString(), points };
}

/** La Réunion's part of the national file; fails when it lists too few of the island's points: better the last good copy than none. */
export function reunionPart(csv: string, now = new Date()): Live {
  const live = parseLive(csv, IDS, now);
  const n = Object.keys(live.points).length;
  if (n < IDS.size / 2) throw new Error(`seulement ${n} points de La Réunion sur ${IDS.size} dans le fichier national`);
  return live;
}

/** Whether the scheduled event at `now` (every 5 minutes) is one of those that write La Réunion's part. */
export const refreshDue = (now: Date) => (((now.getUTCMinutes() - REFRESH_OFFSET) % REFRESH_EVERY) + REFRESH_EVERY) % REFRESH_EVERY < 5;

/** In the Worker's scheduled event: La Réunion's part read from the national file and handed to `write`; its points. */
export async function refresh(write: (live: Live) => Promise<void>, now = new Date()): Promise<number> {
  const live = reunionPart(await getText(SOURCE.id, LIVE_URL, 60_000), now);
  await write(live);
  return Object.keys(live.points).length;
}

let reader: (() => Promise<Live | null>) | undefined;

/** In the Worker: read La Réunion's part from the KV store, where the scheduled event writes it. */
export function configure(read: (() => Promise<Live | null>) | undefined) {
  reader = read;
}

export async function live(cache: Cache) {
  return cache.getCopy("irve:etat", LIVE_SECONDS, async () => {
    if (reader) {
      const v = await reader();
      if (!v?.points) throw new Error("état des bornes absent du stockage");
      return v;
    }
    return parseLive(await getText(SOURCE.id, LIVE_URL, 60_000));
  }, (v) => v.lu);
}
