/**
 * The UV index forecast by the Copernicus Atmosphere Monitoring Service (CAMS global, 0.4°, 5 days), served by
 * Open-Meteo's air-quality API. No key; free API for non-commercial use. There is no open UV measurement on the
 * island: this is a FORECAST, clouds included.
 *
 * Why not the ECMWF IFS of the weather forecast (openmeteo.ts): Open-Meteo has no UV for it. GFS has one, but gave
 * 6.8 at Saint-Leu on 23/10/2026 at noon where CAMS gave 9.5, under a clear-sky value of 13 that fits the season.
 * The island holds in six cells of the CAMS grid: one request, kept an hour, answers for every place.
 */
import type { Cache, Cached } from "../cache.js";
import { distanceKm } from "../geo.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "cams_uv",
  nom: "Indice UV prévu par le service Copernicus de surveillance de l'atmosphère (CAMS), via Open-Meteo",
  organisme: "Copernicus Atmosphere Monitoring Service (CAMS, ECMWF pour l'Union européenne), diffusé par Open-Meteo",
  licence: "Licence Copernicus (libre, citer CAMS) et CC BY 4.0 (Open-Meteo) ; API Open-Meteo gratuite réservée aux usages non commerciaux",
  attribution: "Generated using Copernicus Atmosphere Monitoring Service information ; data by Open-Meteo.com <https://open-meteo.com/>",
  url: "https://open-meteo.com/en/docs/air-quality-api",
};

export const MODEL = { nom: "CAMS global", maille_km: 45 };

const API = "https://air-quality-api.open-meteo.com/v1/air-quality";
const FRESH_SECONDS = 60 * 60; // the model runs twice a day
// The cells of the 0.4° grid that hold the island.
const CELLS = [-20.9, -21.3].flatMap((lat) => [55.1, 55.5, 55.9].map((lon) => ({ lat, lon })));

interface AirJson {
  latitude: number;
  longitude: number;
  hourly: { time: string[]; uv_index: (number | null)[] };
}

/** One cell: the highest index of each day, by local date ("2026-10-24"). */
export interface UvCell {
  lat: number;
  lon: number;
  max: Record<string, number>;
}

function url(): string {
  const q = new URLSearchParams({
    latitude: CELLS.map((c) => c.lat).join(","),
    longitude: CELLS.map((c) => c.lon).join(","),
    hourly: "uv_index",
    timezone: "Indian/Reunion",
    forecast_days: "5",
  });
  return `${API}?${q}`;
}

export function parse(raw: AirJson | AirJson[]): UvCell[] {
  return (Array.isArray(raw) ? raw : [raw]).map((j) => {
    const max: Record<string, number> = {};
    j.hourly.time.forEach((t, i) => {
      const v = j.hourly.uv_index[i];
      if (typeof v !== "number") return;
      const day = t.slice(0, 10);
      max[day] = Math.max(max[day] ?? 0, v);
    });
    for (const d of Object.keys(max)) max[d] = Math.round(max[d]);
    return { lat: j.latitude, lon: j.longitude, max };
  });
}

export async function island(cache: Cache): Promise<Cached<UvCell[]>> {
  return cache.get("uv:ile", FRESH_SECONDS, async () => parse(await getJson<AirJson | AirJson[]>(SOURCE.id, url())));
}

/** The cell over a place. */
export function at(cells: UvCell[], lon: number, lat: number): UvCell | undefined {
  let best: UvCell | undefined;
  for (const c of cells) if (!best || distanceKm(lon, lat, c.lon, c.lat) < distanceKm(lon, lat, best.lon, best.lat)) best = c;
  return best;
}

/** The scale of the World Health Organization. */
export function level(uv: number): string {
  return uv < 3 ? "faible" : uv < 6 ? "modéré" : uv < 8 ? "élevé" : uv < 11 ? "très élevé" : "extrême";
}
