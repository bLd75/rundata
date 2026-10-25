/**
 * Calendars of La Réunion, no key: school holidays of the académie de La Réunion (data.education.gouv.fr) and public
 * holidays, 20 December included (calendrier.api.gouv.fr). Sunrise and sunset are computed here.
 */
import type { Cache, Cached } from "../cache.js";
import { getJson } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SCHOOL: SourceInfo = {
  id: "education_calendrier",
  nom: "Calendrier scolaire de l'académie de La Réunion",
  organisme: "Ministère de l'Éducation nationale",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Ministère de l'Éducation nationale",
  url: "https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/",
};

export const HOLIDAYS: SourceInfo = {
  id: "jours_feries",
  nom: "Jours fériés à La Réunion",
  organisme: "Etalab (calendrier.api.gouv.fr)",
  licence: "Licence Ouverte Etalab 2.0",
  attribution: "Etalab",
  url: "https://calendrier.api.gouv.fr/jours-feries/",
};

// The latest first: the API gives 100 rows at most, and the years kept must be the current one and the next, not the
// oldest (59 rows in October 2026, five or six more each year). breaks() puts them back in order.
const SCHOOL_URL =
  "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records" +
  "?where=location%3D%22R%C3%A9union%22&order_by=start_date%20desc&limit=100&select=description,start_date,end_date,annee_scolaire";
const DAY_SECONDS = 24 * 3600;

export interface SchoolBreak {
  nom: string;
  /** First day off and the day classes resume, local dates YYYY-MM-DD. */
  debut: string;
  reprise: string | null;
  annee_scolaire: string;
}

/** The ministry writes midnight in Paris time ("2026-10-09T22:00:00+00:00" is 10 October). */
export function parisDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(iso));
}

export function breaks(rows: { description: string; start_date: string; end_date: string; annee_scolaire: string }[]): SchoolBreak[] {
  const seen = new Set<string>();
  const out: SchoolBreak[] = [];
  for (const r of rows) {
    const debut = parisDate(r.start_date);
    const reprise = r.end_date === r.start_date ? null : parisDate(r.end_date);
    const key = `${r.description}|${debut}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ nom: r.description.replace(/^Début des /, ""), debut, reprise, annee_scolaire: r.annee_scolaire });
  }
  return out.sort((a, b) => a.debut.localeCompare(b.debut));
}

export async function schoolBreaks(cache: Cache): Promise<Cached<SchoolBreak[]>> {
  return cache.get("calendrier:scolaire", DAY_SECONDS, async () =>
    breaks((await getJson<{ results: Parameters<typeof breaks>[0] }>(SCHOOL.id, SCHOOL_URL)).results),
  );
}

/** Public holidays of `year` and the next, date → name. */
export async function holidays(cache: Cache, year: number): Promise<Cached<Record<string, string>>> {
  return cache.get(`calendrier:feries:${year}`, DAY_SECONDS, async () => {
    const [a, b] = await Promise.all(
      [year, year + 1].map((y) => getJson<Record<string, string>>(HOLIDAYS.id, `https://calendrier.api.gouv.fr/jours-feries/la-reunion/${y}.json`)),
    );
    return { ...a, ...b };
  });
}

const RAD = Math.PI / 180;

/**
 * Sunrise and sunset (upper limb, with refraction) on a local date at a place, by the usual sunrise equation;
 * within a minute or two of the almanacs. `altitude_m` lowers the horizon a little.
 */
export function sun(date: string, lon: number, lat: number, altitude_m = 0): { lever: Date; coucher: Date } {
  // Local noon in Réunion (UTC+4) as a Julian day.
  const noonUtc = Date.parse(`${date}T08:00:00Z`);
  const jd = noonUtc / 86_400_000 + 2440587.5;
  const n = Math.round(jd - 2451545.0 + 0.0008);
  const jStar = n - lon / 360;
  const m = (357.5291 + 0.98560028 * jStar) % 360;
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = 2451545.0 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDecl = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const decl = Math.asin(sinDecl);
  const h0 = (-0.833 - (2.076 * Math.sqrt(Math.max(0, altitude_m))) / 60) * RAD;
  const cosW = (Math.sin(h0) - Math.sin(lat * RAD) * sinDecl) / (Math.cos(lat * RAD) * Math.cos(decl));
  const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / RAD;
  const toDate = (j: number) => new Date((j - 2440587.5) * 86_400_000);
  return { lever: toDate(transit - w / 360), coucher: toDate(transit + w / 360) };
}
