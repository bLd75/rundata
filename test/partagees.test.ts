import { describe, expect, it } from "vitest";
import { count, counted, measured, spent, WORKER_BUDGET, WORKER_FREE_LIMIT } from "../src/budget.js";
import { Cache, type CacheEntry, MemoryStore, TieredStore } from "../src/cache.js";
import { VERSION } from "../src/server.js";
import { type Kv, SHARED, SharedFallback, type Shared, warmShared } from "../src/web/partagees.js";

/** A KV namespace in memory, counting its writes by key. */
class FakeKv implements Kv {
  data = new Map<string, string>();
  writes = new Map<string, number>();
  reads = 0;
  async get(key: string) {
    this.reads++;
    const v = this.data.get(key);
    return v ? JSON.parse(v) : null;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
    this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
  }
}

class CountingStore extends MemoryStore {
  gets = 0;
  async get(key: string) {
    this.gets++;
    return super.get(key);
  }
}

const T0 = Date.parse("2026-10-24T00:00:00Z");

describe("the shared copies, read from KV", () => {
  it("only when the data center's cache has none, and only for the shared copies", async () => {
    const kv = new FakeKv();
    const edge = new CountingStore();
    const store = new SharedFallback(edge, kv);
    const entry: CacheEntry = { value: { n: 1 }, fetchedAt: T0 };
    await kv.put(`copie:${VERSION}:web:air`, JSON.stringify(entry));
    // A miss here: KV's copy, put in the data center's cache for the next isolates.
    expect(await store.get("web:air")).toEqual(entry);
    expect(kv.reads).toBe(1);
    expect(await edge.get("web:air")).toEqual(entry);
    // Now the cache has it: KV is not asked.
    expect(await store.get("web:air")).toEqual(entry);
    expect(kv.reads).toBe(1);
    // A copy that is not shared: never asked of KV.
    expect(await store.get("web:lieu:saint-paul")).toBeUndefined();
    expect(kv.reads).toBe(1);
  });
});

describe("the scheduled refresh of the shared copies", () => {
  it("writes each to KV no more often than its rate, over a day of events every 5 minutes", async () => {
    const kv = new FakeKv();
    let now = T0;
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => now, false);
    // The real list's keys and rates, with builds of a known small cost.
    const list: Shared[] = SHARED.map((s) => ({ ...s, build: async () => (count(2), { at: now }) }));
    for (let i = 0; i < 288; i++, now += 5 * 60_000) {
      await counted(WORKER_FREE_LIMIT, () => warmShared(cache, kv, new Date(now), list));
    }
    const perDay = (every: number) => (24 * 60) / every + 1;
    for (const s of SHARED) expect(kv.writes.get(`copie:${VERSION}:${s.key}`), s.key).toBeLessThanOrEqual(perDay(s.every));
    const total = [...kv.writes.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(240);
    expect(total).toBeGreaterThanOrEqual(220);
  });

  it("leaves a build that would not fit after a full AROME prefetch to a later event", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    const list: Shared[] = [{ key: "web:essai-lourd", build: async () => (count(15), {}), every: 30 }];
    // What the build takes, learnt once.
    await counted(WORKER_FREE_LIMIT, () => measured("web:essai-lourd", () => list[0].build(cache, new Date(T0))));
    const run = await counted(WORKER_FREE_LIMIT, async () => {
      count(28); // the AROME grids of a new run
      const written = await warmShared(cache, kv, new Date(T0), list);
      return { written, spent: spent() };
    });
    expect(run.value.written).toEqual([]);
    expect(run.value.spent).toBeLessThanOrEqual(WORKER_BUDGET);
    // An ordinary event, the grids already there: it fits.
    const quiet = await counted(WORKER_FREE_LIMIT, async () => {
      count(2);
      return warmShared(cache, kv, new Date(T0), list);
    });
    expect(quiet.value).toEqual(["web:essai-lourd"]);
    expect(quiet.used).toBeLessThanOrEqual(WORKER_BUDGET);
  });
});
