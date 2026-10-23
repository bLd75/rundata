/**
 * Sea surface temperature measured by satellite: NOAA ACSPO L3S-LEO, daily, 0.02° (~2 km), via ERDDAP.
 * Real radiometer readings gridded per day, not an interpolated analysis: cloudy pixels are simply missing.
 * Latency is about two days. Only pixels with GHRSST quality level 5 ("best") are kept.
 */
import type { Cache } from "../cache.js";
import { BBOX, distanceKm } from "../geo.js";
import { getText } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "acspo",
  nom: "Température de surface de la mer par satellite (NOAA ACSPO L3S)",
  organisme: "NOAA CoastWatch / NESDIS STAR",
  licence: "Domaine public (NOAA)",
  attribution: "NOAA CoastWatch, ACSPO L3S-LEO SST",
  url: "https://coastwatch.noaa.gov/erddap/griddap/noaacwLEOACSPOSSTL3SnrtCDaily.html",
};

const DAYS = 4;
const FRESH_SECONDS = 3 * 3600; // the product is daily; a few checks a day are enough
// ERDDAP answers in a few seconds; a stuck server must not hold a page refresh, which Cloudflare cuts after 30 s
// (and MODIS may still have to be asked after this).
const TIMEOUT_MS = 12_000;
const box = `[last-${DAYS - 1}:last][(${BBOX.latMax}):(${BBOX.latMin})][(${BBOX.lonMin}):(${BBOX.lonMax})]`;
const URL =
  "https://coastwatch.noaa.gov/erddap/griddap/noaacwLEOACSPOSSTL3SnrtCDaily.csv?" +
  encodeURI(`sea_surface_temperature${box},quality_level${box}`).replace(/\[/g, "%5B").replace(/\]/g, "%5D");

/** One day of valid pixels: [lon, lat, °C]. JSON-friendly so that any cache store can keep it. */
export interface SstDay {
  date: string;
  pixels: [number, number, number][];
}

/** ERDDAP CSV (header, units line, rows) to days of valid pixels. `variable` names the temperature column. */
export function parseCsv(csv: string, variable = "sea_surface_temperature"): SstDay[] {
  const days = new Map<string, SstDay>();
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",");
  const col = (name: string) => header.indexOf(name);
  const [it, ilat, ilon, isst, iql] = ["time", "latitude", "longitude", variable, "quality_level"].map(col);
  for (const line of lines.slice(2)) {
    const f = line.split(",");
    const sst = parseFloat(f[isst]);
    if (Number.isNaN(sst)) continue;
    if (iql >= 0 && f[iql] !== "5") continue;
    const date = f[it].slice(0, 10);
    if (!days.has(date)) days.set(date, { date, pixels: [] });
    days.get(date)!.pixels.push([parseFloat(f[ilon]), parseFloat(f[ilat]), sst]);
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export interface SstReading {
  date: string;
  valeur: number;
  lon: number;
  lat: number;
  distance_km: number;
  /** Valid pixels averaged (the nearest ones, within 2 km of the nearest). */
  pixels: number;
}

/**
 * Most recent day with a clear pixel within `maxKm` of the point. Averages the pixels that are about as close
 * as the nearest one, which smooths the 0.01 °C noise without mixing in water from further offshore.
 */
export function nearest(days: SstDay[], lon: number, lat: number, maxKm = 12): SstReading | null {
  for (const day of days) {
    const near = day.pixels
      .map(([plon, plat, v]) => ({ plon, plat, v, d: distanceKm(lon, lat, plon, plat) }))
      .filter((p) => p.d <= maxKm)
      .sort((a, b) => a.d - b.d);
    if (near.length === 0) continue;
    const group = near.filter((p) => p.d <= near[0].d + 2);
    const mean = group.reduce((s, p) => s + p.v, 0) / group.length;
    return {
      date: day.date,
      valeur: Math.round(mean * 10) / 10,
      lon: near[0].plon,
      lat: near[0].plat,
      distance_km: Math.round(near[0].d * 10) / 10,
      pixels: group.length,
    };
  }
  return null;
}

export async function grid(cache: Cache) {
  return cache.get("acspo", FRESH_SECONDS, async () => parseCsv(await getText(SOURCE.id, URL, TIMEOUT_MS)));
}
