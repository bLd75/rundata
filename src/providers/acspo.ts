/**
 * Sea surface temperature measured by satellite: NOAA ACSPO L3S-LEO, daily, 0.02° (~2 km), from the THREDDS server of
 * NOAA STAR over OPeNDAP. Real radiometer readings gridded per day, not an interpolated analysis: cloudy pixels are simply
 * missing. A day is published the next morning (UTC). Only pixels with GHRSST quality level 5 ("best") are kept.
 */
import type { Cache } from "../cache.js";
import { BBOX, distanceKm } from "../geo.js";
import { getText } from "../http.js";
import { type SourceInfo, why } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "acspo",
  nom: "Température de surface de la mer par satellite (NOAA ACSPO L3S)",
  organisme: "NOAA CoastWatch / NESDIS STAR",
  licence: "Domaine public (NOAA)",
  attribution: "NOAA CoastWatch, ACSPO L3S-LEO SST",
  url: "https://coastwatch.noaa.gov/cwn/products/acspo-global-002o-gridded-super-collated-sst-and-thermal-fronts-low-earth-orbiting.html",
};

const DAYS = 4;
/** One file per day: the downloads, plus the cache read and write. */
export const COST = DAYS + 2;
const FRESH_SECONDS = 3 * 3600; // the product is daily; a few checks a day are enough
// A day's subset comes in a few seconds; a stuck server must not hold a page refresh, which Cloudflare cuts after 30 s
// (and MODIS may still have to be asked after this).
const TIMEOUT_MS = 12_000;
// CoastWatch's servers have been down for days at a time: once they fail, MODIS answers for half an hour before they are
// asked again, instead of each page waiting for them and then lacking the subrequests MODIS needs.
const BACKOFF_SECONDS = 30 * 60;
// A day the server has can be missing from what came, when it took longer than TIMEOUT_MS: on 25 October 2026 the grid
// read at 16:09 Réunion time stopped at the 22nd, the 24th published at 03:42 UTC, and was kept three hours. Such a grid
// is asked again after half an hour.
const RETRY_SECONDS = 30 * 60;

// The daily files of the global 0.02° grid: rows from 89.99° N southwards, columns from 179.99° W eastwards. The ERDDAP
// dataset that served them as one table (noaacwLEOACSPOSSTL3SnrtCDaily) is gone from CoastWatch since October 2026.
const BASE = "https://coastwatch.noaa.gov/thredds/dodsC/gridLEODYNRTL3SWW00";
const FILE = "120000-STAR-L3S_GHRSST-SSTsubskin-LEO_Daily-ACSPO_V2.81-v02.0-fv01.0.nc";
const row = (lat: number) => (89.99 - lat) / 0.02;
const col = (lon: number) => (lon + 179.99) / 0.02;
const box =
  `[0][${Math.floor(row(BBOX.latMax))}:${Math.ceil(row(BBOX.latMin))}]` +
  `[${Math.floor(col(BBOX.lonMin))}:${Math.ceil(col(BBOX.lonMax))}]`;
const QUERY = `sea_surface_temperature${box},quality_level${box}`.replace(/\[/g, "%5B").replace(/\]/g, "%5D");

/** The OPeNDAP text subset of the island for the day `date` (YYYY-MM-DD). */
export function dayUrl(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const doy = Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
  return `${BASE}/${d.getUTCFullYear()}/${String(doy).padStart(3, "0")}/${date.replace(/-/g, "")}${FILE}.ascii?${QUERY}`;
}

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

/** The lines of one part of an OPeNDAP ASCII answer (`name` then its values, up to a blank line). */
function part(text: string, name: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${name}[`));
  if (start < 0) throw new Error(`réponse OPeNDAP sans ${name}`);
  const end = lines.findIndex((l, i) => i > start && l.trim() === "");
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

const numbers = (lines: string[]) => lines.join(",").split(",").filter((v) => v.trim() !== "").map(Number);

/**
 * OPeNDAP ASCII (each grid's rows « [0][i], v, v… », then its lat and lon maps) to the day's valid pixels. The
 * temperature is stored in hundredths of a degree above 0 °C (scale 0.01, offset 273.15 K), -32768 where there is none.
 */
export function parseAscii(text: string, date: string): SstDay {
  const rows = (v: string) => part(text, `${v}.${v}`).map((l) => numbers([l]).slice(1));
  const sst = rows("sea_surface_temperature");
  const ql = rows("quality_level");
  const lats = numbers(part(text, "sea_surface_temperature.lat"));
  const lons = numbers(part(text, "sea_surface_temperature.lon"));
  const pixels: [number, number, number][] = [];
  sst.forEach((r, i) =>
    r.forEach((v, j) => {
      if (v !== -32768 && ql[i]?.[j] === 5) pixels.push([lons[j], lats[i], v / 100]);
    }),
  );
  return { date, pixels };
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

/** The newest day the server should have at `now`: a day is published the next morning, before 06:00 UTC. */
export const due = (now: Date) => new Date(now.getTime() - 30 * 3600_000).toISOString().slice(0, 10);

/**
 * The last DAYS days before `now` (UTC) that came, newest first, a day without a clear pixel included; fails only if
 * none of them comes. Without the day `due`, asked again after RETRY_SECONDS instead of FRESH_SECONDS.
 */
export async function grid(cache: Cache, now = new Date()) {
  const load = async () => {
    const dates = Array.from({ length: DAYS }, (_, k) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1 - k)).toISOString().slice(0, 10),
    );
    // The day before is missing until the morning (UTC) it is published: the others answer for it.
    const got = await Promise.allSettled(dates.map(async (d) => parseAscii(await getText(SOURCE.id, dayUrl(d), TIMEOUT_MS), d)));
    const days = got.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!days.length) throw (got[0] as PromiseRejectedResult).reason;
    // The days due and newer than those that came: said, since the answer then gives an older day.
    got.forEach((r, k) => {
      if (r.status === "rejected" && dates[k] <= due(now) && dates[k] > days[0].date) console.error(`source acspo : jour ${dates[k]} manquant:`, why(r.reason));
    });
    return days;
  };
  const c = await cache.get("acspo", FRESH_SECONDS, load, BACKOFF_SECONDS);
  return (c.value[0]?.date ?? "") >= due(now) ? c : cache.get("acspo", RETRY_SECONDS, load, BACKOFF_SECONDS);
}
