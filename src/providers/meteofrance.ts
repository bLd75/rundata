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
import type { Observation, Reading, Station } from "../types.js";
import { download, session, type Session } from "./mf-auth.js";
import { SOURCE, STATIONS_974, VEILLE, type Veille } from "./meteofrance-stations.js";

export { SOURCE, VEILLE, type Veille } from "./meteofrance-stations.js";

const BASE = "https://public-api.meteofrance.fr/public/DPPaquetObs/v2/paquet/stations/infrahoraire-6m";
const SLOT_MS = 6 * 60_000;
const FINAL_AFTER_MS = 15 * 60_000; // a slot no longer changes after this
const RECHECK_SECONDS = 2 * 60;
// Slots read per question: enough for the newest row of each station and the nine before it (rain over an hour).
const SLOTS = 11;
// The slots are kept together, one read and one write of the Worker's edge cache instead of eleven of each.
const BUNDLE = "meteofrance:6min";
const SYNC_SECONDS = 60;

// The hourly package of the 974: every station's last days hour by hour in one call (about 900 kB of CSV), an hour
// being in it about 10 minutes after it ends (measured 25/10/2026). Kept in the same bundle as each station's rain
// over the last hours only, and asked again only once the next hour should be in it.
const HOURLY = "horaire";
const HOURLY_URL = "https://public-api.meteofrance.fr/public/DPPaquetObs/v2/paquet/horaire?id-departement=974&format=csv";
const HOUR_MS = 3_600_000;
const HOURLY_IN_MS = 15 * 60_000;
const HOURLY_RECHECK_SECONDS = 5 * 60;
export const HOURS_KEPT = 24;

export { configure, enabled, share, KV_KEY as TOKEN_KV_KEY, type Credentials, type Token } from "./mf-auth.js";

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

/**
 * Each station's rain hour by hour. `end` is the end of the newest hour, as Météo-France dates its hourly values:
 * `rr[id][k]` is the rain from end − (k + 1) h to end − k h, null when the station did not report it.
 * `mesures[id]`: the rest of each hour, same order (the value at the hour's end, the wind averaged over its last 10
 * minutes, the strongest gust within it); absent from a copy saved before it was kept.
 */
export interface HourlyRain {
  end: string;
  rr: Record<string, (number | null)[]>;
  mesures?: Record<string, HourlyMeasures>;
}

/**
 * One station's hours, newest first: °C, %, degrees the wind comes from, km/h, km/h, hPa, minutes of sunshine; null
 * when not reported. `ins` is absent from a copy saved before it was kept, and null at the stations without a sunshine
 * recorder.
 */
export interface HourlyMeasures {
  t: (number | null)[];
  u: (number | null)[];
  dd: (number | null)[];
  ff: (number | null)[];
  raf: (number | null)[];
  pmer: (number | null)[];
  ins?: (number | null)[];
}

// The columns kept besides the rain, how each becomes the unit of HourlyMeasures, and its column when named otherwise.
const HOURLY_MEASURES: [keyof HourlyMeasures, (v: number) => number, string?][] = [
  ["t", celsius], ["u", Math.round], ["dd", Math.round], ["ff", kmh], ["raf", kmh], ["pmer", (pa) => r1(pa / 100)], ["ins", Math.round, "insolh"],
];

/**
 * The stations' hourly rain (rr1) and measures over the HOURS_KEPT hours up to the newest one in the package, at most
 * `newest`.
 */
export function parseHourly(csv: string, newest: number): HourlyRain {
  let end = Math.floor(newest / HOUR_MS) * HOUR_MS;
  while (end > newest - 6 * HOUR_MS && !csv.includes(`;${iso(end)};`)) end -= HOUR_MS;
  const hours = new Map(Array.from({ length: HOURS_KEPT }, (_, k) => [iso(end - k * HOUR_MS), k]));
  const rr: HourlyRain["rr"] = {};
  const mesures: Record<string, HourlyMeasures> = {};
  const none = () => Array<number | null>(HOURS_KEPT).fill(null);
  scanHours(csv, hours, ["rr1", ...HOURLY_MEASURES.map(([c, , col]) => col ?? c)], (station, k, [value, ...rest]) => {
    rr[station] ??= none();
    // The two airports write -0.1 now and then: no rain counted.
    if (value) rr[station][k] = Math.max(0, Number(value));
    const m = (mesures[station] ??= { t: none(), u: none(), dd: none(), ff: none(), raf: none(), pmer: none(), ins: none() });
    HOURLY_MEASURES.forEach(([c, unit], i) => {
      if (rest[i] && Number.isFinite(Number(rest[i]))) m[c]![k] = unit(Number(rest[i]));
    });
  });
  return { end: iso(end), rr, mesures };
}

/**
 * Each Réunion line of the hourly package whose time is one of `hours`: its station, the index of its hour, and the
 * text of the columns `cols` ("" when empty). Each line is only looked at up to its time, and read further only when
 * it is wanted, since a regex or a split of the whole of it takes the Worker's CPU time of a request.
 */
function scanHours(csv: string, hours: Map<string, number>, cols: string[], each: (station: string, k: number, values: string[]) => void) {
  const head = csv.slice(0, csv.indexOf("\n")).trim().split(";");
  const [id, time] = ["geo_id_insee", "validity_time"].map((c) => head.indexOf(c));
  const wanted = cols.map((c) => head.indexOf(c));
  const last = Math.max(id, ...wanted) + 1;
  for (let from = csv.indexOf("\n") + 1; from > 0 && from < csv.length; ) {
    let to = csv.indexOf("\n", from);
    if (to < 0) to = csv.length;
    // The start of each field: up to the time on every line, up to the last column wanted on the wanted ones only.
    const at = [from];
    for (let n = 1; n <= time + 1; n++) at.push(csv.indexOf(";", at[n - 1]) + 1);
    const k = hours.get(csv.slice(at[time], at[time] + 20));
    if (k != null) {
      for (let n = at.length; n <= last; n++) at.push(csv.indexOf(";", at[n - 1]) + 1);
      const station = csv.slice(at[id], at[id + 1] - 1);
      if (station.startsWith("974")) {
        // The line's last field has no ";" after it: it ends with the line.
        const end = (c: number) => (at[c + 1] > 0 && at[c + 1] <= to + 1 ? at[c + 1] - 1 : c === head.length - 1 ? to : -1);
        each(station, k, wanted.map((c) => (c >= 0 && end(c) >= 0 ? csv.slice(at[c], end(c)).trim() : "")));
      }
    }
    from = to + 1;
  }
}

/** The day `jour` (YYYY-MM-DD at La Réunion, UTC+4) at each station: only what it measured every hour of the 24. */
export function parseDay(csv: string, jour: string): Veille {
  // Météo-France dates an hour by its end: the day's first hour ends at 01:00, 21:00 UTC the day before.
  const start = Date.parse(`${jour}T00:00:00Z`) - 4 * HOUR_MS;
  const hours = new Map(Array.from({ length: 24 }, (_, k) => [iso(start + (k + 1) * HOUR_MS), k]));
  const got = new Map<string, { rr: (number | null)[]; tn: (number | null)[]; tx: (number | null)[] }>();
  scanHours(csv, hours, ["rr1", "tn", "tx"], (station, k, [rr, tn, tx]) => {
    let s = got.get(station);
    if (!s) got.set(station, (s = { rr: Array(24).fill(null), tn: Array(24).fill(null), tx: Array(24).fill(null) }));
    // The two airports write -0.1 now and then: no rain counted.
    if (rr) s.rr[k] = Math.max(0, Number(rr));
    if (tn) s.tn[k] = Number(tn);
    if (tx) s.tx[k] = Number(tx);
  });
  const all = (xs: (number | null)[]): xs is number[] => xs.every((x) => x != null && Number.isFinite(x));
  const stations: Veille["stations"] = {};
  for (const [id, s] of got) {
    const v = {
      ...(all(s.rr) && { rr: r1(s.rr.reduce((a, b) => a + b, 0)) }),
      ...(all(s.tn) && { tn: celsius(Math.min(...s.tn)) }),
      ...(all(s.tx) && { tx: celsius(Math.max(...s.tx)) }),
    };
    if (Object.keys(v).length) stations[id] = v;
  }
  return { jour, complet: csv.includes(`;${iso(start + 24 * HOUR_MS)};`), stations };
}

/** The passes that keep the day before: 00:20 at La Réunion (20:20 UTC), and 00:35 when its last hour was not out yet. */
export function veilleDue(now: Date): boolean {
  const m = now.getUTCMinutes();
  return now.getUTCHours() === 20 && ((m >= 20 && m < 25) || (m >= 35 && m < 40));
}

/** At a pass of `veilleDue`: the day that just ended, read from the hourly package and kept, unless kept whole already. */
export async function keepVeille(cache: Cache, now = new Date()): Promise<Veille | undefined> {
  const jour = iso(now.getTime() + 4 * HOUR_MS - 24 * HOUR_MS).slice(0, 10);
  if (now.getUTCMinutes() >= 35) {
    const kept = (await cache.kept<Veille>(VEILLE))?.value;
    if (kept?.jour === jour && kept.complet) return undefined;
  }
  const v = parseDay(await download(HOURLY_URL, session(SOURCE.id), getText), jour);
  await cache.keep(VEILLE, v);
  return v;
}

/** The rain of the last hours: every station's hour by hour, and a station's 6-minute slots since the newest hour. */
export interface RecentRain {
  hourly: HourlyRain;
  /** The station's slots after `hourly.end` that are there, newest first. */
  slots(id: string): { time: string; rr: number | null }[];
}

/** One hour of a station: `fin` ends it, the measures are null when not reported or not yet kept. */
export interface StationHour {
  fin: string;
  rr: number | null;
  t: number | null;
  u: number | null;
  dd: number | null;
  ff: number | null;
  raf: number | null;
  pmer: number | null;
  /** Minutes of sunshine in the hour. */
  ins: number | null;
}

/** A station's kept hours, newest first; empty when the package has none of it. */
export function stationHours(hourly: HourlyRain, id: string): StationHour[] {
  const rr = hourly.rr[id];
  if (!rr) return [];
  const m = hourly.mesures?.[id];
  const end = Date.parse(hourly.end);
  return rr.map((r, k) => ({
    fin: iso(end - k * HOUR_MS),
    rr: r,
    t: m?.t[k] ?? null,
    u: m?.u[k] ?? null,
    dd: m?.dd[k] ?? null,
    ff: m?.ff[k] ?? null,
    raf: m?.raf[k] ?? null,
    pmer: m?.pmer[k] ?? null,
    ins: m?.ins?.[k] ?? null,
  }));
}

/** Undefined when the hourly package cannot be read. Call after `observations`, whose bundle it reads again without I/O. */
export async function recentRain(cache: Cache, now = new Date()): Promise<RecentRain | undefined> {
  const b = await cache.bundle(BUNDLE, SYNC_SECONDS);
  // Complete once it holds the newest hour that should be published: kept until the next one is due.
  const due = Math.floor((now.getTime() - HOURLY_IN_MS) / HOUR_MS) * HOUR_MS;
  const have = b.peek(HOURLY)?.value as HourlyRain | undefined;
  const fresh = have && Date.parse(have.end) >= due ? (2 * HOUR_MS) / 1000 : HOURLY_RECHECK_SECONDS;
  let hourly: HourlyRain;
  try {
    hourly = (await b.get(HOURLY, fresh, async () => parseHourly(await download(HOURLY_URL, session(SOURCE.id), getText), now.getTime()))).value;
    await b.save();
  } catch (err) {
    console.error("pluie heure par heure indisponible", err instanceof Error ? err.message : String(err));
    return undefined;
  }
  const latest = Math.floor(now.getTime() / SLOT_MS) * SLOT_MS;
  return {
    hourly,
    slots: (id) => {
      const out: { time: string; rr: number | null }[] = [];
      for (let t = latest; t > Date.parse(hourly.end); t -= SLOT_MS) {
        const row = (b.peek(iso(t))?.value as Row[] | undefined)?.find((r) => r.id === id);
        if (row) out.push({ time: row.time, rr: row.rr_per });
      }
      return out;
    },
  };
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
  b.drop((key) => key === HOURLY || key >= oldest);
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

