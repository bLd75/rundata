/**
 * Wave forecasts of the ECMWF wave model (WAM, 9 km), served by Open-Meteo's marine API. No key; free API for
 * non-commercial use. A FORECAST, never a measurement: the Candhis buoys of the Cerema will be the measurement once
 * their key is there, and the two are never mixed.
 *
 * Why WAM 9 km rather than Météo-France's MFWAM (0.08°, which splits the swell from the wind sea): MFWAM's sea cells
 * around Réunion are coarse, and the nearest one to Saint-Denis or Sainte-Marie lies 16 to 20 km away, off another
 * stretch of coast; WAM's are within 3 to 8 km of every beach (checked 24/10/2026). WAM gives the height, the periods
 * and the direction of all the waves together, not the swell apart.
 *
 * Every point of the coast goes in one request (Open-Meteo takes lists of coordinates): one subrequest for the island.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "openmeteo_houle",
  nom: "Prévision des vagues du modèle WAM du Centre européen (ECMWF), via Open-Meteo",
  organisme: "ECMWF (données ouvertes, modèle de vagues WAM), diffusé par Open-Meteo",
  licence: "CC BY 4.0 (ECMWF et Open-Meteo) ; API Open-Meteo gratuite réservée aux usages non commerciaux",
  attribution: "Marine data by Open-Meteo.com <https://open-meteo.com/> ; modèle de vagues WAM, ECMWF",
  url: "https://open-meteo.com/en/docs/marine-weather-api",
};

export const MODEL = {
  nom: "WAM du Centre européen (ECMWF)",
  maille_km: 9,
  echeance_jours: 4,
  mise_a_jour: "toutes les 6 h",
};

const API = "https://marine-api.open-meteo.com/v1/marine";
const FRESH_SECONDS = 30 * 60;
/** Steps kept: the model's own are 3-hourly beyond the first days, and three hours is how the answers read. */
export const STEP_H = 3;
const HOUR = 3600_000;

type Series = (number | null)[];

interface MarineJson {
  latitude: number;
  longitude: number;
  utc_offset_seconds: number;
  hourly: { time: string[]; wave_height: Series; wave_peak_period: Series; wave_direction: Series };
}

/** One point of the coast: the model's sea cell, and its steps from `debut`, every STEP_H hours. */
export interface WavePoint {
  lat: number;
  lon: number;
  /** Significant height, in metres. */
  hauteur: Series;
  /** Peak period, in seconds: that of the waves carrying the most energy, the swell's when there is one. */
  periode: Series;
  /** Where the waves come from, in degrees. */
  direction: Series;
}

export interface Waves {
  /** Epoch milliseconds of the first step. */
  debut: number;
  points: WavePoint[];
}

function url(points: { lat: number; lon: number }[]): string {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(","),
    longitude: points.map((p) => p.lon.toFixed(3)).join(","),
    models: "ecmwf_wam",
    hourly: "wave_height,wave_peak_period,wave_direction",
    forecast_days: String(MODEL.echeance_jours),
    // Local hours: the steps start at 0, 3, 6… h in Réunion, as the weather forecast's do.
    timezone: "Indian/Reunion",
    // A beach's own cell is land for a wave model: the nearest one at sea.
    cell_selection: "sea",
  });
  return `${API}?${q}`;
}

const round = (v: number | null | undefined, k: number) => (typeof v === "number" ? Math.round(v * k) / k : null);

export function parse(raw: MarineJson | MarineJson[]): Waves {
  const all = Array.isArray(raw) ? raw : [raw];
  const times = all[0]?.hourly.time ?? [];
  // Times come as local wall-clock strings ("2026-10-24T15:00"); the offset makes them instants.
  const keep = times.flatMap((t, i) => (Number(t.slice(11, 13)) % STEP_H === 0 ? [i] : []));
  return {
    debut: keep.length ? Date.parse(`${times[keep[0]]}:00Z`) - all[0].utc_offset_seconds * 1000 : 0,
    points: all.map((j) => ({
      lat: j.latitude,
      lon: j.longitude,
      hauteur: keep.map((i) => round(j.hourly.wave_height[i], 10)),
      periode: keep.map((i) => round(j.hourly.wave_peak_period[i], 1)),
      direction: keep.map((i) => round(j.hourly.wave_direction[i], 1)),
    })),
  };
}

/** The time of step `i`. */
export const stepTime = (w: Waves, i: number) => new Date(w.debut + i * STEP_H * HOUR);

/** The forecast at every point of `points`, in their order: one request, kept half an hour. */
export async function coast(cache: Cache, key: string, points: { lat: number; lon: number }[]): Promise<Cached<Waves>> {
  return cache.get(`houle:${key}`, FRESH_SECONDS, async () => parse(await getJson<MarineJson | MarineJson[]>(SOURCE.id, url(points))));
}
