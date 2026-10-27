/**
 * Vigicrues Réunion (DEAL Réunion): the flood vigilance of the island's rivers and the height and flow of their 29
 * gauges, every 5 minutes. No documented API: these are the requests the site's own pages make (a form posted,
 * JSON back). Public information, free to reuse under the Etalab licence, citing « © VIGICRUES » and the date.
 *
 * The site writes its times in La Réunion's local time as if it were UTC: 4 hours are taken off.
 */
import { isScheduled } from "../budget.js";
import type { Cache } from "../cache.js";
import data from "../crues/stations.json" with { type: "json" };
import { postForm } from "../http.js";
import { type SourceInfo, why } from "../types.js";

export const SOURCE: SourceInfo = {
  id: "vigicrues",
  nom: "Vigicrues Réunion (vigilance crues, hauteurs et débits des rivières)",
  organisme: "DEAL Réunion",
  licence: "Licence Ouverte Etalab",
  attribution: "© VIGICRUES, DEAL Réunion",
  url: "https://www.vigicrues-reunion.re",
};

const BASE = "https://www.vigicrues-reunion.re/assets/php/vigicrues/";
const LOCAL_AS_UTC = 4 * 3600_000;
// Three hours of readings: the trend, and how high the river went just before.
const WINDOW_MS = 3 * 3600_000;
const LEVELS_SECONDS = 5 * 60;
const VIGILANCE_SECONDS = 10 * 60;
// The gauges asked together. The site takes about half a second per gauge, and from Cloudflare more than the 34 s
// given to all 29 at once (27/10/2026: every read of the heights cut since the evening before). Two batches at a
// time at most: a small site.
const BATCH = 8;
const LANES = 2;
// In the scheduled event, nobody waiting: one batch at a time, 25 s each. With the heights and the flows read together,
// two lanes each, the site had four requests at once, and batches of 8 it answers in 4 s from La Réunion were cut at
// 13 s (27/10/2026, at 11:55 and 12:10).
const SCHEDULED_TIMEOUT_MS = 25_000;

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
  return cache.island("crues:vigilance", VIGILANCE_SECONDS, async () =>
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

/** The readings of `ids`, in one request: the readings after the last time the site's page holds for each. */
async function ask(measure: Measure, ids: string[], now: Date, timeout = 5_000 + 1_000 * ids.length): Promise<Readings> {
  // Each gauge with the time of the last reading the page holds, in the site's local-as-UTC clock: the readings after it come back.
  const since = now.getTime() - WINDOW_MS + LOCAL_AS_UTC;
  const liste = JSON.stringify(Object.fromEntries(ids.map((id) => [id, since])));
  return parseReadings(await postForm<Record<string, unknown>>(SOURCE.id, `${BASE}valeurs.php`, { mesure: measure, liste }, timeout));
}

/** « 4,1 s », for the Worker's logs. */
const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

/**
 * The readings of some gauges, or of all. The site takes about half a second per gauge, so a question about one place
 * asks only for the gauges around it. All 29 are read by the scheduled event only (cache.ts `islandRead`), in batches
 * one at a time, and kept in KV for every data center: a question or a page is served that copy with its time.
 */
export async function readings(cache: Cache, measure: Measure, ids: string[] = STATIONS.map((s) => s.id), now = new Date()) {
  if (ids.length !== STATIONS.length) return cache.get(`crues:${measure}:${[...ids].sort().join(",")}`, LEVELS_SECONDS, () => ask(measure, ids, now));
  return cache.islandRead<Readings>(`crues:${measure}:all`, LEVELS_SECONDS, async (before) => {
    const batches = Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ids.slice(i * BATCH, (i + 1) * BATCH));
    const alone = isScheduled();
    const got: Readings[] = [];
    const missing: string[] = [];
    // How long each batch took, in the Worker's logs: what the site takes from Cloudflare, measured.
    const took: string[] = [];
    let failure: unknown;
    let next = 0;
    await Promise.all(
      Array.from({ length: alone ? 1 : LANES }, async () => {
        while (next < batches.length) {
          const i = next++;
          const start = Date.now();
          try {
            got.push(await ask(measure, batches[i], now, alone ? SCHEDULED_TIMEOUT_MS : undefined));
            took[i] = seconds(Date.now() - start);
          } catch (err) {
            failure ??= err;
            missing.push(...batches[i]);
            took[i] = `sans réponse après ${seconds(Date.now() - start)}`;
          }
        }
      }),
    );
    console.log(`source ${SOURCE.id}, ${measure} : ${batches.length} lots, ${alone ? "un à la fois" : `${LANES} à la fois`} : ${took.join(", ")}`);
    if (!got.length) throw failure;
    const out: Readings = Object.assign({}, ...got);
    if (missing.length) {
      console.error(`source ${SOURCE.id} sans réponse pour ${missing.length} stations (${measure}) : leurs mesures d'avant gardées`, why(failure));
      // A batch that did not answer: its gauges keep their own readings of the copy before, said with their time
      // (tools/crues.ts), never another gauge's.
      for (const id of missing) if (before?.[id]) out[id] = before[id];
    }
    return out;
  });
}
