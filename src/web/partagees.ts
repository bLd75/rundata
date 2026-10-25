/**
 * The page copies that the tool resume_du_jour and the commune pages share, kept warm for every data center. The
 * copies live in the data center's cache, per version: after a deploy, or at a quiet hour, the tool found most of them
 * missing until someone opened those pages. The scheduled event, after the AROME prefetch, refreshes the ones due in
 * KV, which every data center reads; it is the only writer. A page or the tool reads KV only when its data center's
 * cache has no copy, and copies what it read there.
 */
import { costOf, count, left, measured, spent, unmeasured } from "../budget.js";
import { type Cache, CACHE_FORMAT, type CacheEntry, type CacheStore, isCopy, outdated } from "../cache.js";
import * as ensemble from "../providers/ensemble.js";
import * as ovpfPdf from "../providers/ovpf-pdf.js";
import { why } from "../types.js";
import { buildActualites, buildAir, buildCalendrier, buildCoupures, buildCourant, buildElectricite, buildSea, buildTrafic, buildVolcan, FRESH_SECONDS, type VolcanAnswer } from "./data.js";
import { alerteVolcan } from "./volcan-alerte.js";
import { buildSatellites, SATELLITES, satellitesEvery } from "../tools/mer.js";

/** The part of a KV namespace binding used here. */
export interface Kv {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{ keys: { name: string; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>;
}

export interface Shared {
  key: string;
  build: (cache: Cache, now: Date) => Promise<unknown>;
  /** How often its copy in KV is refreshed, in minutes: each refresh is one KV write. Given the last copy, if it depends on it. */
  every: number | ((last: unknown) => number);
  /** The subrequests its build takes from a cold cache, as measured: what an isolate that has not built it yet expects. */
  cold?: number;
}

// About 300 KV writes a day in all: 48 a day for each of the five every 30 minutes, 24 for the air, 12 for the power
// cuts the mairies relay, 8 for the sea, 8 for the satellites' grids (48 while ACSPO lacks a day it should have), 4 for the calendar; the volcano's, every 5 minutes during an alert, adds up to 240 more while it lasts (the banner
// of every page reads it). The events stay out: their build takes most of an invocation (they will come in a bundle).
// The cold costs: each build measured alone with `wrangler dev` from an empty cache, plus one. The traffic's: 19 in the
// tests from an empty cache, since its 8 bus stations' timetables are read together (2 reads of D1 instead of 16 to
// 32: 33 before, 31 in the event's logs at 4 o'clock), plus one (25 October 2026). The volcano's: its four sources, each a
// read, a fetch and a write, plus one. The power cuts': one fetch per mairie and one for Saint-André's PDF letters, plus one.
// The sea's: 18 when it read the satellites, less the 5 they took (13 against 8 in the same test, 25 October 2026): the
// grids are their own copy. The grids': ACSPO's four files, a read and a write, MODIS's three more where ACSPO sees
// nothing near a beach, plus one.
export const SHARED: Shared[] = [
  { key: "web:actualites", build: buildActualites, every: 30, cold: 12 },
  { key: "web:trafic", build: buildTrafic, every: 30, cold: 20 },
  { key: "web:electricite", build: buildElectricite, every: 30, cold: 7 },
  { key: "web:coupures", build: buildCoupures, every: 30, cold: 7 },
  { key: "web:air", build: buildAir, every: 60, cold: 4 },
  // Built only here: the copy of /mer, the pages and temperature_mer read it, never the satellites (cam-change 273).
  { key: SATELLITES, build: buildSatellites, every: (last) => satellitesEvery(last), cold: 10 },
  { key: "web:mer", build: buildSea, every: 3 * 60, cold: 13 },
  { key: "web:calendrier", build: buildCalendrier, every: 6 * 60, cold: 8 },
  // The PDF of the OVPF's newest release, read here only (providers/ovpf-pdf.ts), once the copy is built and outside its
  // cost: three more, with what is left, when there is a new one or a failed one to ask again.
  { key: "web:volcan", build: async (cache, now) => {
    const v = await buildVolcan(cache, now);
    await unmeasured(() => ovpfPdf.readNewest(cache, now.getTime()));
    return v;
  }, every: (last) => (alerteVolcan(last as VolcanAnswer | undefined) ? 5 : 30), cold: 13 },
  { key: "web:courant", build: buildCourant, every: 2 * 60, cold: 7 },
];
/**
 * Warmed after SHARED, with what it left, so that they never go short for these: the confidence of the forecast
 * days (prevision_meteo, weather pages), read by questions and never fetched by them. Eight more writes a day.
 */
export const SHARED_AFTER: Shared[] = [
  // Its run time and the ensemble, plus one.
  { key: ensemble.KEY, build: () => ensemble.build(), every: 3 * 60, cold: 3 },
];
const KEYS = new Set([...SHARED, ...SHARED_AFTER].map((s) => s.key));
// The calendar's copy, the least often refreshed, outlives its next refresh by far.
const KV_TTL_SECONDS = 24 * 3600;
// A build whose cost is known nowhere is taken to cost this much (web/site.ts does the same).
const COST_UNKNOWN = 25;
// Besides the build: the data center's cache, then KV, asked for the copy before it is built (SharedFallback).
const LOOKUP = 2;
// Left to the agendas read after the copies (worker.ts) by a copy due only because another version built it: on a day
// of deploys a few minutes apart, every event would otherwise spend its whole budget on them.
export const AFTER_DEPLOY_RESERVE = 12;
// Past its time by this much, a copy is tried at its cold cost, and said to be late when it is left again.
const LATE_MINUTES = 60;

/** A copy in KV, with what its build took (`cost`), for the isolates that have not built it yet. */
type KvEntry = CacheEntry & { cost?: number };

/**
 * What the scheduled event needs of a copy, written as the KV key's metadata: when it was built, what its build took,
 * how often it is refreshed given its value (`Shared.every`), and by which version of the code. One listing of the keys
 * gives it for every copy.
 */
interface KvMeta {
  fetchedAt: number;
  cost?: number;
  every?: number;
  version?: string;
}

/**
 * What a build is expected to take: the most of what it took in this isolate, what it took when its KV copy was
 * written, and its cold cost. After a deploy, every isolate is new and KV has no copy of the version: the cold cost.
 */
function expected(s: Shared, kept?: number): number {
  const known = [costOf(s.key), kept, s.cold].filter((n): n is number => n != null);
  return known.length ? Math.max(...known) : COST_UNKNOWN;
}

/** Per shape of the entries, as the data center's cache (cache.ts): a deploy that keeps it keeps the copies. */
const KV_PREFIX = `copie:format-${CACHE_FORMAT}:`;
export const kvKey = (key: string) => `${KV_PREFIX}${key}`;

/**
 * The metadata of every shared copy in KV, by KV key, in one subrequest (a page of a listing holds 1 000 keys); a key
 * written before the metadata has none. Undefined when KV does not answer: the copies are then read one by one.
 */
async function kvList(kv: Kv): Promise<Map<string, KvMeta | undefined> | undefined> {
  try {
    const found = new Map<string, KvMeta | undefined>();
    let cursor: string | undefined;
    do {
      count();
      const page = await kv.list({ prefix: KV_PREFIX, cursor });
      for (const k of page.keys) found.set(k.name, typeof (k.metadata as KvMeta)?.fetchedAt === "number" ? (k.metadata as KvMeta) : undefined);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return found;
  } catch {
    return undefined;
  }
}

async function kvGet(kv: Kv, key: string): Promise<KvEntry | undefined> {
  try {
    count(1, "read");
    return ((await kv.get(kvKey(key), "json")) ?? undefined) as KvEntry | undefined;
  } catch {
    return undefined; // a store problem must never cost an answer
  }
}

/**
 * The data center's cache, and KV behind it for the shared copies only: asked when the cache has none, only one older
 * than FRESH_SECONDS (a data center that served the page once, then slept), or one of another version (`version`,
 * cache.ts), at the cost of one read instead of a build. The newer of the two is served, one of this version before one
 * of another, and KV's is put in the cache, so that the data center's next isolates find it there. Never written to KV.
 */
export class SharedFallback implements CacheStore {
  constructor(private edge: CacheStore, private kv: Kv, private now: () => number = Date.now, private version?: string) {}
  async get(key: string, freshAfter?: number) {
    const e = await this.edge.get(key, freshAfter);
    const old = (x: CacheEntry) => outdated(key, x, this.version);
    if (!KEYS.has(key) || (e && this.now() - e.fetchedAt <= FRESH_SECONDS * 1000 && !old(e))) return e;
    const shared = await kvGet(this.kv, key);
    if (!shared || (e && (old(e) === old(shared) ? shared.fetchedAt <= e.fetchedAt : old(shared)))) return e;
    await this.edge.put(key, shared);
    return shared;
  }
  put(key: string, entry: CacheEntry) {
    return this.edge.put(key, entry);
  }
}

/** What a scheduled event did with the shared copies: those written to KV, and those due but left, with why. */
export interface Warmed {
  written: string[];
  left: { key: string; why: string }[];
}

/**
 * The scheduled event's part: each shared copy whose KV copy is due, the most overdue first, built (or taken from
 * the data center's cache when fresh there) and written to KV, while the whole invocation stays within its budget; a
 * build that would not fit, after a full AROME prefetch, waits for a later event. The event runs under the same
 * budget as a page (worker.ts), so a build that costs more than it was thought to is cut there, not past it.
 */
// What this isolate last wrote to KV, per key: a listing may not show a write of the last minute yet (KV is
// eventually consistent), and this isolate knows its own.
const wrote = new Map<string, KvMeta>();

/** « 75 min », « 16 h ». */
const ago = (ms: number) => (ms < 2 * 3600_000 ? `${Math.round(ms / 60_000)} min` : `${Math.floor(ms / 3600_000)} h`);

/** How often `s` is refreshed, given its copy's value. */
const everyOf = (s: Shared, value: unknown) => (typeof s.every === "number" ? s.every : s.every(value));

export async function warmShared(cache: Cache, kv: Kv, now = new Date(), list = SHARED): Promise<Warmed> {
  // The ages and costs of all the copies from one listing; a copy read whole only when the listing has no metadata for
  // it (written before it was kept there), or when KV did not list.
  const listed = await kvList(kv);
  const ages = await Promise.all(list.map(async (s): Promise<{ s: Shared; at?: number; kept?: number; every: number; old: boolean }> => {
    const k = kvKey(s.key);
    const meta = wrote.get(k) ?? listed?.get(k);
    if (meta) return { s, at: meta.fetchedAt, kept: meta.cost, every: meta.every ?? everyOf(s, undefined), old: outdated(s.key, meta, cache.version) };
    if (listed && !listed.has(k)) return { s, every: everyOf(s, undefined), old: false };
    const e = await kvGet(kv, s.key);
    return { s, at: e?.fetchedAt, kept: e?.cost, every: everyOf(s, e?.value), old: outdated(s.key, e, cache.version) };
  }));
  // A copy of another version (cache.ts, `outdated`) is due at once, by its age: after a deploy they are all due, and
  // go the oldest first, over as many events as their builds take within the budget, less what the agendas keep.
  const due = ages
    .map(({ s, at, kept, every, old }) => {
      const byRate = at == null ? Infinity : now.getTime() - at - every * 60_000;
      return { s, at, kept, over: old && byRate < 0 ? now.getTime() - at! : byRate, version: old && byRate < 0 };
    })
    .filter((x) => x.over >= 0)
    // Not by subtraction: the copies never written are all overdue by Infinity, and Infinity - Infinity is NaN.
    .sort((a, b) => (a.over === b.over ? 0 : a.over < b.over ? 1 : -1));
  const out: Warmed = { written: [], left: [] };
  for (const { s, at, kept, over, version } of due) {
    // An hour past its time, a copy is expected at its cold cost: what it took at a dearer hour, kept with its last
    // copy, must not hold it back until that copy expires (web:trafic, 31 at 04:00, never under 33 since: cam-change
    // 279). Its build stays within the budget all the same. Past its time by its rate only: a copy due for its version
    // is overdue by its age, and keeps what it is expected to take and the agendas' reserve.
    const late = !version && over >= LATE_MINUTES * 60_000;
    const leave = (why: string) => {
      out.left.push({ key: s.key, why });
      // One line to search for in the Worker's logs: a copy left an hour past its time, about twelve events in a row.
      if (late) console.error(`copie partagée en retard : ${s.key}, ${at == null ? "jamais écrite" : `écrite il y a ${ago(now.getTime() - at)}`}, reportée (${why})`);
    };
    // The copy looked up, then built, within what is left besides the writes; the writes (the data center's cache,
    // KV) go in the part kept for them.
    const cost = LOOKUP + (late && s.cold != null ? s.cold : expected(s, kept));
    if (cost > left() - (version ? AFTER_DEPLOY_RESERVE : 0)) {
      leave(`${version ? "autre version, " : ""}budget : ${spent()} faites, ${cost} prévues`);
      continue;
    }
    try {
      const got = await cache.get(s.key, FRESH_SECONDS, () => measured(s.key, () => s.build(cache, now)));
      // The source failed and the cache served its last copy: not worth spreading.
      if (got.stale) {
        leave("copie de secours");
        continue;
      }
      if (at != null && got.fetchedAt.getTime() <= at) {
        leave("pas plus récente que celle de KV");
        continue;
      }
      count(1, true);
      const version = isCopy(s.key) ? cache.version : undefined;
      const entry: KvEntry = { value: got.value, fetchedAt: got.fetchedAt.getTime(), cost: costOf(s.key) ?? kept, ...(version && { version }) };
      const meta: KvMeta = { fetchedAt: entry.fetchedAt, cost: entry.cost, every: everyOf(s, got.value), ...(version && { version }) };
      await kv.put(kvKey(s.key), JSON.stringify(entry), { expirationTtl: KV_TTL_SECONDS, metadata: meta });
      wrote.set(kvKey(s.key), meta);
      out.written.push(s.key);
    } catch (err) {
      leave(`erreur : ${why(err).slice(0, 80)}`);
    }
  }
  return out;
}
