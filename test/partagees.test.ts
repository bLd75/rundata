import { describe, expect, it } from "vitest";
import { count, counted, measured, WORKER_BUDGET } from "../src/budget.js";
import { Cache, CACHE_FORMAT, type CacheEntry, MemoryStore, TieredStore } from "../src/cache.js";
import { VERSION } from "../src/server.js";
import { FRESH_SECONDS } from "../src/web/data.js";
import { type Kv, kvKey, SHARED, SHARED_AFTER, SharedFallback, type Shared, warmShared } from "../src/web/partagees.js";

/** A KV namespace in memory, counting its reads, its listings and its writes by key. */
class FakeKv implements Kv {
  data = new Map<string, string>();
  metadata = new Map<string, unknown>();
  writes = new Map<string, number>();
  reads = 0;
  lists = 0;
  down = false;
  async get(key: string) {
    this.reads++;
    const v = this.data.get(key);
    return v ? JSON.parse(v) : null;
  }
  async put(key: string, value: string, options?: { metadata?: unknown }) {
    this.data.set(key, value);
    if (options?.metadata !== undefined) this.metadata.set(key, options.metadata);
    else this.metadata.delete(key);
    this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
  }
  async list({ prefix }: { prefix: string }) {
    this.lists++;
    if (this.down) throw new Error("KV muet");
    const keys = [...this.data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: this.metadata.get(name) }));
    return { keys, list_complete: true };
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
  it("when the data center's cache has none, and only for the shared copies", async () => {
    const kv = new FakeKv();
    const edge = new CountingStore();
    const store = new SharedFallback(edge, kv, () => T0);
    const entry: CacheEntry = { value: { n: 1 }, fetchedAt: T0 };
    await kv.put(kvKey("web:air"), JSON.stringify(entry));
    // A miss here: KV's copy, put in the data center's cache for the next isolates.
    expect(await store.get("web:air")).toEqual(entry);
    expect(kv.reads).toBe(1);
    expect(await edge.get("web:air")).toEqual(entry);
    // Now the cache has it, fresh: KV is not asked.
    expect(await store.get("web:air")).toEqual(entry);
    expect(kv.reads).toBe(1);
    // A copy that is not shared: never asked of KV.
    expect(await store.get("web:lieu:saint-paul")).toBeUndefined();
    expect(kv.reads).toBe(1);
  });

  it("when the data center's copy is older than a page's freshness, and serves the newer of the two", async () => {
    const kv = new FakeKv();
    const edge = new CountingStore();
    let now = T0;
    const store = new SharedFallback(edge, kv, () => now);
    // The data center served the page three hours ago, then slept; the scheduled event wrote KV's a minute ago.
    const old: CacheEntry = { value: { n: 1 }, fetchedAt: T0 - 3 * 3600_000 };
    const recent: CacheEntry = { value: { n: 2 }, fetchedAt: T0 - 60_000 };
    await edge.put("web:actualites", old);
    await kv.put(kvKey("web:actualites"), JSON.stringify(recent));
    expect(await store.get("web:actualites")).toEqual(recent);
    expect(kv.reads).toBe(1);
    // Put in the data center's cache: its next isolates read it there, without KV.
    expect(await edge.get("web:actualites")).toEqual(recent);
    expect(await store.get("web:actualites")).toEqual(recent);
    expect(kv.reads).toBe(1);
    // Later, both old, the data center's the newer: it is the one served, and nothing is written.
    now += 3600_000;
    const edgeNewer: CacheEntry = { value: { n: 3 }, fetchedAt: now - 10 * 60_000 };
    await edge.put("web:actualites", edgeNewer);
    const puts = kv.writes.get(kvKey("web:actualites"));
    expect(await store.get("web:actualites")).toEqual(edgeNewer);
    expect(kv.reads).toBe(2);
    expect(kv.writes.get(kvKey("web:actualites"))).toBe(puts);
  });

  it("so that a page whose data center's copy is old is not built again when KV's is fresh", async () => {
    const kv = new FakeKv();
    const edge = new CountingStore();
    const cache = new Cache(new TieredStore(new MemoryStore(), new SharedFallback(edge, kv, () => T0)), () => T0, false);
    await edge.put("web:actualites", { value: { n: 1 }, fetchedAt: T0 - 3 * 3600_000 });
    await kv.put(kvKey("web:actualites"), JSON.stringify({ value: { n: 2 }, fetchedAt: T0 - 60_000 }));
    let builds = 0;
    const got = await cache.get("web:actualites", FRESH_SECONDS, async () => (builds++, { n: 9 }));
    expect(got.value).toEqual({ n: 2 });
    expect(builds).toBe(0);
    expect((await cache.peek("web:actualites"))!.value).toEqual({ n: 2 });
  });
});

describe("the shared copies' keys", () => {
  it("follow the shape of the entries, not the version: a deploy keeps them", () => {
    expect(kvKey("web:air")).toBe(`copie:format-${CACHE_FORMAT}:web:air`);
    expect(kvKey("web:air")).not.toContain(VERSION);
  });
});

describe("the scheduled refresh of the shared copies", () => {
  it("warms the forecast's ensemble only with what the page copies left", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    const pages: Shared[] = SHARED.map((s) => ({ ...s, key: `${s.key}-apres`, build: async () => (count(s.cold ?? 25), {}) }));
    const after: Shared[] = SHARED_AFTER.map((s) => ({ ...s, key: `${s.key}-apres`, build: async () => (count(s.cold ?? 25), {}) }));
    const run = await counted(WORKER_BUDGET, async () => {
      const first = await warmShared(cache, kv, new Date(T0), pages);
      return { first, after: await warmShared(cache, kv, new Date(T0), after) };
    });
    expect(run.used).toBeLessThanOrEqual(WORKER_BUDGET);
    // Right after a deploy the page copies take the invocation: the ensemble waits, and never makes one of them wait.
    expect(run.value.after.written).toEqual([]);
    expect(run.value.after.left[0].why).toMatch(/^budget : /);
    // An event with the page copies fresh: it fits.
    const quiet = await counted(WORKER_BUDGET, async () => {
      await warmShared(cache, kv, new Date(T0), []);
      return warmShared(cache, kv, new Date(T0), after);
    });
    expect(quiet.value.written).toEqual([`${SHARED_AFTER[0].key}-apres`]);
  });

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
    for (const s of SHARED) expect(kv.writes.get(kvKey(s.key)), s.key).toBeLessThanOrEqual(perDay(typeof s.every === "number" ? s.every : 5));
    const total = [...kv.writes.values()].reduce((a, b) => a + b, 0);
    // The volcano's copy, quiet here, every 30 minutes like four others, and the satellites' grids every 3 hours (about
    // 300 a day, partagees.ts).
    expect(total).toBeLessThanOrEqual(300);
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
    // Nine copies in five events at most: 25 minutes after a deploy, every copy is in KV.
    expect(events.length).toBeLessThanOrEqual(5);
  });

  it("keeps a build's cost with its KV copy, for an isolate that has not built it", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    const list: Shared[] = [{ key: "web:essai-garde", build: async () => (count(5), {}), every: 30 }];
    // Its copy, written an hour ago by another isolate, which found it took 5.
    await kv.put(kvKey("web:essai-garde"), JSON.stringify({ value: {}, fetchedAt: T0 - 3600_000, cost: 5 }));
    // Taken to cost 25 without it, it would not fit after these.
    const run = await counted(WORKER_BUDGET, async () => {
      count(25);
      return warmShared(cache, kv, new Date(T0), list);
    });
    expect(run.value.written).toEqual(["web:essai-garde"]);
    expect(run.used).toBeLessThanOrEqual(WORKER_BUDGET);
    expect(JSON.parse(kv.data.get(kvKey("web:essai-garde"))!).cost).toBe(5);
  });

  it("takes every copy's age and cost from one listing of KV, not a read each", async () => {
    const kv = new FakeKv();
    let now = T0;
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => now, false);
    const list: Shared[] = SHARED.map((s) => ({ ...s, key: `${s.key}-liste`, cold: 2, build: async () => (count(2), { at: now }) }));
    await counted(WORKER_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    expect(kv.data.size).toBe(list.length);
    // Each copy written with what the event needs as its key's metadata.
    expect(kv.metadata.get(kvKey("web:air-liste"))).toEqual({ fetchedAt: T0, cost: 2, every: 60 });
    kv.reads = 0;
    kv.lists = 0;
    now += 5 * 60_000;
    const run = await counted(WORKER_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    expect(run.value).toEqual({ written: [], left: [] });
    expect(kv.lists).toBe(1);
    expect(kv.reads).toBe(0);
    // One subrequest for the ages, whatever the number of copies.
    expect(run.used).toBe(1);
    // A copy another isolate wrote a minute ago: known from the listing alone, its cost too.
    const other: Shared = { key: "web:essai-autre-isolat", build: async () => (count(2), {}), every: 30 };
    await kv.put(kvKey(other.key), JSON.stringify({ value: {}, fetchedAt: now - 60_000, cost: 9 }), { metadata: { fetchedAt: now - 60_000, cost: 9, every: 30 } });
    kv.reads = 0;
    const again = await counted(WORKER_BUDGET, () => warmShared(cache, kv, new Date(now), [...list, other]));
    expect(again.value).toEqual({ written: [], left: [] });
    expect(kv.reads).toBe(0);
  });

  it("reads a copy whole when its key has no metadata yet, or when KV does not list", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    // Written by the code before the metadata, ten minutes ago: not due, known only by reading it.
    const list: Shared[] = [{ key: "web:essai-ancienne", build: async () => (count(2), {}), every: 30 }];
    await kv.put(kvKey("web:essai-ancienne"), JSON.stringify({ value: {}, fetchedAt: T0 - 10 * 60_000 }));
    const run = await counted(WORKER_BUDGET, () => warmShared(cache, kv, new Date(T0), list));
    expect(run.value).toEqual({ written: [], left: [] });
    expect(kv.reads).toBe(1);
    // KV's listing fails: each copy is read, as before the listing.
    kv.down = true;
    kv.reads = 0;
    await counted(WORKER_BUDGET, () => warmShared(cache, kv, new Date(T0), list));
    expect(kv.reads).toBe(1);
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
