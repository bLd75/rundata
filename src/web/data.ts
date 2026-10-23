/**
 * What the web pages show, taken from the same code as the MCP tools and kept as one shared cache entry per page.
 *
 * A page is served from its last copy, however old (its times say so), and refreshed in the background once that
 * copy is older than a few minutes: crawlers and refreshes never wait for upstream sources, and a page served from
 * cache costs at most one subrequest (the edge read). Only a page never built in this data center waits, a few
 * seconds at most, and is otherwise sent without its live block while the build goes on.
 */
import { left } from "../budget.js";
import type { Cache, Cached } from "../cache.js";
import * as mf from "../providers/vigilance.js";
import { BEACHES, seaTour, temperatureMer } from "../tools/mer.js";
import { islandTour, meteoActuelle } from "../tools/meteo.js";
import { previsionMeteo } from "../tools/prevision.js";
import { cyclone, highest, raised } from "../tools/vigilance.js";
import { type Observation, why } from "../types.js";
import { coastal, type PlacePage } from "./places.js";

export const FRESH_SECONDS = 5 * 60; // the stations publish every 6 minutes
const KEEP_SECONDS = 24 * 3600;
const WAIT_MS = 4000;
// Below this many subrequests left, a place page is built without its forecast rather than risk the limit.
const FORECAST_MIN_LEFT = 10;

export type Background = (work: Promise<unknown>) => void;

export interface StationNow {
  nom: string;
  source: string;
  lon: number;
  lat: number;
  altitude_m: number;
  /** ISO time of the measurement. */
  time: string;
  stale: boolean;
  temperature?: number;
  humidite?: number;
  vent?: number;
  /** Where the wind comes from, in degrees. */
  direction?: number;
  rafales?: number;
  pluie_6min?: number;
  pluie_1h?: number;
}

export interface SeaNow {
  nom: string;
  valeur: number;
  /** Day of the satellite pass, YYYY-MM-DD. */
  jour: string;
  distance_km: number;
}

export interface Credit {
  source: string;
  licence: string;
  attribution: string;
}

export interface HomeData {
  stations: StationNow[];
  mer: SeaNow[];
  sources: Credit[];
  indisponibles: string[];
}

/** The answers of the tools for one place, as they would reach a model (parsed). */
export interface PlaceData {
  meteo?: MeteoAnswer;
  mer?: MerAnswer;
  prevision?: PrevisionAnswer;
}

export interface StationAnswer {
  station: string;
  source: string;
  altitude_m: number;
  heure_mesure: string;
  age_min: number;
  mesures: Record<string, string>;
  avertissements: string[];
  distance_km?: number;
  direction?: string;
  pertinence?: string;
}

export interface MeteoAnswer {
  resume: string;
  stations: StationAnswer[];
  sources: Credit[];
}

export interface MerAnswer {
  resume: string;
  mesure?: { temperature_eau: string; jour_mesure: string; distance_km: number };
  sources: Credit[];
}

export interface PrevisionAnswer {
  resume: string;
  jours?: {
    jour: string;
    ciel_en_journee?: string;
    temperature_min?: string;
    temperature_max?: string;
    pluie?: string;
    rafales_max?: string;
  }[];
  modele?: { nom: string; maille_km: number; run_du_modele?: string };
  avertissements?: string[];
  sources: Credit[];
}

const num = (o: Observation, variable: string) => {
  const v = o.readings.find((r) => r.variable === variable)?.valeur;
  return typeof v === "number" ? v : undefined;
};

function stationNow(o: Observation, stale: boolean): StationNow {
  const s = o.station;
  return {
    nom: s.nom,
    source: s.source,
    lon: s.lon,
    lat: s.lat,
    altitude_m: s.altitude_m,
    time: o.time.toISOString(),
    stale,
    temperature: num(o, "temperature"),
    humidite: num(o, "humidite"),
    vent: num(o, "vent_moyen"),
    direction: num(o, "vent_direction"),
    rafales: num(o, "rafales"),
    pluie_6min: num(o, "pluie_6min"),
    pluie_1h: num(o, "pluie_1h"),
  };
}

const credit = (s: { nom: string; licence: string; attribution: string }): Credit => ({
  source: s.nom,
  licence: s.licence,
  attribution: s.attribution,
});

export async function buildHome(cache: Cache, now = new Date()): Promise<HomeData> {
  const [air, sea] = await Promise.allSettled([islandTour(cache, now), seaTour(cache, now)]);
  const out: HomeData = { stations: [], mer: [], sources: [], indisponibles: [] };
  if (air.status === "fulfilled") {
    out.stations = air.value.tour.map(({ o, stale }) => stationNow(o, stale));
    out.sources.push(...air.value.sources.map(credit));
    out.indisponibles.push(...air.value.down);
  } else console.error("page : tour de l'île indisponible", why(air.reason));
  if (sea.status === "fulfilled" && sea.value) {
    for (const { p, r } of sea.value.readings) {
      if (r) out.mer.push({ nom: p.nom, valeur: r.valeur, jour: r.mesure.jour_mesure, distance_km: r.mesure.distance_km });
    }
    out.sources.push(...sea.value.used.map((g) => credit(g.source)));
  } else out.indisponibles.push("Température de la mer par satellite");
  if (!out.stations.length && !out.mer.length) throw new Error("aucune donnée pour la page d'accueil");
  return out;
}

/** One spot of the coast on the page /mer; no value where the satellites saw nothing near it. */
export interface BeachNow {
  nom: string;
  commune: string;
  lon: number;
  lat: number;
  valeur?: number;
  jour?: string;
  distance_km?: number;
}

export interface SeaData {
  plages: BeachNow[];
  sources: Credit[];
}

export async function buildSea(cache: Cache, now = new Date()): Promise<SeaData> {
  const t = await seaTour(cache, now, BEACHES);
  if (!t) throw new Error("aucune mesure satellite de la mer");
  return {
    plages: t.readings.map(({ p, r }) => ({
      nom: p.nom,
      commune: p.commune,
      lon: p.lon,
      lat: p.lat,
      ...(r ? { valeur: r.valeur, jour: r.mesure.jour_mesure, distance_km: r.mesure.distance_km } : {}),
    })),
    sources: t.used.map((g) => credit(g.source)),
  };
}

function answer<T>(r: { content: { text: string }[]; isError?: boolean }): T | undefined {
  return r.isError ? undefined : (JSON.parse(r.content[0].text) as T);
}

/** Measurements, then the sea, then the forecast, which sizes its downloads from the subrequests left. */
export async function buildPlace(cache: Cache, p: PlacePage, now = new Date()): Promise<PlaceData> {
  const out: PlaceData = {};
  out.meteo = answer<MeteoAnswer>(await meteoActuelle(cache, p.lieu, now));
  if (coastal(p)) out.mer = answer<MerAnswer>(await temperatureMer(cache, p.lieu, now));
  if (left() >= FORECAST_MIN_LEFT) {
    try {
      out.prevision = answer<PrevisionAnswer>(await previsionMeteo(cache, p.lieu, undefined, now));
    } catch (err) {
      console.error(`page ${p.slug} : prévision indisponible`, why(err));
    }
  }
  if (!out.meteo && !out.prevision) throw new Error(`aucune donnée pour ${p.nom}`);
  return out;
}

/** The banner of every page while a vigilance is above green: its worst colour and one sentence. */
export interface Alerte {
  couleur: number;
  texte: string;
}

const BANNER_WAIT_MS = 1500;

export function alerteOf(v: mf.Vigilance, now: Date): Alerte | undefined {
  const periods = v.zones[mf.ISLAND]?.[mf.CYCLONE];
  if (periods && highest(periods) >= 2) return { couleur: highest(periods), texte: `Météo-France : ${cyclone(v, now)}` };
  const r = raised(v);
  if (!r.length) return undefined;
  const list = r.slice(0, 3).map((x) => `${x.couleur_max} ${x.phenomene.toLowerCase()} (${x.zone.split(" :")[0]})`);
  return { couleur: r[0].max, texte: `Vigilance Météo-France : ${list.join(", ")}${r.length > 3 ? "…" : ""}.` };
}

/**
 * Météo-France's vigilance, waited for at most `waitMs` (then left to finish in the background for the next page).
 * Null when the key is missing, the source fails with nothing in cache, or it is late.
 */
export async function vigilanceNow(cache: Cache, background: Background, waitMs: number): Promise<Cached<mf.Vigilance> | null> {
  if (!mf.enabled()) return null;
  const work = mf.vigilance(cache);
  try {
    const got = await within(work, waitMs);
    if (!got) background(work.catch(() => undefined));
    return got;
  } catch (err) {
    console.error(`source ${mf.SOURCE.id} indisponible:`, why(err));
    return null;
  }
}

/** The banner for a page: never throws, never holds a page more than a second and a half. */
export async function alerte(cache: Cache, background: Background, now = new Date()): Promise<Alerte | undefined> {
  const v = await vigilanceNow(cache, background, BANNER_WAIT_MS);
  return v ? alerteOf(v.value, now) : undefined;
}

/** `work`, or null if it takes longer than `ms`. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)));
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The last copy of a page's data and when it was built, refreshed in the background when older than
 * FRESH_SECONDS. Null when there is none yet and it takes more than a few seconds to build.
 *
 * `reader`: the fetcher of an AI assistant, which reads the page once and answers from it. It waits up to `waitMs`
 * for an old copy to be refreshed instead of getting it as it is.
 */
export async function snapshot<T>(
  cache: Cache,
  key: string,
  build: () => Promise<T>,
  background: Background,
  now = new Date(),
  waitMs = WAIT_MS,
  reader = false,
): Promise<Cached<T> | null> {
  const any = cache.get(key, KEEP_SECONDS, build);
  let got: Cached<T> | null;
  try {
    got = await within(any, waitMs);
  } catch (err) {
    console.error(`page ${key} : données indisponibles`, why(err));
    return null;
  }
  if (!got) {
    background(any.catch(() => undefined));
    return null;
  }
  if (now.getTime() - got.fetchedAt.getTime() > FRESH_SECONDS * 1000) {
    const fresh = cache.get(key, FRESH_SECONDS, build);
    const logged = fresh.catch((err) => console.error(`page ${key} : rafraîchissement impossible`, why(err)));
    if (reader) {
      const newer = await within(logged, waitMs);
      if (newer) return newer;
    }
    background(logged);
  }
  return got;
}
