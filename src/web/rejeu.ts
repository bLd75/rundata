/**
 * The files of /meteo's replay bar, one a length, each asked by the page only when its visitor plays it:
 * - 6 hours: the radar's images, one every 5 minutes (pluie-retro.ts), and the stations' last 6 round hours;
 * - 24 hours: the radar's images, one a quarter of an hour, and the stations' last 24 round hours;
 * - 7 days: the stations' round hours of the week, no radar.
 * The stations' hours are Météo-France's hourly package (providers/meteofrance.ts), already read for /meteo: the
 * temperature and the wind at each round hour, the rain of the hour before it. It holds 24 hours; the week is kept in
 * KV (SEMAINE_KV_KEY), merged with each newer package a data center already holds, never one asked for it, and at
 * first from the hourly archive in D1 (providers/climat.ts). Each file is kept by the data center as long as nothing
 * newer can be in it.
 */
import { count } from "../budget.js";
import type { Cache } from "../cache.js";
import * as climat from "../providers/climat.js";
import * as meteofrance from "../providers/meteofrance.js";
import { project } from "./map.js";
import { endOf, type Historique, KEEP_MS, LONG_MS } from "./pluie-retro.js";

export const DUREES = ["6h", "24h", "7j"] as const;
export type Duree = (typeof DUREES)[number];
export const PATHS: Record<Duree, string> = { "6h": "/meteo/rejeu-6h.json", "24h": "/meteo/rejeu-24h.json", "7j": "/meteo/rejeu-7j.json" };

/** The round hours of each file: 6 hours are 7 of them, the first one starting the 6 hours. */
export const HEURES: Record<Duree, number> = { "6h": 7, "24h": 24, "7j": 7 * 24 + 1 };
export const SEMAINE_KV_KEY = "stations:7j";
export const SEMAINE_KV_TTL_SECONDS = 8 * 86_400;
/** The archive in D1 is read again for the hours the week lacks no more than once in this time. */
const D1_AGAIN_MS = 6 * 3600_000;
const HOUR_MS = 3_600_000;
const FIELDS = ["t", "rr", "ff", "dd"] as const;
type Field = (typeof FIELDS)[number];

/** A station's hours, oldest first, the last one ending at the file's `fin`: °C, mm, km/h, degrees; null when not measured. */
export type Series = Record<Field, (number | null)[]>;

/** The week as kept in KV: each station's HEURES["7j"] hours up to `fin`; `d1`, when the archive was last read. */
export interface Semaine {
  fin: string;
  st: Record<string, Series>;
  d1?: string;
}

/** A station of a file: its place on the map, its altitude (for the temperatures' veil), its hours. */
export interface SerieCarte extends Series {
  id: string;
  x: number;
  y: number;
  alt: number;
}

export interface Heures {
  /** The end of the newest hour, ISO UTC. */
  fin: string;
  heures: number;
  st: SerieCarte[];
}

export interface Rejeu {
  radar?: Historique | null;
  heures: Heures | null;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const empty = (n: number): Series => ({ t: Array(n).fill(null), rr: Array(n).fill(null), ff: Array(n).fill(null), dd: Array(n).fill(null) });

/** The hours of `semaine`, or of none, shifted to end at `fin`, with the package's hours over them. */
export function merge(before: Semaine | null, hourly: meteofrance.HourlyRain | undefined, now: Date): Semaine | null {
  const n = HEURES["7j"];
  const fin = Math.max(before ? Date.parse(before.fin) : 0, hourly ? Date.parse(hourly.end) : 0);
  if (!fin || fin > now.getTime()) return before;
  const st: Record<string, Series> = {};
  const at = (ms: number) => n - 1 - Math.round((fin - ms) / HOUR_MS);
  if (before) {
    const end = Date.parse(before.fin);
    for (const [id, s] of Object.entries(before.st)) {
      const out = (st[id] = empty(n));
      for (const f of FIELDS) s[f].forEach((v, i) => {
        const k = at(end - (s[f].length - 1 - i) * HOUR_MS);
        if (k >= 0 && k < n && v != null) out[f][k] = v;
      });
    }
  }
  if (hourly) {
    for (const s of meteofrance.stations()) {
      for (const h of meteofrance.stationHours(hourly, s.id)) {
        const k = at(Date.parse(h.fin));
        if (k < 0 || k >= n) continue;
        const out = (st[s.id] ??= empty(n));
        const v = { t: h.t, rr: h.rr, ff: h.ff, dd: h.dd };
        for (const f of FIELDS) if (v[f] != null) out[f][k] = v[f];
      }
    }
  }
  return { fin: iso(fin), st, ...(before?.d1 ? { d1: before.d1 } : {}) };
}

/** The round hours (ISO UTC) of the week where no station has a measure: what the archive may fill. */
export function holes(s: Semaine): number[] {
  const n = HEURES["7j"];
  const fin = Date.parse(s.fin);
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (!Object.values(s.st).some((x) => FIELDS.some((f) => x[f][k] != null))) out.push(fin - (n - 1 - k) * HOUR_MS);
  return out;
}

/**
 * The archive's hours over the holes of the week. Its hours are local time (UTC+4), each the one ending then; its
 * wind in m/s.
 */
export function fill(s: Semaine, months: Map<string, Map<number, climat.Month>>, now: Date): Semaine {
  const n = HEURES["7j"];
  const fin = Date.parse(s.fin);
  const st = { ...s.st };
  const of: Record<Field, [climat.HourField, (v: number) => number]> = {
    t: ["T", (v) => v], rr: ["RR1", (v) => v], ff: ["FF", (v) => Math.round(v * 3.6)], dd: ["DD", (v) => v],
  };
  for (const ms of holes(s)) {
    const local = new Date(ms + 4 * HOUR_MS).toISOString();
    const k = n - 1 - Math.round((fin - ms) / HOUR_MS);
    for (const [id, m] of months) {
      for (const f of FIELDS) {
        const v = climat.valueAt(m, of[f][0], local.slice(0, 10), +local.slice(11, 13));
        if (v == null) continue;
        st[id] ??= empty(n);
        st[id] = { ...st[id], [f]: st[id][f].map((x, i) => (i === k ? of[f][1](v) : x)) };
      }
    }
  }
  return { ...s, st, d1: now.toISOString() };
}

/** The file's hours: the last `n` of the week, at the Météo-France stations that measured any. */
export function heures(s: Semaine | null, n: number): Heures | null {
  if (!s) return null;
  const all = HEURES["7j"];
  const st: SerieCarte[] = [];
  for (const x of meteofrance.stations()) {
    const series = s.st[x.id];
    if (!series) continue;
    const cut = Object.fromEntries(FIELDS.map((f) => [f, series[f].slice(all - n)])) as Series;
    if (!FIELDS.some((f) => cut[f].some((v) => v != null))) continue;
    const [px, py] = project(x.lon, x.lat);
    st.push({ id: x.id, x: Math.round(px * 10) / 10, y: Math.round(py * 10) / 10, alt: x.altitude_m, ...cut });
  }
  return st.length ? { fin: s.fin, heures: n, st } : null;
}

export interface Sources {
  /** The radar's 6 hours (KV, pluie-retro.ts). */
  six(): Promise<Historique | null>;
  /** Its 24 hours, a quarter of an hour apart. */
  day(): Promise<Historique | null>;
  semaine: { get(): Promise<Semaine | null>; put(s: Semaine): Promise<void> };
}

let sources: Sources | undefined;

/** Set by worker.ts: KV. Without it, the files say they have no history. */
export function configure(s?: Sources) {
  sources = s;
}

/**
 * The week, merged with the package this data center holds, and with the archive where neither has an hour (at most
 * once in D1_AGAIN_MS); written back when it changed, by `background`.
 */
async function semaine(cache: Cache, now: Date, background: (p: Promise<unknown>) => void): Promise<Semaine | null> {
  if (!sources) return null;
  count();
  const before = await sources.semaine.get().catch(() => null);
  const hourly = meteofrance.enabled() ? (await meteofrance.recentRain(cache, now))?.hourly : undefined;
  let s = merge(before, hourly, now);
  if (!s) return null;
  const lastD1 = s.d1 ? Date.parse(s.d1) : 0;
  if (climat.hourlyEnabled() && holes(s).length && now.getTime() - lastD1 > D1_AGAIN_MS) {
    const first = Math.min(...holes(s));
    const ym = (ms: number) => { const d = new Date(ms + 4 * HOUR_MS); return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1; };
    try {
      count();
      s = fill(s, await climat.months(meteofrance.stations().map((x) => x.id), ym(first), ym(Date.parse(s.fin))), now);
    } catch (err) {
      console.error("rejeu : archive horaire illisible", err instanceof Error ? err.message : String(err));
    }
  }
  if (!before || s.fin !== before.fin || s.d1 !== before.d1) {
    const write = s;
    count(1, true);
    background(sources.semaine.put(write).catch((err) => console.error("rejeu : semaine non écrite", err instanceof Error ? err.message : String(err))));
  }
  return s;
}

/**
 * One run of the scheduled event, once an hour: the week merged with the hourly package the data center holds, if it
 * holds a newer one; nothing asked of Météo-France. One read of the cache, then one read and one write of KV at most.
 */
export async function passage(cache: Cache, now = new Date()): Promise<string> {
  if (!sources) return "pas de KV";
  const hourly = await meteofrance.keptHourly(cache);
  if (!hourly) return "pas de paquet horaire dans ce centre de données";
  count();
  const before = await sources.semaine.get();
  if (before && Date.parse(before.fin) >= Date.parse(hourly.end)) return `rien à écrire (semaine jusqu'à ${before.fin})`;
  const s = merge(before, hourly, now)!;
  count(1, true);
  await sources.semaine.put(s);
  return `semaine écrite jusqu'à ${s.fin}`;
}

/** How long each file is kept: until something newer can be in it. */
export function freshSeconds(d: Duree, now: Date): number {
  if (d === "6h") return 300;
  if (d === "24h") return 900;
  // The next round hour is in the package about 15 minutes after it.
  const next = (Math.floor((now.getTime() - 15 * 60_000) / HOUR_MS) + 1) * HOUR_MS + 15 * 60_000;
  return Math.max(300, Math.round((next - now.getTime()) / 1000));
}

async function build(d: Duree, cache: Cache, now: Date, background: (p: Promise<unknown>) => void): Promise<Rejeu> {
  const radar = async (read: () => Promise<Historique | null>, keep: number) => {
    count();
    const h = await read().catch((err) => (console.error("rejeu : historique radar illisible", err instanceof Error ? err.message : String(err)), null));
    const entrees = h?.entrees.filter((e) => endOf(e) > now.getTime() - keep) ?? [];
    return h && entrees.length ? { ...h, entrees } : null;
  };
  const [s, r] = await Promise.all([
    semaine(cache, now, background),
    !sources || d === "7j" ? undefined : d === "6h" ? radar(sources.six, KEEP_MS) : radar(sources.day, LONG_MS),
  ]);
  return { ...(d === "7j" ? {} : { radar: r ?? null }), heures: heures(s, HEURES[d]) };
}

/** The answer of PATHS[d], kept by the data center and the browser for freshSeconds(). */
export async function rejeu(d: Duree, cache: Cache, background: (p: Promise<unknown>) => void, now = new Date()): Promise<Response> {
  const fresh = freshSeconds(d, now);
  const body = (await cache.get(`rejeu:${d}`, fresh, () => build(d, cache, now, background))).value;
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": `public, max-age=${fresh}` },
  });
}
