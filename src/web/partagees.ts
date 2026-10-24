/**
 * The page copies that the tool resume_du_jour and the commune pages share, kept warm for every data center. The
 * copies live in the data center's cache, per version: after a deploy, or at a quiet hour, the tool found most of them
 * missing until someone opened those pages. The scheduled event, after the AROME prefetch, refreshes the ones due in
 * KV, which every data center reads; it is the only writer. A page or the tool reads KV only when its data center's
 * cache has no copy, and copies what it read there.
 */
import { costOf, count, left, measured, spent } from "../budget.js";
import type { Cache, CacheEntry, CacheStore } from "../cache.js";
import { VERSION } from "../server.js";
import { why } from "../types.js";
import { buildActualites, buildAir, buildCalendrier, buildCoupures, buildElectricite, buildSea, buildTrafic, FRESH_SECONDS } from "./data.js";

/** The part of a KV namespace binding used here. */
export interface Kv {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Shared {
  key: string;
  build: (cache: Cache, now: Date) => Promise<unknown>;
  /** How often its copy in KV is refreshed, in minutes: each refresh is one KV write. */
  every: number;
  /** The subrequests its build takes from a cold cache, as measured: what an isolate that has not built it yet expects. */
  cold?: number;
}

// About 230 KV writes a day in all: 48 a day for each of the four every 30 minutes, 24 for the air, 8 for the sea,
// 4 for the calendar. The events stay out: their build takes most of an invocation (they will come in a bundle).
// The cold costs: each build measured alone with `wrangler dev` from an empty cache, plus one, and the traffic's from
// the event's logs, a little dearer than in `wrangler dev` (24 October 2026).
export const SHARED: Shared[] = [
  { key: "web:actualites", build: buildActualites, every: 30, cold: 12 },
  { key: "web:trafic", build: buildTrafic, every: 30, cold: 27 },
  { key: "web:electricite", build: buildElectricite, every: 30, cold: 7 },
  { key: "web:coupures", build: buildCoupures, every: 30, cold: 7 },
  { key: "web:air", build: buildAir, every: 60, cold: 4 },
  { key: "web:mer", build: buildSea, every: 3 * 60, cold: 15 },
  { key: "web:calendrier", build: buildCalendrier, every: 6 * 60, cold: 8 },
];
const KEYS = new Set(SHARED.map((s) => s.key));
// The calendar's copy, the least often refreshed, outlives its next refresh by far.
const KV_TTL_SECONDS = 24 * 3600;
// A build whose cost is known nowhere is taken to cost this much (web/site.ts does the same).
const COST_UNKNOWN = 25;
// Besides the build: the data center's cache, then KV, asked for the copy before it is built (SharedFallback).
const LOOKUP = 2;

/** A copy in KV, with what its build took (`cost`), for the isolates that have not built it yet. */
type KvEntry = CacheEntry & { cost?: number };

/**
 * What a build is expected to take: the most of what it took in this isolate, what it took when its KV copy was
 * written, and its cold cost. After a deploy, every isolate is new and KV has no copy of the version: the cold cost.
 */
function expected(s: Shared, kept?: number): number {
  const known = [costOf(s.key), kept, s.cold].filter((n): n is number => n != null);
  return known.length ? Math.max(...known) : COST_UNKNOWN;
}

/** Per version, as the data center's cache: a copy of the previous code's data may lack what the new code reads. */
const kvKey = (key: string) => `copie:${VERSION}:${key}`;

async function kvGet(kv: Kv, key: string): Promise<KvEntry | undefined> {
  try {
    count();
    return ((await kv.get(kvKey(key), "json")) ?? undefined) as KvEntry | undefined;
  } catch {
    return undefined; // a store problem must never cost an answer
  }
}

/**
 * The data center's cache, and KV behind it for the shared copies only: asked when the cache has none, and what it
 * had is put in the cache, so that the data center's next isolates find it there. Never written to KV.
 */
export class SharedFallback implements CacheStore {
  constructor(private edge: CacheStore, private kv: Kv) {}
  async get(key: string, freshAfter?: number) {
    const e = await this.edge.get(key, freshAfter);
    if (e || !KEYS.has(key)) return e;
    const shared = await kvGet(this.kv, key);
    if (shared) await this.edge.put(key, shared);
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
export async function warmShared(cache: Cache, kv: Kv, now = new Date(), list = SHARED): Promise<Warmed> {
  const ages = await Promise.all(list.map(async (s) => {
    const e = await kvGet(kv, s.key);
    return { s, at: e?.fetchedAt, kept: e?.cost };
  }));
  const due = ages
    .map(({ s, at, kept }) => ({ s, at, kept, over: at == null ? Infinity : now.getTime() - at - s.every * 60_000 }))
    .filter((x) => x.over >= 0)
    .sort((a, b) => b.over - a.over);
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
      await kv.put(kvKey(s.key), JSON.stringify(entry), { expirationTtl: KV_TTL_SECONDS });
      out.written.push(s.key);
    } catch (err) {
      out.left.push({ key: s.key, why: `erreur : ${why(err).slice(0, 80)}` });
    }
  }
  return out;
}
