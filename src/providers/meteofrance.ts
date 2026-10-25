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

// The hourly package of the 974: every station's last days hour by hour in one call (about 900 kB of CSV), an hour
// being in it about 10 minutes after it ends (measured 25/10/2026). Kept in the same bundle as each station's rain
// over the last hours only, and asked again only once the next hour should be in it.
const HOURLY = "horaire";
const HOURLY_URL = "https://public-api.meteofrance.fr/public/DPPaquetObs/v2/paquet/horaire?id-departement=974&format=csv";
const HOUR_MS = 3_600_000;
const HOURLY_IN_MS = 15 * 60_000;
const HOURLY_RECHECK_SECONDS = 5 * 60;
export const HOURS_KEPT = 24;

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

/**
 * Each station's rain hour by hour. `end` is the end of the newest hour, as Météo-France dates its hourly values:
 * `rr[id][k]` is the rain from end − (k + 1) h to end − k h, null when the station did not report it.
 */
export interface HourlyRain {
  end: string;
  rr: Record<string, (number | null)[]>;
}

/**
 * The stations' hourly rain (rr1) over the HOURS_KEPT hours up to the newest one in the package, at most `newest`.
 * The package holds several days: each line is only looked at for its time, and only its station and its rain are
 * read when it is wanted, since a regex or a split of the whole of it takes the Worker's CPU time of a request.
 */
export function parseHourly(csv: string, newest: number): HourlyRain {
  const head = csv.slice(0, csv.indexOf("\n")).trim().split(";");
  const [id, time, rr1] = ["geo_id_insee", "validity_time", "rr1"].map((c) => head.indexOf(c));
  let end = Math.floor(newest / HOUR_MS) * HOUR_MS;
  while (end > newest - 6 * HOUR_MS && !csv.includes(`;${iso(end)};`)) end -= HOUR_MS;
  const hours = new Map(Array.from({ length: HOURS_KEPT }, (_, k) => [iso(end - k * HOUR_MS), k]));
  const rr: HourlyRain["rr"] = {};
  const last = Math.max(id, rr1) + 1;
  for (let from = csv.indexOf("\n") + 1; from > 0 && from < csv.length; ) {
    let to = csv.indexOf("\n", from);
    if (to < 0) to = csv.length;
    // The start of each field: up to the time on every line, up to the rain on the wanted ones only.
    const at = [from];
    for (let n = 1; n <= time + 1; n++) at.push(csv.indexOf(";", at[n - 1]) + 1);
    const k = hours.get(csv.slice(at[time], at[time] + 20));
    if (k != null) {
      for (let n = at.length; n <= last; n++) at.push(csv.indexOf(";", at[n - 1]) + 1);
      const station = csv.slice(at[id], at[id + 1] - 1);
      const value = at[rr1 + 1] > 0 && at[rr1 + 1] <= to + 1 ? csv.slice(at[rr1], at[rr1 + 1] - 1) : "";
      if (station.startsWith("974")) {
        rr[station] ??= Array(HOURS_KEPT).fill(null);
        // The two airports write -0.1 now and then: no rain counted.
        if (value) rr[station][k] = Math.max(0, Number(value));
      }
    }
    from = to + 1;
  }
  return { end: iso(end), rr };
}

/** The rain of the last hours: every station's hour by hour, and a station's 6-minute slots since the newest hour. */
export interface RecentRain {
  hourly: HourlyRain;
  /** The station's slots after `hourly.end` that are there, newest first. */
  slots(id: string): { time: string; rr: number | null }[];
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
