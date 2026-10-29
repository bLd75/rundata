/**
 * The radar's history, for the replay bar of /meteo's map (rejeu.ts). Météo-France serves only its latest radar image,
 * so the scheduled event keeps them: each run reads the image (the one the tools read) and, when it is new, adds its
 * grid to one KV key, its runs of characters compressed. The key holds 6 hours, one image every 5 minutes, and a second
 * one an image a quarter of an hour over 24 hours. A run that cannot read the radar, or reads an image older than
 * STALE_MS, writes down a gap, said on the map as such (« Pas d'image radar de 14:05 à 14:20. »), never as a dry sky.
 */
import { count } from "../budget.js";
import type { Cache } from "../cache.js";
import { why } from "../types.js";
import { tokensIssued } from "../providers/mf-auth.js";
import * as radar from "../providers/radar.js";
import { grid, type RainGrid } from "./pluie-radar.js";

export const KV_KEY = "radar:6h";
/** Gone from KV an hour after the last write: a scheduled event that stopped leaves no old images behind. */
export const KV_TTL_SECONDS = 7 * 3600;
export const KEEP_MS = 6 * 3600_000;
/** The images a quarter of an hour over 24 hours, in their own key. */
export const LONG_KV_KEY = "radar:24h";
export const LONG_KV_TTL_SECONDS = 25 * 3600;
export const LONG_MS = 24 * 3600_000;
const QUARTER_MS = 15 * 60_000;
/** An image older than this when read is not the sky of now: a gap, as /meteo's live layer says. */
export const STALE_MS = 45 * 60_000;
const STEP_MS = 5 * 60_000;

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

export const isTrou = (e: Entree): e is Trou => "trou" in e;
export const endOf = (e: Entree) => Date.parse(isTrou(e) ? e.a : e.fin);
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

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
export async function passage(store: Store, cache: Cache, now = new Date(), long?: Store): Promise<string> {
  const tokens = tokensIssued();
  count();
  const before = await store.get();
  const lu = await radar.image(cache).then((img) => grid(img.value), (err: unknown) => (err instanceof Error ? err : new Error(String(err))));
  const next = suivant(before, lu, now);
  if (next) {
    count(1, true);
    await store.put(next);
  }
  // The 24 hours: read and written only when the quarters of the 6 hours end otherwise, about once a quarter of an hour.
  let longSaid = "";
  if (next && long) {
    const last = (h: Historique | null) => JSON.stringify(quarters(h?.entrees ?? []).at(-1) ?? null);
    if (last(before) !== last(next)) {
      count();
      const day = auQuart(await long.get(), next, now);
      count(1, true);
      await long.put(day);
      longSaid = `, 24 h : ${day.entrees.length} entrées écrites`;
    }
  }
  const said = lu instanceof Error ? `illisible (${why(lu)})` : `image finie à ${lu.fin}`;
  return `${said}, ${next ? `${next.entrees.length} entrées écrites` : "rien à écrire"}${longSaid}, jetons Météo-France pris : ${tokensIssued() - tokens}`;
}

export interface Store {
  get(): Promise<Historique | null>;
  put(h: Historique): Promise<void>;
}

/**
 * The quarters of the hour within `entrees`: at each, the image of the quarter, or the next one within 5 minutes (its
 * own time kept, never moved to the quarter); else the gap of the 6 hours it falls in, as it is.
 */
export function quarters(entrees: Entree[]): Entree[] {
  if (!entrees.length) return [];
  const out: Entree[] = [];
  const first = Math.ceil(endOf(entrees[0]) / QUARTER_MS) * QUARTER_MS;
  const lastEnd = endOf(entrees[entrees.length - 1]);
  for (let q = first; q <= lastEnd; q += QUARTER_MS) {
    const e = entrees.find((x) => (isTrou(x) ? Date.parse(x.de) < q && q <= Date.parse(x.a) : Date.parse(x.fin) >= q && Date.parse(x.fin) <= q + 5 * 60_000));
    if (e && e !== out[out.length - 1]) out.push(e);
  }
  return out;
}

/**
 * The 24 hours after a write of the 6 hours (`six`): what `before` held before the 6 hours start, then their quarters;
 * a gap where the two do not meet. Over LONG_MS old, gone.
 */
export function auQuart(before: Historique | null, six: Historique, now: Date): Historique {
  const recent = quarters(six.entrees);
  const r0 = recent[0];
  // Where the 6 hours' quarters start: the gap's start, or the image's quarter.
  const cut = !r0 ? now.getTime() : isTrou(r0) ? Date.parse(r0.de) : Date.parse(r0.fin);
  const same = before && before.w === six.w && before.h === six.h;
  const image = !!r0 && !isTrou(r0);
  const old = same ? before.entrees.filter((e) => (image ? endOf(e) < cut : endOf(e) <= cut) && endOf(e) > now.getTime() - LONG_MS) : [];
  const last = old[old.length - 1];
  const meet = image ? cut - QUARTER_MS : cut;
  const join: Entree[] = last && endOf(last) < meet ? [{ trou: true, de: iso(endOf(last)), a: iso(meet) }] : [];
  const merged = [...old, ...join, ...recent].reduce<Entree[]>((acc, e) => {
    const prev = acc[acc.length - 1];
    if (prev && isTrou(prev) && isTrou(e)) prev.a = e.a;
    else acc.push({ ...e });
    return acc;
  }, []);
  return { w: six.w, h: six.h, entrees: merged };
}
