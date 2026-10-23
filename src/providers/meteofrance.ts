/**
 * Météo-France ground stations, from the "Package Observations" API (DPPaquetObs v2). One call returns every
 * station in France for one 6-minute slot; about 56 of them are in Réunion, from the coast to the summits.
 * Needs a free key from portail-api.meteofrance.fr: without one this provider is off and the server answers
 * from the open sources only.
 *
 * A slot is published 2 to 10 minutes after its time and fills up as stations report, so the latest slots are
 * read together (each station's newest row wins) and each slot is re-read until it is final.
 */
import type { Bundle, Cache, Cached } from "../cache.js";
import { getText } from "../http.js";
import type { Observation, Reading, SourceInfo, Station } from "../types.js";
import { download, session, type Session } from "./mf-auth.js";
import { STATIONS_974 } from "./meteofrance-stations.js";

export const SOURCE: SourceInfo = {
  id: "meteofrance",
  nom: "Stations Météo-France (mesures toutes les 6 minutes)",
  organisme: "Météo-France",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Météo-France",
  url: "https://portail-api.meteofrance.fr/",
};

const BASE = "https://public-api.meteofrance.fr/public/DPPaquetObs/v2/paquet/stations/infrahoraire-6m";
const SLOT_MS = 6 * 60_000;
const FINAL_AFTER_MS = 15 * 60_000; // a slot no longer changes after this
const RECHECK_SECONDS = 2 * 60;
// Slots read per question: enough for the newest row of each station and the nine before it (rain over an hour).
const SLOTS = 11;
// The slots are kept together, one read and one write of the Worker's edge cache instead of eleven of each.
const BUNDLE = "meteofrance:6min";
const SYNC_SECONDS = 60;

export { configure, enabled, type Credentials } from "./mf-auth.js";

const STATIONS = new Map<string, Omit<Station, "variables">>(
  STATIONS_974.map(([id, nom, lat, lon, altitude_m]) => [id, { source: "meteofrance", id, nom, lon, lat, altitude_m }]),
);

export function stations(): Station[] {
  return [...STATIONS.values()].map((s) => ({ ...s, variables: [] }));
}

/** One station in one slot, in the published units (Kelvin, m/s, Pa), restricted to the columns used. */
export interface Row {
  id: string;
  time: string;
  t: number | null;
  td: number | null;
  u: number | null;
  dd: number | null;
  ff: number | null;
  raf10: number | null;
  rr_per: number | null;
  pmer: number | null;
}

const COLUMNS = ["t", "td", "u", "dd", "ff", "raf10", "rr_per", "pmer"] as const;

/** The Réunion rows of a slot (the CSV covers all of France). */
export function parseCsv(csv: string): Row[] {
  const head = csv.slice(0, csv.indexOf("\n")).trim().split(";");
  const at = (name: string) => head.indexOf(name);
  const id = at("geo_id_insee");
  const time = at("validity_time");
  // A regex rather than a split of all ~1 900 lines: the Worker has little CPU time per request.
  return (csv.match(/^[^;\n]*;[^;\n]*;974\d{5};.*$/gm) ?? []).map((line) => {
    const f = line.trim().split(";");
    const row = { id: f[id], time: f[time] } as Row;
    for (const c of COLUMNS) row[c] = f[at(c)] ? Number(f[at(c)]) : null;
    return row;
  });
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const celsius = (k: number) => r1(k - 273.15);
const kmh = (ms: number) => Math.round(ms * 3.6);

export function observation(row: Row, rain1h: number | null): Observation | null {
  const s = STATIONS.get(row.id);
  if (!s) return null; // a station opened after the list was taken: no name or altitude to show
  const readings: Reading[] = [];
  const add = (variable: string, valeur: number | string, unite?: string) =>
    readings.push({ variable, valeur, unite, nature: "mesure" });
  if (row.t != null) add("temperature", celsius(row.t), "°C");
  if (row.u != null) add("humidite", Math.round(row.u), "%");
  if (row.td != null) add("point_de_rosee", celsius(row.td), "°C");
  if (row.ff != null) {
    add("vent_moyen", kmh(row.ff), "km/h");
    if (row.dd != null && row.ff > 0) add("vent_direction", Math.round(row.dd), "° (d'où vient le vent)");
  }
  if (row.raf10 != null) add("rafales", kmh(row.raf10), "km/h");
  if (row.rr_per != null) add("pluie_6min", r1(row.rr_per), "mm en 6 min");
  if (rain1h != null) add("pluie_1h", r1(rain1h), "mm en 1 h");
  if (row.pmer != null) add("pression_mer", r1(row.pmer / 100), "hPa");
  if (!readings.length) return null;
  return { station: { ...s, variables: readings.map((r) => r.variable) }, time: new Date(row.time), readings };
}

function iso(ms: number) {
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

async function slot(b: Bundle, start: number, now: number, s: Session): Promise<Cached<Row[]> | Error> {
  const date = iso(start);
  // Re-read every two minutes while the slot fills up; once final, a copy taken after that point stays good.
  const fresh = Math.max(RECHECK_SECONDS, (now - start - FINAL_AFTER_MS) / 1000);
  try {
    return await b.get(date, fresh, async () =>
      parseCsv(await download(`${BASE}?date=${date}&format=csv`, s, getText)),
    );
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

/** Rain over the hour ending with `time`, when all ten slots of that hour are there. */
function rainHour(byTime: Map<string, Row>, time: string): number | null {
  let sum = 0;
  for (let k = 0; k < 10; k++) {
    const rr = byTime.get(iso(Date.parse(time) - k * SLOT_MS))?.rr_per;
    if (rr == null) return null;
    sum += rr;
  }
  return sum;
}

export async function observations(cache: Cache, now = new Date()): Promise<Cached<Observation[]>> {
  const latest = Math.floor(now.getTime() / SLOT_MS) * SLOT_MS;
  const s = session(SOURCE.id);
  const b = await cache.bundle(BUNDLE, SYNC_SECONDS);
  const got = await Promise.all(Array.from({ length: SLOTS }, (_, k) => slot(b, latest - k * SLOT_MS, now.getTime(), s)));
  const oldest = iso(latest - (SLOTS - 1) * SLOT_MS);
  b.drop((date) => date >= oldest);
  await b.save();
  const ok = got.filter((g): g is Cached<Row[]> => !(g instanceof Error));
  if (!ok.length) throw got[0];

  const byStation = new Map<string, Map<string, Row>>();
  for (const g of ok) for (const row of g.value) {
    if (!byStation.has(row.id)) byStation.set(row.id, new Map());
    byStation.get(row.id)!.set(row.time, row);
  }
  const value: Observation[] = [];
  for (const byTime of byStation.values()) {
    const newest = [...byTime.values()].reduce((a, b) => (b.time > a.time ? b : a));
    const o = observation(newest, rainHour(byTime, newest.time));
    if (o) value.push(o);
  }
  // Stale when the newest slot with data could not be refreshed.
  const newestSlot = ok.find((g) => g.value.length) ?? ok[0];
  return {
    value,
    fetchedAt: new Date(Math.max(...ok.map((g) => g.fetchedAt.getTime()))),
    stale: newestSlot.stale,
  };
}
