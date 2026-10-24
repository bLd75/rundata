/**
 * Vigicrues Réunion (DEAL Réunion): the flood vigilance of the island's rivers and the height and flow of their 29
 * gauges, every 5 minutes. No documented API: these are the requests the site's own pages make (a form posted,
 * JSON back). Public information, free to reuse under the Etalab licence, citing « © VIGICRUES » and the date.
 *
 * The site writes its times in La Réunion's local time as if it were UTC: 4 hours are taken off.
 */
import type { Cache } from "../cache.js";
import data from "../crues/stations.json" with { type: "json" };
import { postForm } from "../http.js";
import type { SourceInfo } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "vigicrues",
  nom: "Vigicrues Réunion (vigilance crues, hauteurs et débits des rivières)",
  organisme: "DEAL Réunion",
  licence: "Licence Ouverte (Etalab)",
  attribution: "© VIGICRUES, DEAL Réunion",
  url: "https://www.vigicrues-reunion.re",
};

const BASE = "https://www.vigicrues-reunion.re/assets/php/vigicrues/";
const LOCAL_AS_UTC = 4 * 3600_000;
// Three hours of readings: the trend, and how high the river went just before.
const WINDOW_MS = 3 * 3600_000;
const LEVELS_SECONDS = 5 * 60;
const VIGILANCE_SECONDS = 10 * 60;

export interface Station {
  id: string;
  nom: string;
  riviere: string;
  bassin: string;
  secteur: string;
  code_hydro: string;
  commune: string;
  lon: number;
  lat: number;
  crues: { nom: string; hauteur_m: number; debit_m3s: number }[];
}

export const STATIONS = data.stations as Station[];

export const COLOURS = ["indisponible", "vert", "jaune", "orange", "rouge"] as const;
export type Colour = (typeof COLOURS)[number];

export interface River {
  nom: string;
  couleur: Colour;
  precedente: Colour;
}

export interface Vigilance {
  /** False outside a flood episode: no bulletin in force, every river green. */
  active: boolean;
  bulletin: number;
  /** ISO time of the last bulletin. */
  date: string;
  observations: string;
  anticipation: string;
  rivieres: River[];
}

/** Local time written as « 2026-08-07 06:22:04 » → ISO UTC. */
export function localToIso(s: string): string {
  const t = Date.parse(s.replace(" ", "T") + "Z") - LOCAL_AS_UTC;
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

/**
 * Text only, read one character at a time: everything between « < » and « > » is a tag and dropped, a line break or a
 * paragraph becomes a space. A broken tag cannot leave anything that still reads as one.
 */
function plain(html: unknown): string {
  let out = "";
  let tag: string | undefined;
  for (const ch of String(html ?? "")) {
    if (ch === "<") tag = "";
    else if (ch === ">" && tag !== undefined) {
      if (/^\/?(br|p|div|li)\b/i.test(tag)) out += " ";
      tag = undefined;
    } else if (tag !== undefined) tag += ch;
    else if (ch !== ">") out += ch;
  }
  return out.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

const colour = (n: unknown): Colour => COLOURS[typeof n === "number" && n >= 0 && n < COLOURS.length ? n : 0];

export function parseVigilance(raw: unknown[][]): Vigilance {
  const [head, ...rivers] = raw;
  return {
    active: head[0] === true,
    bulletin: Number(head[1]) || 0,
    date: localToIso(String(head[2] ?? "")),
    observations: plain(head[3]),
    anticipation: plain(head[4]),
    rivieres: rivers.map((r) => ({ nom: String(r[0]), couleur: colour(r[1]), precedente: colour(r[2]) })),
  };
}

export async function vigilance(cache: Cache) {
  return cache.get("crues:vigilance", VIGILANCE_SECONDS, async () =>
    parseVigilance(await postForm<unknown[][]>(SOURCE.id, `${BASE}vigilance.php`, { id: "public" })),
  );
}

export type Measure = "hauteur" | "debit";
/** For each gauge, its readings: [UTC milliseconds, value], oldest first. */
export type Readings = Record<string, [number, number][]>;

export function parseReadings(raw: Record<string, unknown>): Readings {
  const out: Readings = {};
  for (const s of STATIONS) {
    const list = raw[s.id];
    if (!Array.isArray(list)) continue;
    out[s.id] = list
      .filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number")
      .map(([t, v]) => [t - LOCAL_AS_UTC, v] as [number, number]);
  }
  return out;
}

/**
 * The readings of some gauges, or of all. The site takes about half a second per gauge (15 s for all 29), so a
 * question about one place asks only for the gauges around it.
 */
export async function readings(cache: Cache, measure: Measure, ids: string[] = STATIONS.map((s) => s.id), now = new Date()) {
  const key = ids.length === STATIONS.length ? "all" : [...ids].sort().join(",");
  return cache.get(`crues:${measure}:${key}`, LEVELS_SECONDS, async () => {
    // Each gauge with the time of the last reading the page holds, in the site's local-as-UTC clock: the readings after it come back.
    const since = now.getTime() - WINDOW_MS + LOCAL_AS_UTC;
    const liste = JSON.stringify(Object.fromEntries(ids.map((id) => [id, since])));
    const timeout = 5_000 + 1_000 * ids.length;
    return parseReadings(await postForm<Record<string, unknown>>(SOURCE.id, `${BASE}valeurs.php`, { mesure: measure, liste }, timeout));
  });
}
