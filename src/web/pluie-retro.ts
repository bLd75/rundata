/**
 * The last 3 hours of /meteo's map, replayed on a click: the radar's images, one every 5 minutes, and the wind at the
 * last 3 round hours. Météo-France serves only its latest radar image, so the scheduled event keeps them: each
 * run reads the image (the one the tools read) and, when it is new, adds its grid to one KV key, its runs of
 * characters compressed. A run that cannot read the radar, or reads an image older than STALE_MS, writes down a gap,
 * said on the map as such (« Pas d'image radar de 14:05 à 14:20. »), never as a dry sky. The wind needs nothing
 * stored: the hourly package already kept (providers/meteofrance.ts) holds the 10-minute mean wind at each round hour.
 */
import { count } from "../budget.js";
import type { Cache } from "../cache.js";
import { why } from "../types.js";
import { tokensIssued } from "../providers/mf-auth.js";
import * as meteofrance from "../providers/meteofrance.js";
import * as radar from "../providers/radar.js";
import { project } from "./map.js";
import { grid, type RainGrid } from "./pluie-radar.js";

export const PATH = "/meteo/retro-3h.json";
export const KV_KEY = "radar:3h";
/** Gone from KV an hour after the last write: a scheduled event that stopped leaves no old images behind. */
export const KV_TTL_SECONDS = 4 * 3600;
export const KEEP_MS = 3 * 3600_000;
/** An image older than this when read is not the sky of now: a gap, as /meteo's live layer says. */
export const STALE_MS = 45 * 60_000;
const STEP_MS = 5 * 60_000;
/** The round hours of wind replayed. */
export const WIND_HOURS = 3;

export interface Image {
  /** End of the radar's 5 minutes, ISO UTC. */
  fin: string;
  pannes: string[];
  /** RainGrid's `pluie` and `mal_vu`, each run of a character written as the character and its length in base 36. */
  pluie: string;
  mal_vu: string;
}
/** No image from `de` to `a` (ISO UTC): the radar could not be read, or its image was too old. */
export interface Trou {
  trou: true;
  de: string;
  a: string;
}
export type Entree = Image | Trou;
export interface Historique {
  w: number;
  h: number;
  /** Oldest first. */
  entrees: Entree[];
}

const isTrou = (e: Entree): e is Trou => "trou" in e;
const endOf = (e: Entree) => Date.parse(isTrou(e) ? e.a : e.fin);

/** « ......0000011 » → « .6,05,12, »: each run as its character and its length in base 36, then a comma. */
export function rle(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    out += s[i] + (j - i).toString(36) + ",";
    i = j;
  }
  return out;
}

export function unrle(s: string): string {
  let out = "";
  for (const run of s.split(",")) if (run) out += run[0].repeat(parseInt(run.slice(1), 36));
  return out;
}

/**
 * The history after one run of the scheduled event that read `lu` (a grid, or the error that kept it from reading
 * one) at `now`; undefined when nothing new is to be written (the same image again, or nothing kept to tell a gap
 * from). Entries over KEEP_MS old go when something is written; the page's answer leaves them out anyway.
 */
export function suivant(before: Historique | null, lu: RainGrid | Error, now: Date): Historique | undefined {
  const grid = lu instanceof Error ? undefined : lu;
  const fresh = grid && now.getTime() - Date.parse(grid.fin) <= STALE_MS ? grid : undefined;
  const same = !!before && (!grid || (before.w === grid.w && before.h === grid.h));
  const entrees = same ? before.entrees.filter((e) => endOf(e) > now.getTime() - KEEP_MS) : [];
  const last = entrees[entrees.length - 1];
  const lastImage = [...entrees].reverse().find((e): e is Image => !isTrou(e));
  const w = grid?.w ?? before?.w ?? 0;
  const h = grid?.h ?? before?.h ?? 0;
  if (fresh) {
    if (lastImage && Date.parse(fresh.fin) <= Date.parse(lastImage.fin)) return undefined;
    // The trailing gap ends where this image starts; an image missed since the last one kept is a gap too.
    if (last && isTrou(last)) {
      last.a = fresh.debut;
      if (last.a <= last.de) entrees.pop();
    } else if (last && Date.parse(last.fin) < Date.parse(fresh.debut)) entrees.push({ trou: true, de: last.fin, a: fresh.debut });
    entrees.push({ fin: fresh.fin, pannes: fresh.pannes, pluie: rle(fresh.pluie), mal_vu: rle(fresh.mal_vu) });
    return { w, h, entrees };
  }
  // No image of now: the gap runs from the last image kept to this run, rounded down to the radar's 5 minutes.
  if (!last) return undefined;
  const a = new Date(Math.floor(now.getTime() / STEP_MS) * STEP_MS).toISOString();
  if (isTrou(last)) {
    if (last.a >= a) return undefined;
    last.a = a;
  } else if (Date.parse(last.fin) < Date.parse(a)) entrees.push({ trou: true, de: last.fin, a });
  else return undefined;
  return { w, h, entrees };
}

/**
 * One run of the scheduled event: one read of KV, the radar's image (one subrequest when the data center's copy is
 * over 4 minutes old, one more for a token when the isolate has none), one write of KV when the history changed.
 */
export async function passage(store: { get(): Promise<Historique | null>; put(h: Historique): Promise<void> }, cache: Cache, now = new Date()): Promise<string> {
  const tokens = tokensIssued();
  count();
  const before = await store.get();
  const lu = await radar.image(cache).then((img) => grid(img.value), (err: unknown) => (err instanceof Error ? err : new Error(String(err))));
  const next = suivant(before, lu, now);
  if (next) {
    count(1, true);
    await store.put(next);
  }
  const said = lu instanceof Error ? `illisible (${why(lu)})` : `image finie à ${lu.fin}`;
  return `${said}, ${next ? `${next.entrees.length} entrées écrites` : "rien à écrire"}, jetons Météo-France pris : ${tokensIssued() - tokens}`;
}

let reader: (() => Promise<Historique | null>) | undefined;

/** How the page's answer reads the history: from KV, set by worker.ts; without it, there is none to replay. */
export function configure(read?: () => Promise<Historique | null>) {
  reader = read;
}

export interface VentHeure {
  /** The round hour, ISO UTC: the 10-minute mean wind measured up to it. */
  fin: string;
  /** Each anemometer's place on the map and where its wind goes, in km/h along x and y (y down), as data-vent. */
  st: [number, number, number, number][];
}

export interface Retro {
  radar: Historique | null;
  vent: VentHeure[];
}

/** The wind at the last WIND_HOURS round hours of the hourly package, at the Météo-France stations that measured it. */
export function hourlyWind(hourly: meteofrance.HourlyRain): VentHeure[] {
  const out: VentHeure[] = Array.from({ length: WIND_HOURS }, (_, k) => ({ fin: new Date(Date.parse(hourly.end) - k * 3600_000).toISOString(), st: [] }));
  for (const s of meteofrance.stations()) {
    meteofrance.stationHours(hourly, s.id).slice(0, WIND_HOURS).forEach((x, k) => {
      if (x.ff == null || x.dd == null) return;
      const a = (x.dd * Math.PI) / 180;
      out[k].st.push([...project(s.lon, s.lat), Math.round(-Math.sin(a) * x.ff * 10) / 10, Math.round(Math.cos(a) * x.ff * 10) / 10]);
    });
  }
  return out.filter((x) => x.st.length).reverse();
}

/** The answer of PATH: the radar's last 3 hours from KV (one read), the wind from the hourly package in the cache. */
export async function retro(cache: Cache, now = new Date()): Promise<Response> {
  const headers = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };
  const [kept, hourly] = await Promise.all([
    reader ? reader().catch((err) => (console.error("rétrospective : historique radar illisible", err instanceof Error ? err.message : String(err)), null)) : null,
    meteofrance.enabled() ? meteofrance.recentRain(cache, now).then((r) => r?.hourly) : undefined,
  ]);
  const radar = kept && { ...kept, entrees: kept.entrees.filter((e) => endOf(e) > now.getTime() - KEEP_MS) };
  const body: Retro = { radar: radar?.entrees.length ? radar : null, vent: hourly ? hourlyWind(hourly) : [] };
  return new Response(JSON.stringify(body), { headers: { ...headers, "cache-control": "public, max-age=300" } });
}
