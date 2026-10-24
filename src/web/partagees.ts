/**
 * The page copies that the tool resume_du_jour and the commune pages share, kept warm for every data center. The
 * copies live in the data center's cache, per version: after a deploy, or at a quiet hour, the tool found most of them
 * missing until someone opened those pages. The scheduled event, after the AROME prefetch, refreshes the ones due in
 * KV, which every data center reads; it is the only writer. A page or the tool reads KV only when its data center's
 * cache has no copy, and copies what it read there.
 */
import { costOf, count, left, measured, spent, unmeasured } from "../budget.js";
import { type Cache, CACHE_FORMAT, type CacheEntry, type CacheStore } from "../cache.js";
import * as ensemble from "../providers/ensemble.js";
import * as ovpfPdf from "../providers/ovpf-pdf.js";
import { why } from "../types.js";
import { buildActualites, buildAir, buildCalendrier, buildCoupures, buildCourant, buildElectricite, buildSea, buildTrafic, buildVolcan, FRESH_SECONDS, type VolcanAnswer } from "./data.js";
import { alerteVolcan } from "./volcan-alerte.js";

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

// About 290 KV writes a day in all: 48 a day for each of the five every 30 minutes, 24 for the air, 12 for the power
// cuts the mairies relay, 8 for the sea, 4 for the calendar; the volcano's, every 5 minutes during an alert, adds up to 240 more while it lasts (the banner
// of every page reads it). The events stay out: their build takes most of an invocation (they will come in a bundle).
// The cold costs: each build measured alone with `wrangler dev` from an empty cache, plus one, and the traffic's from
// the event's logs, a little dearer than in `wrangler dev` (24 October 2026). The volcano's: its four sources, each a
// read, a fetch and a write, plus one. The power cuts': one fetch per mairie and one for Saint-André's PDF letters, plus one.
// The sea's: three more since ACSPO is read one file a day.
export const SHARED: Shared[] = [
  { key: "web:actualites", build: buildActualites, every: 30, cold: 12 },
  { key: "web:trafic", build: buildTrafic, every: 30, cold: 27 },
  { key: "web:electricite", build: buildElectricite, every: 30, cold: 7 },
  { key: "web:coupures", build: buildCoupures, every: 30, cold: 7 },
  { key: "web:air", build: buildAir, every: 60, cold: 4 },
  { key: "web:mer", build: buildSea, every: 3 * 60, cold: 18 },
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

/** A copy in KV, with what its build took (`cost`), for the isolates that have not built it yet. */
type KvEntry = CacheEntry & { cost?: number };

/**
 * What the scheduled event needs of a copy, written as the KV key's metadata: when it was built, what its build took,
 * and how often it is refreshed given its value (`Shared.every`). One listing of the keys gives it for every copy.
 */
interface KvMeta {
  fetchedAt: number;
  cost?: number;
  every?: number;
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
 * The data center's cache, and KV behind it for the shared copies only: asked when the cache has none, or only one
 * older than FRESH_SECONDS (a data center that served the page once, then slept), at the cost of one read instead of
 * a build. The newer of the two is served, and KV's is put in the cache, so that the data center's next isolates find
 * it there. Never written to KV.
 */
export class SharedFallback implements CacheStore {
  constructor(private edge: CacheStore, private kv: Kv, private now: () => number = Date.now) {}
  async get(key: string, freshAfter?: number) {
    const e = await this.edge.get(key, freshAfter);
    if (!KEYS.has(key) || (e && this.now() - e.fetchedAt <= FRESH_SECONDS * 1000)) return e;
    const shared = await kvGet(this.kv, key);
    if (!shared || (e && shared.fetchedAt <= e.fetchedAt)) return e;
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

/** How often `s` is refreshed, given its copy's value. */
const everyOf = (s: Shared, value: unknown) => (typeof s.every === "number" ? s.every : s.every(value));

export async function warmShared(cache: Cache, kv: Kv, now = new Date(), list = SHARED): Promise<Warmed> {
  // The ages and costs of all the copies from one listing; a copy read whole only when the listing has no metadata for
  // it (written before it was kept there), or when KV did not list.
  const listed = await kvList(kv);
  const ages = await Promise.all(list.map(async (s): Promise<{ s: Shared; at?: number; kept?: number; every: number }> => {
    const k = kvKey(s.key);
    const meta = wrote.get(k) ?? listed?.get(k);
    if (meta) return { s, at: meta.fetchedAt, kept: meta.cost, every: meta.every ?? everyOf(s, undefined) };
    if (listed && !listed.has(k)) return { s, every: everyOf(s, undefined) };
    const e = await kvGet(kv, s.key);
    return { s, at: e?.fetchedAt, kept: e?.cost, every: everyOf(s, e?.value) };
  }));
  const due = ages
    .map(({ s, at, kept, every }) => ({ s, at, kept, over: at == null ? Infinity : now.getTime() - at - every * 60_000 }))
    .filter((x) => x.over >= 0)
    // Not by subtraction: the copies never written are all overdue by Infinity, and Infinity - Infinity is NaN.
    .sort((a, b) => (a.over === b.over ? 0 : a.over < b.over ? 1 : -1));
  const out: Warmed = { written: [], left: [] };
  for (const { s, at, kept } of due) {
    // The copy looked up, then built, within what is left besides the writes; the writes (the data center's cache,
    // KV) go in the part kept for them.
    const cost = LOOKUP + expected(s, kept);
    if (cost > left()) {
      out.left.push({ key: s.key, why: `budget : ${spent()} faites, ${cost} prévues` });
      continue;
    }
    try {
      const got = await cache.get(s.key, FRESH_SECONDS, () => measured(s.key, () => s.build(cache, now)));
      // The source failed and the cache served its last copy: not worth spreading.
      if (got.stale) {
        out.left.push({ key: s.key, why: "copie de secours" });
        continue;
      }
      if (at != null && got.fetchedAt.getTime() <= at) {
        out.left.push({ key: s.key, why: "pas plus récente que celle de KV" });
        continue;
      }
      count(1, true);
      const entry: KvEntry = { value: got.value, fetchedAt: got.fetchedAt.getTime(), cost: costOf(s.key) ?? kept };
      const meta: KvMeta = { fetchedAt: entry.fetchedAt, cost: entry.cost, every: everyOf(s, got.value) };
      await kv.put(kvKey(s.key), JSON.stringify(entry), { expirationTtl: KV_TTL_SECONDS, metadata: meta });
      wrote.set(kvKey(s.key), meta);
      out.written.push(s.key);
    } catch (err) {
      out.left.push({ key: s.key, why: `erreur : ${why(err).slice(0, 80)}` });
    }
  }
  return out;
}
