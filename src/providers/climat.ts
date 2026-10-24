/**
 * The past weather of La Réunion: every daily measurement of the Météo-France stations of the island, from 1900 (Saint-Denis
 * and Le Port) to yesterday (« Données climatologiques de base quotidiennes », Licence Ouverte).
 * Météo-France publishes them as files, the current period updated every morning with the day before; they are kept
 * in the D1 database `rundata-climat` (scripts/build-climat.py), one row per station and year, the current year
 * rewritten every morning by .github/workflows/climat.yml. The 1991-2020 normals are computed once and bundled
 * (scripts/build-normales.py).
 * The hourly measurements since 2000 (« Données climatologiques de base horaires ») are in a second database,
 * `rundata-climat-h` (scripts/build-climat-h.py), one row per station and month, the current month rewritten every
 * morning by the same job; their hours are local time.
 */
import { count } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import normales from "../historique/normales.json" with { type: "json" };
import type { SourceInfo } from "../types.js";
import { STATIONS_974 } from "./meteofrance-stations.js";

export const SOURCE: SourceInfo = {
  id: "mf_climatologie",
  nom: "Données climatologiques quotidiennes des stations Météo-France de La Réunion (pluie, températures, vent, soleil)",
  organisme: "Météo-France",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Météo-France",
  url: "https://meteo.data.gouv.fr/datasets/6569b51ae64326786e4e8e1a",
};

/** The part of a D1 database used here. */
export interface ClimatDb {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

export const SOURCE_HORAIRE: SourceInfo = {
  id: "mf_climatologie_horaire",
  nom: "Données climatologiques horaires des stations Météo-France de La Réunion (pluie, température, vent, soleil, heure par heure)",
  organisme: "Météo-France",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Météo-France",
  url: "https://meteo.data.gouv.fr/datasets/6569b4473bedf2e7abad3b72",
};

let db: ClimatDb | undefined;
let hourlyDb: ClimatDb | undefined;

/** The archive needs the database: in the Worker, or on Node when given one (src/bin/http.ts). */
export function configure(d: ClimatDb | undefined, hourly?: ClimatDb) {
  db = d;
  hourlyDb = hourly;
}
export const enabled = () => db !== undefined;
export const hourlyEnabled = () => hourlyDb !== undefined;

async function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  if (!db) throw new Error("archive climatologique non configurée");
  count();
  return db.all<T>(sql, ...params);
}

async function allHourly<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  if (!hourlyDb) throw new Error("archive horaire non configurée");
  count();
  return hourlyDb.all<T>(sql, ...params);
}

export type Field = "RR" | "TN" | "TX" | "TM" | "FXI" | "INST" | "SIGMA" | "GLOT" | "UM";

export interface Poste {
  poste: string;
  nom: string;
  lat: number;
  lon: number;
  alt: number;
  debut: number;
  fin: number;
  params: Field[];
}

// Names as people write them, where the station is also in the real-time list (« Plaine des Cafres », not « PLAINE DES CAFRES »).
const NAMES = new Map(STATIONS_974.map(([id, nom]) => [id, nom]));
// « ILET A VIDOT » → « Ilet à Vidot »: the files have no accents.
const SMALL = new Set(["de", "des", "du", "la", "le", "les", "a", "à", "d", "l"]);

/** « PLAINE DES CAFRES » → « Plaine des Cafres », « ST-LEU » → « Saint-Leu ». */
export function stationName(id: string, raw: string): string {
  const known = NAMES.get(id);
  if (known) return known;
  return raw
    .toLowerCase()
    .replace(/\bst-/g, "saint-")
    .replace(/\bste-/g, "sainte-")
    .replace(/[a-zàâçéèêëîïôûùüÿ]+/g, (w, i: number) => (i > 0 && SMALL.has(w) ? (w === "a" ? "à" : w) : w[0].toUpperCase() + w.slice(1)));
}

const DAY_SECONDS = 86_400;

/** Every station, with what it measures and since when. */
export async function postes(cache: Cache): Promise<Cached<Poste[]>> {
  return cache.get("climat:postes", DAY_SECONDS / 4, async () => {
    const rows = await all<Omit<Poste, "params"> & { params: string }>("SELECT poste, nom, lat, lon, alt, debut, fin, params FROM postes");
    return rows.map((r) => ({ ...r, nom: stationName(r.poste, r.nom), params: r.params.split(",") as Field[] }));
  });
}

export type HourField = "RR1" | "T" | "U" | "FF" | "DD" | "FXI" | "INS" | "GLO";

/** A station of the hourly archive: its first and last month as YYYYMM. */
export interface PosteHoraire extends Omit<Poste, "params"> {
  params: HourField[];
}

/** Every station of the hourly archive. */
export async function postesHoraires(cache: Cache): Promise<Cached<PosteHoraire[]>> {
  return cache.get("climat:postes-h", DAY_SECONDS / 4, async () => {
    const rows = await allHourly<Omit<PosteHoraire, "params"> & { params: string }>("SELECT poste, nom, lat, lon, alt, debut, fin, params FROM postes");
    return rows.map((r) => ({ ...r, nom: stationName(r.poste, r.nom), params: r.params.split(",") as HourField[] }));
  });
}

/** One station's hours of one month: field → value of each hour (index = (day − 1) × 24 + hour, local time), or null. */
export type Month = Partial<Record<HourField, (number | null)[]>>;

/** The months `m0`…`m1` (YYYYMM) of some stations, in one query. */
export async function months(stations: string[], m0: number, m1: number): Promise<Map<string, Map<number, Month>>> {
  const out = new Map<string, Map<number, Month>>();
  if (!stations.length) return out;
  const marks = stations.map(() => "?").join(",");
  const rows = await allHourly<{ poste: string; mois: number; data: string }>(
    `SELECT poste, mois, data FROM heures WHERE poste IN (${marks}) AND mois BETWEEN ? AND ?`, ...stations, m0, m1);
  for (const r of rows) {
    if (!out.has(r.poste)) out.set(r.poste, new Map());
    out.get(r.poste)!.set(r.mois, JSON.parse(r.data) as Month);
  }
  return out;
}

/** The value of `field` at an hour (local « YYYY-MM-DD », 0…23), from the months read. */
export function valueAt(ms: Map<number, Month> | undefined, field: HourField, day: string, hour: number): number | null {
  const col = ms?.get(+day.slice(0, 4) * 100 + +day.slice(5, 7))?.[field];
  return col?.[(+day.slice(8, 10) - 1) * 24 + hour] ?? null;
}

/** One station's days of one year: field → value of each day of the year (index = day of the year − 1), or null. */
export type Year = Partial<Record<Field, (number | null)[]>>;

/** The years `y0`…`y1` of some stations, in one query. */
export async function years(stations: string[], y0: number, y1: number): Promise<Map<string, Map<number, Year>>> {
  const out = new Map<string, Map<number, Year>>();
  if (!stations.length) return out;
  const marks = stations.map(() => "?").join(",");
  const rows = await all<{ poste: string; annee: number; data: string }>(
    `SELECT poste, annee, data FROM jours WHERE poste IN (${marks}) AND annee BETWEEN ? AND ?`, ...stations, y0, y1);
  for (const r of rows) {
    if (!out.has(r.poste)) out.set(r.poste, new Map());
    out.get(r.poste)!.set(r.annee, JSON.parse(r.data) as Year);
  }
  return out;
}

/** [value, YYYY-MM-DD]. */
export type Extreme = [number, string];
export interface Records {
  /** The year they go up to; the years after are read from the days. */
  jusqu_a: number;
  tx?: Extreme;
  tn?: Extreme;
  rr?: Extreme;
  fxi?: Extreme;
  mois: { tx?: (Extreme | null)[]; tn?: (Extreme | null)[]; rr?: (Extreme | null)[] };
}

export async function records(poste: string): Promise<Records | null> {
  const [r] = await all<{ jusqu_a: number; data: string }>("SELECT jusqu_a, data FROM records WHERE poste = ?", poste);
  if (!r) return null;
  const data = JSON.parse(r.data) as Partial<Omit<Records, "jusqu_a">>;
  return { ...data, jusqu_a: r.jusqu_a, mois: data.mois ?? {} };
}

export interface Normales {
  /** Month by month, January first; null where the station has fewer than 10 years. */
  rr?: (number | null)[];
  jours?: (number | null)[];
  tn?: (number | null)[];
  tx?: (number | null)[];
  /** Minutes of sunshine a day. */
  inst?: (number | null)[];
  sigma?: (number | null)[];
  rr_ans?: number;
  tx_ans?: number;
  inst_ans?: number;
}
export const NORMALES_PERIODE = normales.periode;
const NORMALES = normales.stations as Record<string, Normales>;
export const normalesOf = (poste: string): Normales | undefined => NORMALES[poste];

/** The day of the year (1…366) of a YYYY-MM-DD date. */
export function dayOfYear(iso: string): number {
  const d = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((d - Date.UTC(+iso.slice(0, 4), 0, 1)) / (DAY_SECONDS * 1000)) + 1;
}

/** The value of `field` on a day, from the years read. */
export function valueOn(ys: Map<number, Year> | undefined, field: Field, iso: string): number | null {
  const col = ys?.get(+iso.slice(0, 4))?.[field];
  return col?.[dayOfYear(iso) - 1] ?? null;
}
