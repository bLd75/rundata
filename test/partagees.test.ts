import { describe, expect, it } from "vitest";
import { count, counted, measured, WORKER_BUDGET } from "../src/budget.js";
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

/** The data center's cache as the Worker counts it (worker.ts): a read is a subrequest, a write one of those kept for writes. */
class CountedStore extends MemoryStore {
  async get(key: string) {
    count();
    return super.get(key);
  }
  async put(key: string, entry: CacheEntry) {
    count(1, true);
    return super.put(key, entry);
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
      await counted(WORKER_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    }
    const perDay = (every: number) => (24 * 60) / every + 1;
    // The volcano's copy goes every 5 minutes during an alert: its quickest rate bounds it.
    for (const s of SHARED) expect(kv.writes.get(`copie:${VERSION}:${s.key}`), s.key).toBeLessThanOrEqual(perDay(typeof s.every === "number" ? s.every : 5));
    const total = [...kv.writes.values()].reduce((a, b) => a + b, 0);
    // The volcano's copy, quiet here, every 30 minutes like four others (about 280 a day, partagees.ts).
    expect(total).toBeLessThanOrEqual(290);
    expect(total).toBeGreaterThanOrEqual(265);
  });

  it("leaves a build that would not fit after a full AROME prefetch to a later event, and says why", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    const list: Shared[] = [{ key: "web:essai-lourd", build: async () => (count(15), {}), every: 30 }];
    // What the build takes, learnt once.
    await counted(WORKER_BUDGET, () => measured("web:essai-lourd", () => list[0].build(cache, new Date(T0))));
    const run = await counted(WORKER_BUDGET, async () => {
      count(28); // the AROME grids of a new run
      return warmShared(cache, kv, new Date(T0), list);
    });
    expect(run.value.written).toEqual([]);
    expect(run.value.left).toEqual([{ key: "web:essai-lourd", why: "budget : 29 faites, 17 prévues" }]);
    expect(run.used).toBeLessThanOrEqual(WORKER_BUDGET);
    // An ordinary event, the grids already there: it fits.
    const quiet = await counted(WORKER_BUDGET, async () => {
      count(2);
      return warmShared(cache, kv, new Date(T0), list);
    });
    expect(quiet.value.written).toEqual(["web:essai-lourd"]);
    expect(quiet.used).toBeLessThanOrEqual(WORKER_BUDGET);
  });

  it("right after a deploy, warms every copy that fits from their cold costs, not one per event", async () => {
    const kv = new FakeKv();
    let now = T0;
    const cache = new Cache(new TieredStore(new MemoryStore(), new CountedStore()), () => now, false);
    // Builds that take their cold cost, under keys no isolate has built: the costs are known from the list only.
    const list: Shared[] = SHARED.map((s) => ({ ...s, key: `${s.key}-deploy`, build: async () => (count(s.cold ?? 25), { at: now }) }));
    const events: string[][] = [];
    while (events.length < 10 && kv.data.size < list.length) {
      // The AROME grids already there, as in most events: none fetched.
      const run = await counted(WORKER_BUDGET, () => warmShared(cache, kv, new Date(now), list));
      expect(run.used).toBeLessThanOrEqual(WORKER_BUDGET);
      for (const l of run.value.left) expect(l.why).toMatch(/^budget : /);
      events.push(run.value.written);
      now += 5 * 60_000;
    }
    expect(events[0].length).toBeGreaterThanOrEqual(2);
    expect(kv.data.size).toBe(list.length);
    expect(events.length).toBeLessThanOrEqual(4);
  });

  it("keeps a build's cost with its KV copy, for an isolate that has not built it", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    const list: Shared[] = [{ key: "web:essai-garde", build: async () => (count(5), {}), every: 30 }];
    // Its copy, written an hour ago by another isolate, which found it took 5.
    await kv.put(`copie:${VERSION}:web:essai-garde`, JSON.stringify({ value: {}, fetchedAt: T0 - 3600_000, cost: 5 }));
    // Taken to cost 25 without it, it would not fit after these.
    const run = await counted(WORKER_BUDGET, async () => {
      count(25);
      return warmShared(cache, kv, new Date(T0), list);
    });
    expect(run.value.written).toEqual(["web:essai-garde"]);
    expect(run.used).toBeLessThanOrEqual(WORKER_BUDGET);
    expect(JSON.parse(kv.data.get(`copie:${VERSION}:web:essai-garde`)!).cost).toBe(5);
  });

  it("stays within the budget when a build costs more than thought, and says it was cut", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    // Never run in this isolate: taken to cost 25, it takes 40.
    const list: Shared[] = [{ key: "web:essai-imprevu", build: async () => { for (let i = 0; i < 40; i++) count(); return {}; }, every: 30 }];
    const run = await counted(WORKER_BUDGET, async () => {
      count(2);
      return warmShared(cache, kv, new Date(T0), list);
    });
    const settled = await run.settled();
    expect(run.value.written).toEqual([]);
    expect(run.value.left[0].key).toBe("web:essai-imprevu");
    expect(run.value.left[0].why).toMatch(/^erreur : .*Too many subrequests/);
    expect(settled.used).toBeLessThanOrEqual(WORKER_BUDGET);
  });

  it("says when the source failed and only the last copy was there", async () => {
    const kv = new FakeKv();
    let now = T0;
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => now, false);
    await cache.get("web:essai-panne", 60, async () => ({ n: 1 }));
    now += 3600_000;
    const list: Shared[] = [{ key: "web:essai-panne", build: async () => { throw new Error("source muette"); }, every: 30 }];
    const run = await counted(WORKER_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    expect(run.value).toEqual({ written: [], left: [{ key: "web:essai-panne", why: "copie de secours" }] });
  });
});
