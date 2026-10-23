/**
 * Fallback for the sea temperature: Aqua MODIS daily SST, 4 km, daytime, near real time, from the NOAA PFEG
 * ERDDAP. Used when the NOAA CoastWatch server (ACSPO) is down — it went down twice in October 2026, and the
 * PFEG and AOML "mirrors" only redirect to it — or has no clear pixel near the place. Same kind of data as
 * ACSPO (radiometer readings gridded per day, cloudy pixels missing), coarser and from one satellite only.
 */
import type { Cache } from "../cache.js";
import { BBOX } from "../geo.js";
import { getText } from "../http.js";
import type { SourceInfo } from "../types.js";
import { parseCsv } from "./acspo.js";

export const SOURCE: SourceInfo = {
  id: "modis",
  nom: "Température de surface de la mer par satellite (NASA Aqua MODIS)",
  organisme: "NASA GSFC OBPG, diffusé par NOAA CoastWatch West Coast (PFEG)",
  licence: "Domaine public (NASA / NOAA)",
  attribution: "NASA OBPG Aqua MODIS SST, NOAA ERDDAP PFEG",
  url: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdMH1sstd1day_R2022NRTMasked.html",
};

const DAYS = 7; // one satellite, daytime only: more days to find a clear pixel
const FRESH_SECONDS = 3 * 3600;
const TIMEOUT_MS = 15_000; // a few seconds normally; asked after ACSPO, within a page refresh cut at 30 s
const box = `[last-${DAYS - 1}:last][(${BBOX.latMax}):(${BBOX.latMin})][(${BBOX.lonMin}):(${BBOX.lonMax})]`;
const URL =
  "https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdMH1sstd1day_R2022NRTMasked.csv?" +
  encodeURI(`sstMasked${box}`).replace(/\[/g, "%5B").replace(/\]/g, "%5D");

export async function grid(cache: Cache) {
  return cache.get("modis", FRESH_SECONDS, async () => parseCsv(await getText(SOURCE.id, URL, TIMEOUT_MS), "sstMasked"));
}
