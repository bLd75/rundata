/**
 * How much the 51 scenarios of the ECMWF ensemble (ENS, 0.25°) agree on each day, served by Open-Meteo's ensemble
 * API. No key; free API for non-commercial use. It says how sure a forecast can be, not what the weather will be:
 * the forecast shown stays AROME's or the IFS's (openmeteo.ts).
 *
 * The island holds in six cells of the 0.25° grid (about 25 km): one request, kept three hours, answers for every
 * place, each taking the nearest cell, as Open-Meteo would. A coastal town may fall in a mountain cell (Saint-Denis
 * shares the Piton des Neiges' cell), so the cell's own rain is never given as the place's: only how far apart the
 * scenarios are. Temperatures are brought to each cell's height, which leaves their spread as it is.
 *
 * Questions only read the copy, which the scheduled event keeps for every data center (web/partagees.ts): the
 * index costs an answer one read at most, never a fetch. A question with no copy yet goes without the index.
 */
import { later, left } from "../budget.js";
import type { Cache } from "../cache.js";
import { distanceKm } from "../geo.js";
import { getJson } from "../http.js";
import { type SourceInfo, UpstreamError, why } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "openmeteo_ens",
  nom: "Ensemble de prévisions du Centre européen (ECMWF ENS, 51 scénarios), via Open-Meteo",
  organisme: "ECMWF (données ouvertes ENS), diffusé par Open-Meteo",
  licence: "CC BY 4.0 (ECMWF et Open-Meteo) ; API Open-Meteo gratuite réservée aux usages non commerciaux",
  attribution: "Weather data by Open-Meteo.com <https://open-meteo.com/> ; ensemble ENS, ECMWF",
  url: "https://open-meteo.com/en/docs/ensemble-api",
};

export const MODEL = { nom: "ENS du Centre européen (ECMWF)", maille_km: 25, membres: 51 };

const API = "https://ensemble-api.open-meteo.com/v1/ensemble";
const META = "https://ensemble-api.open-meteo.com/data/ecmwf_ifs025_ensemble/static/meta.json";
const FRESH_SECONDS = 3 * 3600; // a new run every 6 to 12 hours, out some 10 hours after it starts
const TIMEOUT_MS = 5_000; // it answers in 2 s, or not at all: then once more, if the invocation can afford it
/** Past this age from its start, the run says nothing more about the days: no index. */
export const MAX_RUN_AGE_H = 24;
// The cells of the 0.25° grid that hold the island.
const CELLS = [-21.0, -21.25].flatMap((lat) => [55.25, 55.5, 55.75].map((lon) => ({ lat, lon })));
const DAILY = ["temperature_2m_max", "precipitation_sum", "wind_gusts_10m_max"];

type Series = (number | null)[];

interface EnsJson {
  latitude: number;
  longitude: number;
  daily: { time: string[] } & Record<string, Series | string[]>;
}

interface MetaJson {
  last_run_initialisation_time: number;
}

/** A day of one cell: the 10th, 50th and 90th percentiles of the members, and how many give heavy rain. */
export interface EnsDay {
  date: string;
  tmax: [number, number];
  pluie: [number, number, number];
  /** Members with HEAVY_MM of rain or more. */
  fortes: number;
  membres: number;
  rafales: [number, number];
}

export interface EnsCell {
  lat: number;
  lon: number;
  days: EnsDay[];
}

export interface Ensemble {
  /** Start of the run, epoch ms. */
  runAt: number;
  cells: EnsCell[];
}

function url(): string {
  const q = new URLSearchParams({
    latitude: CELLS.map((c) => c.lat).join(","),
    longitude: CELLS.map((c) => c.lon).join(","),
    models: "ecmwf_ifs025",
    daily: DAILY.join(","),
    timezone: "Indian/Reunion",
    forecast_days: "7",
  });
  return `${API}?${q}`;
}

/** Linear between the two nearest ranks, of sorted values. */
function pct(sorted: number[], p: number): number {
  const k = (sorted.length - 1) * p;
  const i = Math.floor(k);
  const v = sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (k - i);
  return Math.round(v * 10) / 10;
}

const HEAVY_MM = 20;

/** The members of a daily variable: the control run under its own name, then `_member01` to `_member50`. */
function members(d: EnsJson["daily"], name: string, i: number): number[] {
  const out: number[] = [];
  for (const k of Object.keys(d)) {
    if (k !== name && !k.startsWith(`${name}_member`)) continue;
    const v = (d[k] as Series)[i];
    if (typeof v === "number") out.push(v);
  }
  return out.sort((a, b) => a - b);
}

export function parse(raw: EnsJson | EnsJson[], runAt: number): Ensemble {
  const cells = (Array.isArray(raw) ? raw : [raw]).map((j) => ({
    lat: j.latitude,
    lon: j.longitude,
    days: j.daily.time.flatMap((date, i): EnsDay[] => {
      const t = members(j.daily, "temperature_2m_max", i);
      const r = members(j.daily, "precipitation_sum", i);
      const g = members(j.daily, "wind_gusts_10m_max", i);
      if (t.length < 10 || r.length < 10 || g.length < 10) return [];
      return [{
        date,
        tmax: [pct(t, 0.1), pct(t, 0.9)],
        pluie: [pct(r, 0.1), pct(r, 0.5), pct(r, 0.9)],
        fortes: r.filter((x) => x >= HEAVY_MM).length,
        membres: r.length,
        rafales: [Math.round(pct(g, 0.1)), Math.round(pct(g, 0.9))],
      }];
    }),
  }));
  return { runAt, cells };
}

/** One retry, for a request that went unanswered or failed upstream, while the invocation can afford it. */
async function getTwice<T>(u: string): Promise<T> {
  try {
    return await getJson<T>(SOURCE.id, u, TIMEOUT_MS);
  } catch (err) {
    if (err instanceof UpstreamError && err.status != null && err.status < 500) throw err;
    if (left() < 1) throw err;
    return getJson<T>(SOURCE.id, u, TIMEOUT_MS);
  }
}

export const KEY = "ens:ile";

/** The run time and the ensemble, under one key: the run is always that of its copy. */
export async function build(): Promise<Ensemble> {
  const [meta, raw] = await Promise.all([getTwice<MetaJson>(META), getTwice<EnsJson | EnsJson[]>(url())]);
  return parse(raw, meta.last_run_initialisation_time * 1000);
}

/**
 * The copy there is, however old: the run's age decides (`confidenceAt`). In the Worker the scheduled event keeps
 * it, a shared copy (web/partagees.ts); a question never fetches it. Outside the Worker (Node), where nothing is
 * limited, the question brings an old copy up to date after its answer.
 */
export async function island(cache: Cache, now: Date): Promise<Ensemble | null> {
  const hit = await cache.peek<Ensemble>(KEY);
  if (left() === Infinity && (!hit || now.getTime() - hit.fetchedAt.getTime() >= FRESH_SECONDS * 1000)) {
    later(cache.get(KEY, FRESH_SECONDS, build).catch((err) => console.error(`source ${SOURCE.id} indisponible:`, why(err))));
  }
  return hit?.value ?? null;
}

/** The cell over a place. */
export function at(e: Ensemble, lon: number, lat: number): EnsCell | undefined {
  let best: EnsCell | undefined;
  for (const c of e.cells) if (!best || distanceKm(lon, lat, c.lon, c.lat) < distanceKm(lon, lat, best.lon, best.lat)) best = c;
  return best;
}

// --- Confidence ------------------------------------------------------------------------------------------------

export type Level = "forte" | "moyenne" | "faible";
const LEVELS: Level[] = ["forte", "moyenne", "faible"];

export interface Confidence {
  niveau: Level;
  pourquoi: string;
}

// Below these, scenarios that part do not make another day: a few millimetres, a breeze.
const LIGHT_MM = 5;
const STRONG_KMH = 50;
const dec = (n: number) => String(n).replace(".", ",");
const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Each part of the day scores 0 (the scenarios agree), 1 or 2 (they part), and the worst part gives the level.
 * Thresholds set on the run of 23/10/2026 18:00 UTC: today mostly agreed, then « moyenne », and « faible » where
 * a few scenarios bring heavy rain the others do not.
 */
export function confidence(d: EnsDay): Confidence {
  const [t10, t90] = d.tmax;
  const [r10, r50, r90] = d.pluie;
  const [g10, g90] = d.rafales;
  const st = t90 - t10;
  const sr = r90 - r10;
  const sg = g90 - g10;
  const parts: { score: number; text: string }[] = [
    { score: st <= 2 ? 0 : st <= 4 ? 1 : 2, text: `${dec(round(st))} °C d'écart sur le maximum` },
    { score: r90 < LIGHT_MM || sr <= Math.max(4, 0.6 * r50) ? 0 : sr <= Math.max(10, 1.5 * r50) ? 1 : 2, text: `${dec(Math.round(sr))} mm d'écart sur la pluie` },
    // A few scenarios with heavy rain where most bring little: the day may turn out quite otherwise.
    { score: d.fortes >= 3 && r90 >= HEAVY_MM && r50 * 4 < r90 ? 2 : 0, text: `${d.fortes} scénarios sur ${d.membres} donnent ${HEAVY_MM} mm de pluie ou plus` },
    { score: g90 < STRONG_KMH || sg <= 15 ? 0 : sg <= 30 ? 1 : 2, text: `${Math.round(sg)} km/h d'écart sur les rafales` },
  ];
  const worst = Math.max(...parts.map((p) => p.score));
  // Only the gaps between scenarios, never their values: those are the cell's, which may be a mountain's for a
  // coastal town (Saint-Denis), and would contradict the forecast shown.
  const pourquoi = worst === 0
    ? `les scénarios s'accordent (${dec(round(st))} °C d'écart sur le maximum, pluie et vent sans grand écart)`
    : `les scénarios divergent sur le carré de ${MODEL.maille_km} km : ${parts.filter((p) => p.score > 0).map((p) => p.text).join(", ")}`;
  return { niveau: LEVELS[worst], pourquoi };
}

/**
 * The reason of a day that is not sure, shortened for its card on the site, where the note under the days says what
 * the scenarios are: « Écarts entre scénarios : 3,3 °C sur le maximum, 33 mm de pluie, 31 km/h de rafales. 7 scénarios
 * sur 51 à 20 mm ou plus. » Read from `pourquoi` as `confidence` writes it, each number held to its unit; undefined
 * for a day whose scenarios agree.
 */
export function cardReason(pourquoi: string): string | undefined {
  const [head, list] = pourquoi.split(" : ");
  if (!head.startsWith("les scénarios divergent") || !list) return undefined;
  const parts = list.split(", ");
  const gaps = parts.flatMap((p) => {
    const m = /^(.+) d'écart sur (le maximum|la pluie|les rafales)$/.exec(p);
    return m ? [`${m[1]} ${m[2] === "le maximum" ? "sur le maximum" : m[2] === "la pluie" ? "de pluie" : "de rafales"}`] : [];
  });
  const heavy = parts.map((p) => /^(\d+) scénarios sur (\d+) donnent (\d+) mm de pluie ou plus$/.exec(p)).find((m) => m);
  const text = gaps.length
    ? `Écarts entre scénarios : ${gaps.join(", ")}.${heavy ? ` ${heavy[1]} scénarios sur ${heavy[2]} à ${heavy[3]} mm ou plus.` : ""}`
    : heavy ? `${heavy[1]} scénarios sur ${heavy[2]} à ${heavy[3]} mm de pluie ou plus.` : undefined;
  return text?.replace(/(\d) (°C|mm|km\/h)/g, "$1\u00a0$2");
}

/** The confidence of each day over a place, none when the run is too old. */
export function confidenceAt(e: Ensemble | null, lon: number, lat: number, now: Date): ((date: string) => Confidence | undefined) {
  if (!e || now.getTime() - e.runAt > MAX_RUN_AGE_H * 3600_000) return () => undefined;
  const cell = at(e, lon, lat);
  return (date) => {
    const d = cell?.days.find((x) => x.date === date);
    return d && confidence(d);
  };
}
