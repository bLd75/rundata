/**
 * Forecasts of Météo-France's AROME outre-mer model for the Indian Ocean (0.025°, about 2.5 km), from the AROME
 * WCS API of portail-api.meteofrance.fr (same application and OAuth token as the observations).
 *
 * The API only hands out two-dimensional slices: one request is one field at one time over the whole island
 * (27 × 23 points, an 8 KB GeoTIFF). Each 3-hour step takes five of them; they serve every place on the island
 * until the next run, so the cache holds grids, not places: all the grids of a run are kept as one bundle, in the
 * Worker's KV, filled by a scheduled prefetch (src/worker.ts) so that questions rarely download any. Runs start at
 * 0, 6, 12 and 18 h UTC and reach 48 h; on 22/10/2026 at 10:00 the newest one listed was the 18 h UTC run of the
 * day before.
 *
 * A run is listed before all its hours are out: at 11:20 on 22/10/2026 the 0 h UTC run answered for 09:00 UTC and
 * 404 from the next day on. The first hour found missing is kept in the run's bundle for a while, the hours after it
 * are not asked for meanwhile, and the previous run, complete, answers for them.
 *
 * No terrain height is published: it is worked out once from surface and sea-level pressure, and temperatures
 * are brought from the model's (smoothed) terrain to the place's altitude, 0.65 °C per 100 m.
 *
 * The cloud base and top are published as pressures (Pa, 0 where the cell has no cloud): they give the altitude of the
 * cloud sea of the Hauts, read at the place's own cell (an average of a cloudy cell and a clear one means nothing).
 */
import { left } from "../budget.js";
import type { Bundle, Cache } from "../cache.js";
import { getBytes, getText } from "../http.js";
import type { Place } from "../places/resolve.js";
import { readTiff } from "../tiff.js";
import { UpstreamError, why, type Forecast, type ForecastHour, type ForecastModel, type SourceInfo } from "../types.js";
import { download, enabled, session, type Session } from "./mf-auth.js";

export { enabled };

export const SOURCE: SourceInfo = {
  id: "arome",
  nom: "Prévisions du modèle AROME outre-mer (Météo-France)",
  organisme: "Météo-France",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Météo-France",
  url: "https://portail-api.meteofrance.fr/web/fr/api/AROME",
};

export const MODEL: ForecastModel = {
  nom: "AROME outre-mer de Météo-France",
  maille_km: 2.5,
  echeance_jours: 2,
  mise_a_jour: "4 calculs par jour, disponibles plusieurs heures après",
};

const BASE = "https://public-api.meteofrance.fr/public/arome/1.0/wcs/MF-NWP-HIGHRES-AROME-OM-0025-INDIEN-WCS";
const BBOX = "subset=long(55.2,55.85)&subset=lat(-21.4,-20.85)";
const HOUR = 3600_000;
export const STEP_H = 3;
const RANGE_H = 48;
/**
 * The run list (GetCapabilities) took 11 s to start answering on 22/10/2026 and timed out at 20 s from Cloudflare:
 * the scheduled prefetch refreshes it, with time to wait, into KV where every data center reads it; a question
 * asks for it itself only when it is much older, and then not for long.
 */
export interface RunListing {
  freshSeconds: number;
  timeoutMs: number;
}
export const FOR_QUESTIONS: RunListing = { freshSeconds: 60 * 60, timeoutMs: 20_000 };
export const FOR_PREFETCH: RunListing = { freshSeconds: 15 * 60, timeoutMs: 60_000 };
const RUNS = "arome:calculs";
// How often a process merges in the grids other processes (the scheduled prefetch) added to the run's bundle.
const BUNDLE_SYNC_SECONDS = 60;
const RELIEF = "relief";
// The first hour a run does not have yet (ISO), in that run's bundle; asked again once this old.
const FRONTIER = "manquant_a_partir_de";
const PENDING_RETRY_MS = 25 * 60_000;
/**
 * Grids downloaded per invocation at most: the API allows 100 requests a minute. Within that, the Worker's
 * subrequests left decide (budget.ts); steps not fetched yet are answered by the other model this time.
 */
export const MAX_NEW_GRIDS = 40;
const CONCURRENCY = 6;
// Subrequests kept aside while downloading grids: a token, a renewal, one retry per grid in flight, the save.
const SPARE = 3 + CONCURRENCY;
const LAPSE = 0.0065; // °C per metre
// Lightning flash density over the 3 hours above which the step says "orage". Not calibrated yet.
const STORM_DENSITY = 0.05;

type FieldName = "temperature" | "nuages" | "rafales" | "pluie" | "foudre" | "base" | "sommet";

// `at`: hours after the start of the step the field is read at. Accumulations (_PT3H) end at the step's end;
// gusts are the maximum of the hour before `at`.
const FIELDS: Record<FieldName, { id: string; suffix?: string; height?: number; at: number }> = {
  temperature: { id: "TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND", height: 2, at: 0 },
  nuages: { id: "TOTAL_CLOUD_COVER__GROUND_OR_WATER_SURFACE", at: 1 },
  rafales: { id: "WIND_SPEED_GUST__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND", height: 10, at: 2 },
  pluie: { id: "TOTAL_PRECIPITATION__GROUND_OR_WATER_SURFACE", suffix: "_PT3H", at: 3 },
  foudre: { id: "LIGHTNING_STRIKE_DENSITY__GROUND_OR_WATER_SURFACE", suffix: "_PT3H", at: 3 },
  base: { id: "PRESSURE__BASE_CLOUD", at: 1 },
  sommet: { id: "PRESSURE__LEVEL_OF_CLOUD_TOP", at: 1 },
};
const NAMES = Object.keys(FIELDS) as FieldName[];
const CORE = NAMES.filter((f) => f !== "base" && f !== "sommet");
// The cloud layer only for the steps of the morning, 6–9 h and 9–12 h in La Réunion: those the cloud sea is told of
// (tools/nuages.ts). Two steps a day of two grids more, rather than two more grids for every step.
const LAYER_HOURS = new Set([6, 9]);
const fieldsOf = (start: Date): FieldName[] => (LAYER_HOURS.has((start.getUTCHours() + 4) % 24) ? NAMES : CORE);

export interface Grid {
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  width: number;
  height: number;
  values: (number | null)[];
}

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");
/** "2026-10-21T18.00.00Z", as in the coverage ids. */
const stamp = (run: Date) => iso(run).replace(/:/g, ".");
const fromStamp = (s: string) => new Date(s.replace(/T(\d\d)\.(\d\d)\.(\d\d)Z$/, "T$1:$2:$3Z"));

export function parseGrid(tiff: ArrayBuffer | Uint8Array): Grid {
  const r = readTiff(tiff);
  return { ...r, values: r.values.map((v) => (v == null ? null : Math.round(v * 100) / 100)) };
}

/**
 * A grid as kept in the bundle: values as 16-bit integers in base64 (1.7 KB instead of about 3.5 KB of JSON
 * numbers), scaled so that the largest one fits, which keeps 0.01 °C or 0.02 mm. Decoding it is cheaper than
 * parsing numbers, and a Worker has little CPU time per invocation.
 */
export interface PackedGrid extends Omit<Grid, "values"> {
  scale: number;
  data: string;
}

const NO_VALUE = -32768;

export function pack(g: Grid): PackedGrid {
  const { values, ...rest } = g;
  let max = 1e-9;
  for (const v of values) if (v != null && Math.abs(v) > max) max = Math.abs(v);
  const scale = max / 32767;
  const ints = new Int16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    ints[i] = v == null ? NO_VALUE : Math.round(v / scale);
  }
  const bytes = new Uint8Array(ints.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { ...rest, scale, data: btoa(bin) };
}

export function unpack(p: PackedGrid): Grid {
  const { scale, data, ...rest } = p;
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ints = new Int16Array(bytes.buffer);
  return { ...rest, values: Array.from(ints, (v) => (v === NO_VALUE ? null : Math.round(v * scale * 100) / 100)) };
}

/** The runs listed in the capabilities (1.1 MB of XML, 35 KB compressed), newest first. */
export function listedRuns(capabilities: string): Date[] {
  const runs = [...capabilities.matchAll(/TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___(\d{4}-\d\d-\d\dT\d\d\.\d\d\.\d\dZ)</g)].map((m) => m[1]);
  return [...new Set(runs)].sort().reverse().map(fromStamp);
}

export function newestRun(capabilities: string): Date | undefined {
  return listedRuns(capabilities)[0];
}

/** The newest run and the one before it, which answers for the hours the newest has not published yet. */
async function latestRuns(cache: Cache, s: Session, l: RunListing): Promise<[Date, Date | undefined]> {
  const b = await cache.bundle(RUNS, BUNDLE_SYNC_SECONDS, true);
  try {
    // An old list, when the service does not answer, is served as it is: the runs it names are still there.
    const c = await b.get<string[]>("liste", l.freshSeconds, async () => {
      const runs = listedRuns(await download(`${BASE}/GetCapabilities?service=WCS&version=2.0.1&language=fre`, s, getText, l.timeoutMs));
      if (!runs.length) throw new UpstreamError(SOURCE.id, "aucun calcul dans la liste du service");
      return runs.slice(0, 2).map((r) => r.toISOString());
    });
    const [newest, previous] = c.value.map((r) => new Date(r));
    return [newest, previous];
  } catch (err) {
    throw new UpstreamError(SOURCE.id, `liste des calculs (GetCapabilities) : ${reason(err)}`);
  } finally {
    await b.save().catch((err) => console.error(`source ${SOURCE.id} : enregistrement impossible`, why(err)));
  }
}

/** An error's message without the source name in front, to say which request it was. */
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^arome: /, "");

/** The same error, saying which grid it was about. */
function about(err: unknown, what: string): UpstreamError {
  const status = err instanceof UpstreamError ? err.status : undefined;
  return new UpstreamError(SOURCE.id, `${what} : ${reason(err)}`, status);
}

function gridUrl(coverage: string, time: Date, height?: number) {
  const h = height == null ? "" : `&subset=height(${height})`;
  return `${BASE}/GetCoverage?service=WCS&version=2.0.1&coverageid=${coverage}&${BBOX}${h}&subset=time(${iso(time)})&format=image/tiff`;
}

export const bundleKey = (run: Date) => `arome:${iso(run)}`;
export const gridKey = (field: string, time: Date) => `${field}:${iso(time)}`;
const fieldTime = (field: FieldName, start: Date) => new Date(start.getTime() + FIELDS[field].at * HOUR);

// A run's grids never change: once in the bundle, they are good until the run is replaced.
function grid(b: Bundle, s: Session, run: Date, field: FieldName, start: Date) {
  const f = FIELDS[field];
  const time = fieldTime(field, start);
  const coverage = `${f.id}___${stamp(run)}${f.suffix ?? ""}`;
  return b.get(gridKey(field, time), Infinity, async () => {
    try {
      return pack(parseGrid(await download(gridUrl(coverage, time, f.height), s, getBytes)));
    } catch (err) {
      throw about(err, `grille ${field} de ${iso(time)}, calcul de ${iso(run)}`);
    }
  });
}

/** Model terrain height from the hypsometric equation, iterated for the mean temperature of the layer. */
export function relief(ps: Grid, pmsl: Grid, t2m: Grid): Grid {
  const values = ps.values.map((p, k) => {
    const m = pmsl.values[k];
    const t = t2m.values[k];
    if (p == null || m == null || t == null) return null;
    let z = 0;
    for (let i = 0; i < 3; i++) z = ((287.05 * (t + 273.15 + (LAPSE * z) / 2)) / 9.80665) * Math.log(m / p);
    return Math.round(Math.max(0, z));
  });
  return { ...ps, values };
}

// The terrain is the same for every run: taken from another run's bundle when there, else worked out from `run`.
async function reliefGrid(b: Bundle, s: Session, run: Date, other?: Bundle): Promise<Grid> {
  const copy = !b.has(RELIEF) ? other?.peek(RELIEF) : undefined;
  if (copy) b.set(RELIEF, copy.value);
  const c = await b.get<PackedGrid>(RELIEF, Infinity, async () => {
    const get = async (id: string, height?: number) => {
      try {
        return parseGrid(await download(gridUrl(`${id}___${stamp(run)}`, run, height), s, getBytes));
      } catch (err) {
        throw about(err, `relief (${id}), calcul de ${iso(run)}`);
      }
    };
    const [ps, pmsl, t2m] = await Promise.all([
      get("PRESSURE__GROUND_OR_WATER_SURFACE"),
      get("PRESSURE__MEAN_SEA_LEVEL"),
      get(FIELDS.temperature.id, 2),
    ]);
    return pack(relief(ps, pmsl, t2m));
  });
  return unpack(c.value);
}

async function pool<T>(tasks: (() => Promise<T>)[], size: number): Promise<PromiseSettledResult<T>[]> {
  const out: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return out;
}

/** The grids for the steps asked, ready to be read at any place; each step from the newest run that has it. */
export interface AromeData {
  /** Run of the first step. */
  run: Date;
  relief: Grid;
  steps: { start: Date; run: Date; grids: Record<FieldName, Grid | null> }[];
  /** Steps that were asked for and are out, but left for later (over the download budget). */
  later: number;
}

/** Whether the 3-hour step starting at `start` is within a run that started at `run`. */
export function inRun(run: Date, start: Date): boolean {
  const h = (start.getTime() - run.getTime()) / HOUR;
  return h >= 0 && h + STEP_H <= RANGE_H;
}

/**
 * Downloads what the steps asked for need, in the order given (most useful first), within what the invocation
 * may still fetch once `reserve` subrequests are set aside for the caller's other sources. Each step comes from the
 * newest run if it has published it (and it fits the budget), else from the run before.
 * Null when AROME is not configured or covers none of them.
 */
export async function prepare(cache: Cache, starts: Date[], reserve = 0, listing = FOR_QUESTIONS): Promise<AromeData | null> {
  if (!enabled()) return null;
  const s = session(SOURCE.id);
  const [newest, previous] = await latestRuns(cache, s, listing);
  const usable = starts.filter((t) => inRun(newest, t) || (previous && inRun(previous, t)));
  if (!usable.length) return null;
  const nb = await cache.bundle(bundleKey(newest), BUNDLE_SYNC_SECONDS, true);
  const pb = previous && (await cache.bundle(bundleKey(previous), BUNDLE_SYNC_SECONDS, true));
  const runs = [{ run: newest, b: nb }, ...(previous && pb ? [{ run: previous, b: pb }] : [])];
  // The terrain comes from the other bundle or from the run before, whose first hour is out for sure.
  const reliefFrom = runs[runs.length - 1];
  const hasRelief = nb.has(RELIEF) || !!pb?.has(RELIEF);

  const known = nb.peek(FRONTIER);
  let frontier = known && known.ageMs < PENDING_RETRY_MS ? Date.parse(known.value as string) : Infinity;
  let found = frontier; // first hour of the newest run found missing in this invocation
  const published = (run: Date, t: Date) => run !== newest || t.getTime() + STEP_H * HOUR < frontier;
  const missing = (b: Bundle, t: Date) => fieldsOf(t).filter((f) => !b.has(gridKey(f, fieldTime(f, t)))).length;

  const fetchGrid = async (run: Date, b: Bundle, f: FieldName, t: Date): Promise<Grid | null> => {
    const time = fieldTime(f, t).getTime();
    if (run === newest && time >= found) return null; // not out yet, as another grid just said
    if (!b.has(gridKey(f, fieldTime(f, t)))) downloads++;
    try {
      return unpack((await grid(b, s, run, f, t)).value);
    } catch (err) {
      if (run !== newest || !(err instanceof UpstreamError && err.status === 404)) throw err;
      found = Math.min(found, time);
      return null;
    }
  };

  const got = new Map<number, AromeData["steps"][number]>();
  let downloads = 0;
  // Never below none: a step whose grids are all in the bundle costs nothing, whatever is left.
  const allowed = () => Math.max(0, Math.min(MAX_NEW_GRIDS - downloads, left() - reserve - SPARE - (hasRelief ? 0 : 3)));
  let budget = allowed();
  let reliefValue: Grid | undefined;
  try {
    // A second round when the first finds the newest run shorter than thought: the run before fills in.
    for (let round = 0; round < 2; round++) {
      const chosen: { start: Date; run: Date; b: Bundle }[] = [];
      for (const t of usable.filter((t) => !got.has(t.getTime()))) {
        const pick = runs.find(({ run, b }) => inRun(run, t) && published(run, t) && missing(b, t) <= budget);
        if (!pick) break; // keep the steps contiguous: no hole in the middle of a day
        budget -= missing(pick.b, t);
        chosen.push({ start: t, ...pick });
      }
      if (!chosen.length && !got.size && !hasRelief) return null; // no step this time: not even the terrain is worth fetching
      const tasks = chosen.flatMap((c) => fieldsOf(c.start).map((f) => () => fetchGrid(c.run, c.b, f, c.start)));
      const [results, r] = await Promise.all([pool(tasks, CONCURRENCY), reliefValue ?? reliefGrid(reliefFrom.b, s, reliefFrom.run, nb)]);
      reliefValue = r;
      const carried = !nb.has(RELIEF) && reliefFrom.b.peek(RELIEF);
      if (carried) nb.set(RELIEF, carried.value); // so that it is there when this run is the one before
      const failed = results.find((x) => x.status === "rejected");
      if (failed) console.error(`source ${SOURCE.id} : grille indisponible`, why((failed as PromiseRejectedResult).reason));
      let next = 0;
      chosen.forEach((c) => {
        const grids = Object.fromEntries(NAMES.map((f) => [f, null])) as Record<FieldName, Grid | null>;
        for (const f of fieldsOf(c.start)) {
          const x = results[next++];
          grids[f] = x.status === "fulfilled" ? x.value : null;
        }
        // A step of the newest run cut by a missing hour is left to the run before.
        if (c.run === newest && c.start.getTime() + STEP_H * HOUR >= found) return;
        got.set(c.start.getTime(), { start: c.start, run: c.run, grids });
      });
      if (found >= frontier) break;
      frontier = found;
      nb.set(FRONTIER, new Date(found).toISOString());
      console.log(`source ${SOURCE.id} : calcul de ${iso(newest)} pas encore publié à partir de ${iso(new Date(found))}`);
      budget = allowed(); // the grids skipped as not out yet cost nothing
    }
  } finally {
    await Promise.all(runs.map(({ b }) => b.save().catch((err) => console.error(`source ${SOURCE.id} : enregistrement impossible`, why(err)))));
  }
  const steps = [...got.values()].sort((a, b) => a.start.getTime() - b.start.getTime()).filter((st) => st.grids.temperature);
  if (!reliefValue) return null;
  // Hours the newest run has not published and the run before does not reach are not "for later": nobody has them.
  const reachable = (t: Date) => runs.some(({ run }) => inRun(run, t) && published(run, t));
  return { run: steps[0]?.run ?? newest, relief: reliefValue, steps, later: usable.filter((t) => !got.has(t.getTime()) && reachable(t)).length };
}

/** Bilinear interpolation; `adjust` corrects each corner (by its terrain height) before weighting. */
function at(g: Grid, lon: number, lat: number, adjust?: (v: number, k: number) => number): number | null {
  const x = Math.min(Math.max((lon - g.x0) / g.dx, 0), g.width - 1);
  const y = Math.min(Math.max((g.y0 - lat) / g.dy, 0), g.height - 1);
  const i = Math.min(Math.floor(x), g.width - 2);
  const j = Math.min(Math.floor(y), g.height - 2);
  const fx = x - i;
  const fy = y - j;
  let sum = 0;
  let weight = 0;
  for (const [di, dj, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const k = (j + dj) * g.width + i + di;
    const v = g.values[k];
    if (v == null || w === 0) continue;
    sum += w * (adjust ? adjust(v, k) : v);
    weight += w;
  }
  return weight ? sum / weight : null;
}

/** WMO weather code of a step, as the tool reads codes from Open-Meteo. AROME has no such field. */
export function weatherCode(rainMm: number | null, cloudPct: number | null, lightning: number | null): number | null {
  if (lightning != null && lightning > STORM_DENSITY) return 95;
  if (rainMm != null && rainMm >= 0.3) return rainMm < 2.5 ? 61 : rainMm < 10 ? 63 : 65;
  if (cloudPct == null) return null;
  return cloudPct < 20 ? 0 : cloudPct < 50 ? 1 : cloudPct < 80 ? 2 : 3;
}

const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

// The standard atmosphere's height of a pressure, from a sea level at 1017 hPa and 25 °C, La Réunion's usual: within
// a few tens of metres of the hypsometric height up to 3 000 m, finer than the 100 m the altitudes are given to.
const SEA_LEVEL_PA = 101_700;
const SEA_LEVEL_K = 298.15;

/** The altitude (m) of a pressure (Pa) in the cloud fields, or null for 0, the cell without cloud. */
export function cloudAltitude(pa: number | null): number | null {
  if (pa == null || pa <= 0) return null;
  return Math.round((SEA_LEVEL_K / LAPSE) * (1 - Math.pow(pa / SEA_LEVEL_PA, (287.05 * LAPSE) / 9.80665)));
}

/** The cloud base and top over a cell, in metres; the top only when it is above the base (the fields disagree at times). */
export function cloudLayer(base: number | null, top: number | null): { base: number | null; top: number | null } {
  const b = cloudAltitude(base);
  const t = cloudAltitude(top);
  return { base: b, top: b != null && t != null && t > b ? t : null };
}

export function atPlace(d: AromeData, place: Place): Forecast {
  const z = at(d.relief, place.lon, place.lat);
  const g = d.relief;
  const i = Math.round((place.lon - g.x0) / g.dx);
  const j = Math.round((g.y0 - place.lat) / g.dy);
  const cell = (grid: Grid | null) => (grid && i >= 0 && j >= 0 && i < grid.width && j < grid.height ? grid.values[j * grid.width + i] : null);
  const altitude = place.altitude_m ?? (z == null ? null : Math.round(z));
  const suite: NonNullable<Forecast["suite"]> = [];
  d.steps.forEach((st, i) => {
    if (i > 0 && st.run.getTime() !== d.steps[i - 1].run.getTime()) suite.push({ runAt: st.run, from: st.start });
  });
  const hours: ForecastHour[] = d.steps.map(({ start, grids }) => {
    const read = (f: FieldName, adjust?: (v: number, k: number) => number) => {
      const g = grids[f];
      return g ? at(g, place.lon, place.lat, adjust) : null;
    };
    const temperature = read("temperature", (v, k) => {
      const zc = d.relief.values[k];
      return altitude == null || zc == null ? v : v + LAPSE * (zc - altitude);
    });
    const pluie = read("pluie");
    const nuages = read("nuages");
    const gust = read("rafales");
    const rain = pluie == null ? null : Math.max(0, r1(pluie)!);
    const layer = cloudLayer(cell(grids.base), cell(grids.sommet));
    return {
      time: start,
      duree_h: STEP_H,
      temperature: r1(temperature),
      pluie_mm: rain,
      code: weatherCode(rain, nuages, read("foudre")),
      nuages_pct: nuages == null ? null : Math.round(Math.min(100, Math.max(0, nuages))),
      vent_kmh: null,
      rafales_kmh: gust == null ? null : Math.round(gust * 3.6),
      vent_dir: null,
      ...(grids.base ? { nuages_base_m: layer.base, nuages_sommet_m: layer.top } : {}),
      modele: MODEL,
    };
  });
  return {
    model: MODEL,
    source: SOURCE,
    runAt: d.run,
    suite: suite.length ? suite : undefined,
    grid: { lat: Math.round((g.y0 - j * g.dy) * 1000) / 1000, lon: Math.round((g.x0 + i * g.dx) * 1000) / 1000 },
    altitude_m: altitude ?? 0,
    relief_m: z == null ? undefined : Math.round(z),
    hours,
    days: [],
  };
}
