/**
 * The path already travelled by a system the RSMC of La Réunion (Météo-France) watches, for the basin's map on /cyclones
 * (web/cyclones-bassin.ts): its successive positions at the RSMC's advisories, the last with its name, its stage and the
 * advisory's time. Nothing of the future: no forecast track, no cone, no distance to La Réunion (the user's decision of
 * 31/10/2026). The RSMC's own map, with its forecast, stays above (cmrs-carte.ts).
 *
 * - The source is the RSMC's bulletin WTIO31 FMEE (« Bulletin d'analyse et de prévision cyclonique », in French), sent
 *   on the WMO's network and copied by the NOAA in one file (`URL`), replaced at each advisory, whichever system it is
 *   about. Of it, only its number, the system's stage and name, and the position of « 2.A » are kept: never its
 *   forecasts (« 1.B » and after), its winds nor its comments.
 * - That bulletin is not open data: nothing is read, kept nor shown before `ACCORD`, the date of Météo-France's written
 *   agreement, is set. Until then, no request and no read of KV.
 * - Read by the scheduled event only, and only while GDACS (cyclones.ts) has an active system: every 5 minutes from 25
 *   minutes to 2 h 30 after each synoptic hour (00, 06, 12 and 18 UTC), the RSMC's bulletins being out about an hour
 *   after it. With two systems, their bulletins come one after the other into the same file: read this often, each is
 *   seen. A bulletin missed leaves a gap, said by its number.
 * - The positions are kept in KV, one list per system, written only when a new bulletin comes (about 4 a day each).
 */
import type { Cache } from "../cache.js";
import { count, perInvocation } from "../budget.js";
import { getText } from "../http.js";
import { why } from "../types.js";
import * as gdacs from "./cyclones.js";
import type { Store } from "./vigilance-carte.js";

/** The date of Météo-France's written agreement to show these positions (« 2026-11-03 »); null: nothing is read nor shown. */
export const ACCORD: string | null = null;
let ouvert = ACCORD !== null;
export const enLigne = () => ouvert;
/** For the tests: the trace read and shown, or not, whatever the agreement. */
export function ouvrir(v: boolean) {
  ouvert = v;
}

const SOURCE_ID = "meteofrance_cmrs_wtio31";
export const URL = "https://tgftp.nws.noaa.gov/data/raw/wt/wtio31.fmee..txt";

/** The minutes after each synoptic hour (00, 06, 12, 18 UTC) the scheduled event reads the bulletin: from 25 to 150. */
export const FROM_MINUTE = 25;
export const TO_MINUTE = 150;
/** A system's trace is shown while its last advisory is newer than this, as GDACS's active systems (cyclones.ts). */
export const SHOWN_HOURS = gdacs.ACTIVE_HOURS;

const KEY = "cmrs:trace";
// Kept 30 days after the last bulletin read, then forgotten; a system is dropped 30 days after its last advisory.
const TTL_SECONDS = 30 * 86_400;
const TIMEOUT_MS = 20_000;
const MAX_POINTS = 200;
const HOUR = 3_600_000;

let store: Store | undefined;

/** The Worker's KV (worker.ts). Without it, nothing is read, kept or shown. */
export function configure(kv?: Store): void {
  store = kv;
}

/** One advisory, as its bulletin gives it. */
export interface Avis {
  /** The bulletin's number for this system, its system's number in the season, and the season (« 20262027 »). */
  numero: number;
  systeme: number;
  saison: string;
  /** « Agueda », or « système n° 2 (non baptisé) ». */
  nom: string;
  /** In the RSMC's words: « tempête tropicale modérée ». */
  stade: string;
  /** The position's time, ISO, UTC. */
  heure: string;
  lon: number;
  lat: number;
}

/** A system's positions, oldest first. */
export interface Trace {
  saison: string;
  systeme: number;
  nom: string;
  points: { numero: number; heure: string; lon: number; lat: number; stade: string }[];
}

/** What the scheduled event keeps. */
export interface Etat {
  traces: Trace[];
  /** The last read that succeeded, and the last that failed since, ISO. */
  lu?: string;
  echec?: string;
}

/** What the page draws of a system: its positions (lon, lat), oldest first, and the last advisory's. */
export interface Parcours {
  nom: string;
  stade: string;
  /** The last advisory's time, ISO, UTC. */
  heure: string;
  points: [number, number][];
  /** The first and last advisories read, and how many between them were missed. */
  premier: number;
  dernier: number;
  manquent: number;
}

/** The RSMC's stages, as its bulletins write them (capitals, no accent), in its words. */
const STADES: Record<string, string> = Object.fromEntries(
  Object.values(gdacs.STAGES).map((s) => [squash(s), s]),
);

function squash(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z]/g, "").toUpperCase();
}

/** « DEPRESSION RESIDUELLE » → « dépression résiduelle »; a stage not known, in small letters as written. */
export function stade(s: string): string {
  return STADES[squash(s)] ?? s.trim().toLowerCase();
}

/**
 * The advisory of a bulletin WTIO31 FMEE: its number (« 0.A »), its system's stage and name (« 1.A ») and its position
 * (« 2.A »), nothing else. Undefined when one is missing or not as expected.
 */
export function parse(raw: string): Avis | undefined {
  const text = raw.replace(/\r/g, "");
  if (!/^WTIO31 FMEE \d{6}/m.test(text)) return undefined;
  const num = /^0\.A NUMERO DU BULLETIN\s*:\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d{8})\s*$/m.exec(text);
  const sys = /^1\.A (.+?) (\d+)(?: \(([A-Z' -]+)\))?\s*$/m.exec(text);
  const pos = /^2\.A POSITION A (\d\d)(\d\d) UTC LE (\d\d)\/(\d\d)\/(\d{4})\s*:\s*\n.*?POINT (\d+(?:\.\d+)?) ([NS]) \/ (\d+(?:\.\d+)?) ([EW])/m.exec(text);
  if (!num || !sys || !pos || +sys[2] !== +num[2]) return undefined;
  const t = new Date(Date.UTC(+pos[5], +pos[4] - 1, +pos[3], +pos[1], +pos[2]));
  if (Number.isNaN(t.getTime()) || t.getUTCDate() !== +pos[3] || t.getUTCHours() !== +pos[1]) return undefined;
  const lat = +pos[6] * (pos[7] === "S" ? -1 : 1);
  const lon = +pos[8] * (pos[9] === "W" ? -1 : 1);
  if (!gdacs.inBasin(lon, Math.min(lat, 0))) return undefined;
  const nom = sys[3]
    ? sys[3].toLowerCase().replace(/(^|[ '-])\p{L}/gu, (c) => c.toUpperCase())
    : `système n° ${+sys[2]} (non baptisé)`;
  return { numero: +num[1], systeme: +num[2], saison: num[3], nom, stade: stade(sys[1]), heure: t.toISOString(), lon, lat };
}

/** The state with an advisory added: once per number, in order; a named system's name given to all its positions. */
export function ajoute(e: Etat, a: Avis, now: Date): Etat {
  const keep = e.traces.filter((t) => now.getTime() - Date.parse(t.points[t.points.length - 1].heure) < TTL_SECONDS * 1000);
  const i = keep.findIndex((t) => t.saison === a.saison && t.systeme === a.systeme);
  const old = i >= 0 ? keep[i] : { saison: a.saison, systeme: a.systeme, nom: a.nom, points: [] };
  if (old.points.some((p) => p.numero === a.numero)) return keep.length === e.traces.length ? e : { ...e, traces: keep };
  const points = [...old.points, { numero: a.numero, heure: a.heure, lon: a.lon, lat: a.lat, stade: a.stade }]
    .sort((x, y) => x.numero - y.numero)
    .slice(-MAX_POINTS);
  // The newest bulletin names the system: a disturbance named once it is a storm.
  const nom = points[points.length - 1].numero === a.numero ? a.nom : old.nom;
  const t = { ...old, nom, points };
  return { ...e, traces: i >= 0 ? keep.map((x, k) => (k === i ? t : x)) : [...keep, t] };
}

/** What the page draws: the systems whose last advisory is newer than SHOWN_HOURS, newest first. */
export function parcours(e: Etat, now: Date): Parcours[] {
  return e.traces
    .filter((t) => t.points.length && now.getTime() - Date.parse(t.points[t.points.length - 1].heure) < SHOWN_HOURS * HOUR)
    .map((t) => {
      const last = t.points[t.points.length - 1];
      const premier = t.points[0].numero;
      return {
        nom: t.nom,
        stade: last.stade,
        heure: last.heure,
        points: t.points.map((p): [number, number] => [p.lon, p.lat]),
        premier,
        dernier: last.numero,
        manquent: last.numero - premier + 1 - t.points.length,
      };
    })
    .sort((a, b) => b.heure.localeCompare(a.heure));
}

/** Whether the scheduled event at `now` (every 5 minutes) reads the bulletin. */
export function due(now: Date): boolean {
  const m = (now.getUTCHours() % 6) * 60 + now.getUTCMinutes();
  return m >= FROM_MINUTE && m < TO_MINUTE;
}

async function etat(): Promise<Etat | undefined> {
  if (!store) return undefined;
  count(1, "read");
  return ((await store.json(KEY)) as Etat | null) ?? undefined;
}

/** The systems to draw, for a page: one read of KV per invocation, none before the agreement. Never throws. */
export function kept(now = new Date()): Promise<Parcours[]> {
  if (!enLigne()) return Promise.resolve([]);
  return perInvocation("cmrs:trace", async () => {
    try {
      const e = await etat();
      return e ? parcours(e, now) : [];
    } catch (err) {
      console.error("trace du CMRS : état illisible", why(err));
      return [];
    }
  });
}

/**
 * The scheduled event's turn: nothing before the agreement, outside the minutes of `due` or without an active system;
 * else one read of the bulletin, and the state written if it changed. Returns what it did, for the log.
 */
export async function passage(cache: Cache, now = new Date()): Promise<string> {
  if (!enLigne()) return "pas d'accord";
  if (!store || !due(now)) return "rien à lire";
  const list = (await gdacs.systemes(cache, now)).value;
  if (!list.some((s) => gdacs.isActive(s, now))) return "aucun système actif";
  const before = (await etat()) ?? { traces: [] };
  let after: Etat, dit: string;
  try {
    const a = parse(await getText(SOURCE_ID, URL, TIMEOUT_MS));
    const { echec: _, ...rest } = before;
    after = a ? { ...ajoute(rest, a, now), lu: now.toISOString() } : { ...before, echec: now.toISOString() };
    dit = a ? `bulletin ${a.numero}/${a.systeme} (${a.nom})` : "bulletin illisible";
  } catch (err) {
    console.error("trace du CMRS : bulletin indisponible", why(err));
    after = { ...before, echec: now.toISOString() };
    dit = "bulletin sans réponse";
  }
  // The time of a read alone is not worth a write: only a new position, or a failure after a success, or back.
  const changed = JSON.stringify(after.traces) !== JSON.stringify(before.traces) || !!after.echec !== !!before.echec;
  if (changed) {
    count(1, true);
    await store.put(KEY, JSON.stringify(after), TTL_SECONDS);
  }
  return dit;
}
