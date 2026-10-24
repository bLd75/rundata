/**
 * The quality of the bathing water at the beaches and river pools that the ARS checks (26 sites, src/eau/baignades.json):
 * every two weeks or so, a sample counted for E. coli and intestinal enterococci, published on the ministry of health's
 * site (baignades.sante.gouv.fr) with the site's classification for the season. The site has no API: each site's page
 * is read, one per season (October to September, named after the year it ends). A few kilobytes of table in it.
 */
import sites from "../eau/baignades.json" with { type: "json" };
import type { Cache, Cached } from "../cache.js";
import { getText } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "eaux_baignade",
  nom: "Contrôle sanitaire des eaux de baignade (ARS La Réunion, ministère chargé de la santé)",
  organisme: "Agence régionale de santé La Réunion, ministère chargé de la santé",
  licence: "Information publique (baignades.sante.gouv.fr)",
  attribution: "Ministère chargé de la santé, ARS La Réunion",
  url: "https://baignades.sante.gouv.fr/baignades/navigMap.do?idCarte=reu",
};

export interface Site {
  id: string;
  nom: string;
  commune: string;
  lon: number;
  lat: number;
}
export const SITES: Site[] = sites.sites;

// Per sample, the thresholds the ministry prints next to the results (/100 mL): good / average / bad.
export const LIMITS = { enterocoques: [100, 370], e_coli: [100, 1000] } as const;

export type Qualite = "bonne" | "moyenne" | "mauvaise";

export interface Sample {
  /** YYYY-MM-DD. */
  date: string;
  /** As printed: « <15 », « 46 ». Germs per 100 mL. */
  enterocoques: string;
  e_coli: string;
  qualite: Qualite | null;
}

export interface Results {
  site: Site;
  /** « site non classé », « excellente qualité »…, for the season named. */
  classement: { saison: number; texte: string } | null;
  prelevements: Sample[];
}

const page = (id: string, season: number) =>
  `https://baignades.sante.gouv.fr/baignades/consultSite.do?dptddass=974&site=${id}&plv=all&idCarte=reu&annee=${season}`;
// A sample every two weeks: read twice a day.
const FRESH_SECONDS = 12 * 3600;

const ENTITIES: Record<string, string> = { eacute: "é", egrave: "è", agrave: "à", ecirc: "ê", ocirc: "ô", nbsp: " ", amp: "&", "#39": "'" };
const unescape = (s: string) => s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m);

function count(v: string): number | null {
  const m = /^\s*<?\s*(\d+)/.exec(v);
  return m ? Number(m[1]) : null;
}

/** Good below both first limits, bad above either second one. */
export function quality(entero: string, ecoli: string): Qualite | null {
  const e = count(entero);
  const c = count(ecoli);
  if (e === null && c === null) return null;
  if ((e ?? 0) > LIMITS.enterocoques[1] || (c ?? 0) > LIMITS.e_coli[1]) return "mauvaise";
  if ((e ?? 0) > LIMITS.enterocoques[0] || (c ?? 0) > LIMITS.e_coli[0]) return "moyenne";
  return "bonne";
}

const cells = (row: string) => [...row.matchAll(/_resultat">\s*([^<]*?(?:<\s*\d[^<]*?)?)\s*<\/td>/g)].map((m) => m[1].trim());

/** One season's page: its classification and its samples (tables of five, the dates in the header). */
export function parsePage(html: string): { classement: { saison: number; texte: string } | null; samples: Sample[] } {
  const c = /Classement de l'ann(?:&eacute;|é)e\s+(\d{4})\s*:\s*([^<]+)</.exec(html);
  const samples: Sample[] = [];
  for (const block of html.split(/<!--\s*ENTETE\s*-->/).slice(1)) {
    const head = block.slice(0, block.indexOf("Valeur limite"));
    const dates = [...head.matchAll(/scope="Qualite">\s*(\d\d)\/(\d\d)\/(\d{4})\s*</g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`);
    const entero = /rocoques intestinaux[\s\S]*?<\/tr>/.exec(block)?.[0] ?? "";
    const ecoli = /Escherichia coli[\s\S]*?<\/tr>/.exec(block)?.[0] ?? "";
    const [e, k] = [cells(entero), cells(ecoli)];
    dates.forEach((date, i) => {
      if (!e[i] && !k[i]) return;
      samples.push({ date, enterocoques: e[i] ?? "", e_coli: k[i] ?? "", qualite: quality(e[i] ?? "", k[i] ?? "") });
    });
  }
  return { classement: c ? { saison: Number(c[1]), texte: unescape(c[2]).trim() } : null, samples };
}

/** The season under way, by the year it ends: October 2026 opens the season « 2027 ». */
export function season(now: Date): number {
  const local = new Date(now.getTime() + 4 * 3600_000);
  return local.getUTCFullYear() + (local.getUTCMonth() >= 9 ? 1 : 0);
}

export async function results(cache: Cache, site: Site, now = new Date()): Promise<Cached<Results>> {
  return cache.get(`baignade:${site.id}`, FRESH_SECONDS, async () => {
    const y = season(now);
    // The season just begun has few samples, if any: the one before completes it, and has the last classification.
    // The site answers in a second or two, but now and then a request hangs: a second try is quicker than a long wait.
    const read = async (url: string) => {
      try {
        return await getText(SOURCE.id, url, 8_000);
      } catch {
        return getText(SOURCE.id, url, 12_000);
      }
    };
    const pages = await Promise.all([y, y - 1].map((s) => read(page(site.id, s))));
    const parsed = pages.map(parsePage);
    const byDate = new Map<string, Sample>();
    for (const p of parsed) for (const s of p.samples) if (!byDate.has(s.date)) byDate.set(s.date, s);
    const classement = parsed.map((p) => p.classement).find((c) => c && !/non class/i.test(c.texte)) ?? parsed[0].classement;
    return { site, classement, prelevements: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)) };
  });
}
