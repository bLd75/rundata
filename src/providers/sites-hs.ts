/**
 * The mobile sites out of service at La Réunion, from the Arcep's file « Sites indisponibles » on data.gouv.fr: once a
 * day, the operators' own lists of their sites in failure or maintenance (an obligation of the New Deal Mobile since
 * 01/07/2018), gathered for the whole of France, 0.5 to 2.2 Mo. The Worker's scheduled event reads the file of the day
 * once it is out (`collect`, worker.ts), keeps La Réunion's lines and writes them to the KV store, where the page
 * /antennes and the commune pages read them (`sites`), never the file.
 * At La Réunion the file held only Free's sites on 29/10/2026: the page names the networks missing from the file read
 * (`absents`, web/antennes.ts), so that « aucun site » never reads as « aucune panne ». Free's own file, fresher, is not read: no licence is written for it. The file gives the day a failure began
 * and the day it should end, never its time zone: only the days are said. A site that leaves the file is never said
 * « rétabli »: it leaves the list.
 */
import { getText } from "../http.js";
import type { Cache, Cached } from "../cache.js";
import { UpstreamError, type SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "arcep_sites_indisponibles",
  nom: "Sites mobiles indisponibles (déclarations des opérateurs, New Deal Mobile)",
  organisme: "Arcep, d'après les fichiers des opérateurs",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Arcep, sites indisponibles",
  url: "https://www.data.gouv.fr/datasets/sites-indisponibles",
};

/** Written by the scheduled event (`collect`), read by worker.ts. */
export const KV_KEY = "antennes:hors-service:collecte";
/** Kept this long after the last write: a copy says its file's day, however old. */
export const KV_TTL_SECONDS = 30 * 86_400;

export interface Site {
  operateur: string;
  commune: string;
  insee: string;
  lon: number;
  lat: number;
  /** Cut in full, by the file's two columns: the voice (Free's « Service Voix / SMS ») and the mobile internet. */
  voix: boolean;
  data: boolean;
  /** When neither is cut in full: the generations cut, « 2 » for the voice in 2G, « 3 » for the internet in 3G. */
  voix_g?: string;
  data_g?: string;
  /** « panne » for INT, « maintenance » for MAINT; absent when the file gives none. */
  raison?: "panne" | "maintenance";
  /** Days only, YYYY-MM-DD: the file gives no time zone. */
  debut?: string;
  fin?: string;
}

export interface Copie {
  /** The day of the file, YYYY-MM-DD (its folder at the Arcep). */
  fichier_du: string;
  /** When the collector read it (ISO, UTC). */
  lu: string;
  sites: Site[];
}

interface Feature {
  properties: Record<string, string | null | number>;
  geometry?: { coordinates?: [number, number] };
}

const DAY = /^\d{4}-\d\d-\d\d/;
const day = (v: unknown) => (typeof v === "string" && DAY.test(v) ? v.slice(0, 10) : undefined);
const RAISONS: Record<string, Site["raison"]> = { INT: "panne", MAINT: "maintenance" };

/** La Réunion's site on a line of the file; undefined for another department's. */
export function site(f: Feature): Site | undefined {
  const p = f.properties;
  if (String(p.departement ?? "").trim() !== "974" && !String(p.code_insee ?? "").startsWith("974")) return undefined;
  const hs = (k: string) => p[k] === "HS";
  const voix = hs("voix"), data = hs("data");
  const gens = (keys: [string, string][]) => keys.filter(([k]) => hs(k)).map(([, g]) => g).join("");
  const voix_g = voix || data ? "" : gens([["voix2g", "2"], ["voix3g", "3"], ["voix4g", "4"]]);
  const data_g = voix || data ? "" : gens([["data3g", "3"], ["data4g", "4"], ["data5g", "5"]]);
  const [lon, lat] = f.geometry?.coordinates ?? [NaN, NaN];
  const raison = RAISONS[String(p.raison ?? "")];
  const debut = day(p.debut) ?? day(p.debut_voix) ?? day(p.debut_data);
  const fin = day(p.fin) ?? day(p.fin_voix) ?? day(p.fin_data);
  return {
    operateur: String(p.operateur ?? ""),
    commune: String(p.commune ?? ""),
    insee: String(p.code_insee ?? ""),
    lon,
    lat,
    voix,
    data,
    ...(voix_g && { voix_g }),
    ...(data_g && { data_g }),
    ...(raison && { raison }),
    ...(debut && { debut }),
    ...(fin && { fin }),
  };
}

const FILES = "https://arcep.s3.rbx.io.cloud.ovh.net/sites-indisponibles/all";
/** The file of a day (UTC, as its folder). */
export const fileOf = (d: string) => `${FILES}/${d}/raw${d}.geojson`;

/**
 * Every hour at half past, from 10:30 to 19:30 UTC (14:30 to 23:30 in La Réunion), until the file of the day is read:
 * the Arcep publishes it between 09:00 and 10:05 UTC (data.gouv.fr, 22 to 29/10/2026). Once it is read, each later pass
 * reads the copy only. At half past, never with the charging points' file (9 Mo, at 5, 20, 35 and 50 past).
 */
export const FIRST_HOUR = 10;
export const LAST_HOUR = 19;
export const REFRESH_OFFSET = 30;
export const refreshDue = (now: Date) =>
  now.getUTCHours() >= FIRST_HOUR && now.getUTCHours() <= LAST_HOUR && now.getUTCMinutes() >= REFRESH_OFFSET && now.getUTCMinutes() < REFRESH_OFFSET + 5;

/**
 * The scheduled event's read: the file of the day, unless the copy is of that day already. Not out yet (404 or 403 of
 * the storage): nothing written, the copy before stays. Written each time the file of a new day is read, even with no
 * site, so that the page says the day of the last file read.
 */
export async function collect(before: Copie | null, write: (copie: Copie) => Promise<void>, now = new Date()): Promise<string> {
  const d = now.toISOString().slice(0, 10);
  if (before?.fichier_du === d) return `fichier du ${d} déjà lu : ${before.sites.length} sites`;
  let text: string;
  try {
    text = await getText(SOURCE.id, fileOf(d), 30_000);
  } catch (err) {
    if (err instanceof UpstreamError && (err.status === 404 || err.status === 403)) return `fichier du ${d} pas encore publié`;
    throw err;
  }
  const features = (JSON.parse(text) as { features?: Feature[] }).features;
  if (!Array.isArray(features)) throw new Error(`fichier du ${d} sans liste de sites`);
  const sites = features.flatMap((f) => site(f) ?? []).sort((a, b) => a.commune.localeCompare(b.commune, "fr") || a.operateur.localeCompare(b.operateur));
  await write({ fichier_du: d, lu: now.toISOString(), sites });
  return `fichier du ${d} : ${features.length} sites en France, ${sites.length} à La Réunion, écrits`;
}

let reader: (() => Promise<Copie | null>) | undefined;

/** In the Worker: read the sites from the KV store, where the scheduled event writes them, and the file never. */
export function configure(read: (() => Promise<Copie | null>) | undefined) {
  reader = read;
}

const FRESH_SECONDS = 60 * 60;

/**
 * The stored copy, its time the collector's read; null where nothing is configured (a local server, the tests) or
 * nothing is stored yet.
 */
export async function sites(cache: Cache): Promise<Cached<Copie> | null> {
  if (!reader) return null;
  const read = reader;
  try {
    const c = await cache.getCopy("antennes:hors-service", FRESH_SECONDS, async () => {
      const v = await read();
      if (!v) throw new Error("sites hors service absents du stockage");
      return v;
    }, (v) => v.lu);
    return { ...c, fetchedAt: new Date(c.value.lu) };
  } catch {
    return null;
  }
}
