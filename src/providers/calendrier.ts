/**
 * Calendars of La Réunion, no key: school holidays of the académie de La Réunion (data.education.gouv.fr) and public
 * holidays, 20 December included (calendrier.api.gouv.fr). Sunrise and sunset, and the Moon, are computed here.
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
  nom: "Jours fériés à La Réunion (Etalab, calendrier.api.gouv.fr)",
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

// ---------------------------------------------------------------- the Moon

const DEG = (x: number) => x * RAD;
const wrap = (x: number) => ((x % 360) + 360) % 360;
const J2000 = Date.UTC(2000, 0, 1, 12);
const days = (t: Date) => (t.getTime() - J2000) / 86_400_000;

/** The Sun's apparent ecliptic longitude (°), from the equinox of the date as the Moon's (Meeus, chapter 25). */
function sunLongitude(d: number): number {
  const m = DEG(357.52911 + 0.98560028 * d);
  const c = 1.914602 * Math.sin(m) + 0.019993 * Math.sin(2 * m) + 0.000289 * Math.sin(3 * m);
  return wrap(280.46646 + 0.98564736 * d + c - 0.00569);
}

// The largest periodic terms of the Moon's longitude (°), on D, M (the Sun's anomaly), M' and F (Meeus, Astronomical
// Algorithms, table 47.A): those above 0.004°.
const LONGITUDE: [number, number, number, number, number][] = [
  [0, 0, 1, 0, 6.288774], [2, 0, -1, 0, 1.274027], [2, 0, 0, 0, 0.658314], [0, 0, 2, 0, 0.213618], [0, 1, 0, 0, -0.185116],
  [0, 0, 0, 2, -0.114332], [2, 0, -2, 0, 0.058793], [2, -1, -1, 0, 0.057066], [2, 0, 1, 0, 0.053322], [2, -1, 0, 0, 0.045758],
  [0, 1, -1, 0, -0.040923], [1, 0, 0, 0, -0.03472], [0, 1, 1, 0, -0.030383], [2, 0, 0, -2, 0.015327], [0, 0, 1, 2, -0.012528],
  [0, 0, 1, -2, 0.01098], [4, 0, -1, 0, 0.010675], [0, 0, 3, 0, 0.010034], [4, 0, -2, 0, 0.008548], [2, 1, -1, 0, -0.007888],
  [2, 1, 0, 0, -0.006766], [1, 0, -1, 0, -0.005163], [1, 1, 0, 0, 0.004987], [2, -1, 1, 0, 0.004036],
];

/**
 * The Moon's ecliptic longitude and latitude (°) and distance (km), by the largest terms of its theory (Meeus, chapter
 * 47): the main phases within a few minutes, its rising and setting within a minute or two.
 */
export function moonPosition(t: Date): { lon: number; lat: number; km: number } {
  const d = days(t);
  const l = 218.3164477 + 13.17639648 * d;
  const e = DEG(297.8501921 + 12.19074912 * d);
  const ms = DEG(357.5291092 + 0.98560028 * d);
  const m = DEG(134.9633964 + 13.06499295 * d);
  const f = DEG(93.272095 + 13.22935024 * d);
  let lon = l;
  for (const [cd, cms, cm, cf, a] of LONGITUDE) lon += a * Math.sin(cd * e + cms * ms + cm * m + cf * f);
  const lat = 5.128122 * Math.sin(f) + 0.280602 * Math.sin(m + f) + 0.277693 * Math.sin(m - f) + 0.173237 * Math.sin(2 * e - f);
  const km = 385000.56 - 20905.355 * Math.cos(m) - 3699.111 * Math.cos(2 * e - m) - 2955.968 * Math.cos(2 * e);
  return { lon: wrap(lon), lat, km };
}

/** The Moon's height above the horizon (°) at a place, seen from the Earth's centre. */
function moonHeight(t: Date, lon: number, lat: number): { h: number; km: number } {
  const p = moonPosition(t);
  const eps = DEG(23.4397);
  const l = DEG(p.lon);
  const b = DEG(p.lat);
  const ra = Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l));
  const hour = DEG(280.46061837 + 360.98564736629 * days(t) + lon) - ra;
  const h = Math.asin(Math.sin(DEG(lat)) * Math.sin(dec) + Math.cos(DEG(lat)) * Math.cos(dec) * Math.cos(hour)) / RAD;
  return { h, km: p.km };
}

/** How much of the Moon's disc is lit (0 to 1), and its age as the angle from the Sun (0 new, 180 full). */
export function moonLight(t: Date): { fraction: number; angle: number } {
  const d = days(t);
  const p = moonPosition(t);
  const angle = wrap(p.lon - sunLongitude(d));
  const elong = Math.acos(Math.cos(DEG(p.lat)) * Math.cos(DEG(angle)));
  const phase = Math.atan2(149_598_000 * Math.sin(elong), p.km - 149_598_000 * Math.cos(elong));
  return { fraction: (1 + Math.cos(phase)) / 2, angle };
}

/**
 * Moonrise and moonset (upper limb, with refraction and the Moon's parallax) on a local date at a place, or null for the
 * one that does not happen that day (about once a month each). `altitude_m` lowers the horizon a little, as for the Sun.
 */
export function moon(date: string, lon: number, lat: number, altitude_m = 0): { lever: Date | null; coucher: Date | null } {
  const start = Date.parse(`${date}T00:00:00+04:00`);
  const dip = (2.076 * Math.sqrt(Math.max(0, altitude_m))) / 60;
  // Above the horizon by more than this, the upper limb shows: parallax less semi-diameter and refraction.
  const above = (t: number) => {
    const { h, km } = moonHeight(new Date(t), lon, lat);
    return h - (0.7275 * Math.asin(6378.14 / km) / RAD - 0.5667 - dip);
  };
  const STEP = 10 * 60_000;
  let lever: Date | null = null;
  let coucher: Date | null = null;
  let t0 = start;
  let v0 = above(t0);
  for (let t1 = start + STEP; t1 <= start + 24 * 3600_000; t1 += STEP) {
    const v1 = above(t1);
    if ((v0 < 0) !== (v1 < 0)) {
      // A crossing within these 10 minutes, found to the second.
      let [a, b, va] = [t0, t1, v0];
      while (b - a > 1000) {
        const mid = (a + b) / 2;
        const vm = above(mid);
        if ((vm < 0) === (va < 0)) [a, va] = [mid, vm];
        else b = mid;
      }
      if (v0 < 0) lever ??= new Date(b);
      else coucher ??= new Date(b);
    }
    [t0, v0] = [t1, v1];
  }
  return { lever, coucher };
}

export type MoonPhase = "nouvelle lune" | "premier quartier" | "pleine lune" | "dernier quartier";
const PHASES: MoonPhase[] = ["nouvelle lune", "premier quartier", "pleine lune", "dernier quartier"];

/** The next `n` main phases after `from`, to the minute or so. */
export function nextPhases(from: Date, n: number): { phase: MoonPhase; at: Date }[] {
  const out: { phase: MoonPhase; at: Date }[] = [];
  const STEP = 6 * 3600_000;
  const quarter = (t: number) => Math.floor(moonLight(new Date(t)).angle / 90);
  let t0 = from.getTime();
  let q0 = quarter(t0);
  while (out.length < n) {
    const t1 = t0 + STEP;
    const q1 = quarter(t1);
    if (q1 !== q0) {
      let [a, b] = [t0, t1];
      while (b - a > 30_000) {
        const mid = (a + b) / 2;
        if (quarter(mid) === q0) a = mid;
        else b = mid;
      }
      out.push({ phase: PHASES[q1], at: new Date(Math.round(b / 60_000) * 60_000) });
    }
    [t0, q0] = [t1, q1];
  }
  return out;
}

/** The Moon between the main phases, from its angle to the Sun: waxing or waning, said with how much is lit. */
export function between(angle: number): string {
  return angle < 180 ? "Lune croissante" : "Lune décroissante";
}
