/**
 * Forecasts of the ECMWF IFS HRES model (9 km), served by Open-Meteo. No key; free API for non-commercial use.
 *
 * Why not Météo-France: over Réunion Open-Meteo only has ARPEGE World (0.25°, AROME covers mainland France only),
 * whose nearest grid points to Saint-Denis and Saint-Pierre are at sea: on 22/10/2026 it gave Saint-Denis a
 * 24 °C maximum while Gillot had measured 28 °C by 9 am. IFS HRES has a grid point on the town (27 °C).
 * Open-Meteo brings the temperature to the `elevation` it is given; rain, wind and clouds stay those of the cell.
 * The tool (tools/prevision.ts) only sees the Forecast type, so that Météo-France AROME outre-mer (0.025°) can
 * replace this source once its API is found.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { Place } from "../places/resolve.js";
import type { Forecast, ForecastModel, SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "openmeteo",
  nom: "Prévisions du modèle IFS du Centre européen (ECMWF), via Open-Meteo",
  organisme: "ECMWF (données ouvertes IFS HRES), diffusé par Open-Meteo",
  licence: "CC BY 4.0 (ECMWF et Open-Meteo) ; API Open-Meteo gratuite réservée aux usages non commerciaux",
  attribution: "Weather data by Open-Meteo.com <https://open-meteo.com/> ; modèle IFS, ECMWF",
  url: "https://open-meteo.com/en/docs/ecmwf-api",
};

export const MODEL: ForecastModel = {
  nom: "IFS HRES du Centre européen (ECMWF)",
  maille_km: 9,
  // The model runs 15 days; past a week a point forecast says little.
  echeance_jours: 7,
  mise_a_jour: "toutes les 6 h",
};

const API = "https://api.open-meteo.com/v1/forecast";
const META = "https://api.open-meteo.com/data/ecmwf_ifs/static/meta.json";
const FRESH_SECONDS = 30 * 60;

const HOURLY = ["temperature_2m", "precipitation", "weather_code", "cloud_cover", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m"];
const DAILY = ["weather_code", "temperature_2m_min", "temperature_2m_max", "precipitation_sum", "wind_gusts_10m_max"];

type Series = (number | null)[];

export interface OpenMeteoJson {
  latitude: number;
  longitude: number;
  utc_offset_seconds: number;
  elevation: number;
  hourly: { time: string[] } & Record<string, Series | string[]>;
  daily: { time: string[] } & Record<string, Series | string[]>;
}

interface MetaJson {
  last_run_initialisation_time: number;
}

/** Places a few hundred metres apart share one request: the grid is 9 km anyway. */
export function cacheKey(place: Place): string {
  return `openmeteo:${place.lat.toFixed(2)},${place.lon.toFixed(2)},${place.altitude_m ?? "dem"}`;
}

function url(place: Place): string {
  const q = new URLSearchParams({
    latitude: place.lat.toFixed(2),
    longitude: place.lon.toFixed(2),
    models: "ecmwf_ifs",
    timezone: "Indian/Reunion",
    forecast_days: String(MODEL.echeance_jours),
    hourly: HOURLY.join(","),
    daily: DAILY.join(","),
  });
  // Without it, Open-Meteo uses its own 90 m terrain model at that point, which is just as good on flat ground.
  if (place.altitude_m != null) q.set("elevation", String(place.altitude_m));
  return `${API}?${q}`;
}

const num = (s: Series | string[] | undefined, i: number): number | null => {
  const v = s?.[i];
  return typeof v === "number" ? v : null;
};

export function parse(j: OpenMeteoJson, runAt?: Date): Forecast {
  // Times come as local wall-clock strings ("2026-10-22T13:00"); the offset makes them instants.
  const toDate = (t: string) => new Date(Date.parse(`${t}:00Z`) - j.utc_offset_seconds * 1000);
  const h = j.hourly;
  const d = j.daily;
  return {
    model: MODEL,
    source: SOURCE,
    runAt,
    grid: { lat: j.latitude, lon: j.longitude },
    altitude_m: j.elevation,
    // Open-Meteo gives rain and gusts over the hour before each time: shifted to the hour after it.
    hours: h.time.map((t, i) => ({
      time: toDate(t),
      duree_h: 1,
      temperature: num(h.temperature_2m, i),
      pluie_mm: num(h.precipitation, i + 1),
      code: num(h.weather_code, i),
      nuages_pct: num(h.cloud_cover, i),
      vent_kmh: num(h.wind_speed_10m, i),
      rafales_kmh: num(h.wind_gusts_10m, i + 1),
      vent_dir: num(h.wind_direction_10m, i),
    })),
    days: d.time.map((t, i) => ({
      date: t,
      code: num(d.weather_code, i),
      tmin: num(d.temperature_2m_min, i),
      tmax: num(d.temperature_2m_max, i),
      pluie_mm: num(d.precipitation_sum, i),
      rafales_max_kmh: num(d.wind_gusts_10m_max, i),
    })),
  };
}

async function runTime(cache: Cache): Promise<Date | undefined> {
  try {
    const m = await cache.get("openmeteo:meta", FRESH_SECONDS, () => getJson<MetaJson>(SOURCE.id, META));
    return new Date(m.value.last_run_initialisation_time * 1000);
  } catch {
    return undefined; // the run time is a nicety; the forecast stands without it
  }
}

export async function forecast(cache: Cache, place: Place): Promise<Cached<Forecast>> {
  const [raw, runAt] = await Promise.all([
    cache.get(cacheKey(place), FRESH_SECONDS, () => getJson<OpenMeteoJson>(SOURCE.id, url(place))),
    runTime(cache),
  ]);
  return { ...raw, value: parse(raw.value, runAt) };
}
