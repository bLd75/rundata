import { describe, expect, it } from "vitest";
import { BUILD_BUDGET, count, counted, left, measured, SCHEDULED_BUDGET } from "../src/budget.js";
import { Cache, CACHE_FORMAT, type CacheEntry, isCopy, MemoryStore, stampOf, TieredStore } from "../src/cache.js";
import { VERSION } from "../src/server.js";
import { SATELLITES as SATELLITES_KEY } from "../src/tools/mer.js";
import { FRESH_SECONDS } from "../src/web/data.js";
import { AFTER_DEPLOY_RESERVE, type Kv, kvKey, listShared, SHARED, SHARED_AFTER, SharedFallback, type Shared, slotStart, warmShared } from "../src/web/partagees.js";
import { MAX_NEW_GRIDS } from "../src/providers/arome.js";

// An event short of subrequests (the former budget): what is left out, and why, when the budget does not hold all.
const TIGHT = 40;

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

describe("the shared copies after a deploy", () => {
  it("are read from KV when the data center's copy is of another version, however fresh", async () => {
    const kv = new FakeKv();
    const edge = new CountingStore();
    const store = new SharedFallback(edge, kv, () => T0, "2.0.0");
    const old: CacheEntry = { value: { n: 1 }, fetchedAt: T0 - 60_000, version: "1.0.0" };
    await edge.put("web:actualites", old);
    // KV has none of this version yet: the data center's is served, for the cache to build again.
    expect(await store.get("web:actualites")).toEqual(old);
    // The scheduled event wrote one of this version, older than the data center's: it wins, and is put there.
    const current: CacheEntry = { value: { n: 2 }, fetchedAt: T0 - 3 * 60_000, version: stampOf("web:actualites", "2.0.0") };
    await kv.put(kvKey("web:actualites"), JSON.stringify(current));
    expect(await store.get("web:actualites")).toEqual(current);
    expect(await edge.get("web:actualites")).toEqual(current);
    // Then the data center's is fresh and of this version: KV is not asked.
    const reads = kv.reads;
    expect(await store.get("web:actualites")).toEqual(current);
    expect(kv.reads).toBe(reads);
  });

  it("are all due at the first event, rebuilt the oldest first within the budget, over a few events", async () => {
    const kv = new FakeKv();
    let now = T0;
    const edge = new CountedStore();
    // Every copy in KV and in the data center's cache, written by the previous version 15 seconds apart, none due by its
    // rate (the earthquakes' every 10 minutes) nor at its slot (all within their margin, a sixth of their rate, before it).
    // Their families renamed, out of the revisions' table (web/revisions.ts): « web:chiffres:evenements » as « web:chiffres-version:evenements »,
    // a source's key (« actualites:fil ») as « actualites:fil-version ».
    const versioned = (key: string) => (key.startsWith("web:") && key.indexOf(":", 4) > 0 ? key.replace(/^(web:[^:]+)/, "$1-version") : `${key}-version`);
    const list: Shared[] = SHARED.map((s) => ({ ...s, key: versioned(s.key), build: async () => (count(s.cold ?? 25), { at: now }) }));
    const writtenAt = new Map<string, number>();
    for (const [i, s] of list.entries()) {
      const at = now - (i + 1) * 15_000;
      writtenAt.set(s.key, at);
      const entry = { value: {}, fetchedAt: at, cost: s.cold, version: "1.0.0" };
      await kv.put(kvKey(s.key), JSON.stringify(entry), { metadata: { fetchedAt: at, cost: s.cold, every: typeof s.every === "number" ? s.every : 30, version: "1.0.0" } });
      await edge.put(s.key, entry);
    }
    // The previous version's event: nothing due.
    const quiet = await counted(SCHEDULED_BUDGET, () => warmShared(new Cache(new TieredStore(new MemoryStore(), edge), () => now, false, undefined, "1.0.0"), kv, new Date(now), list));
    expect(quiet.value).toEqual({ written: [], left: [] });
    // The deploy: a new isolate, a new version.
    const cache = new Cache(new TieredStore(new MemoryStore(), edge), () => now, false, undefined, "2.0.0");
    const events: { written: string[]; used: number; rest: number; at: number }[] = [];
    // The news, the satellites' grids, the vigilance, the earthquakes and the ONF's map are a source's, not a page's: no version, kept.
    const pages = list.filter((s) => isCopy(s.key));
    expect(pages.length).toBe(list.length - 5);
    const done = () => pages.every((s) => JSON.parse(kv.data.get(kvKey(s.key))!).version === "2.0.0");
    while (events.length < 12 && !done()) {
      const run = await counted(SCHEDULED_BUDGET, async () => ({ warmed: await warmShared(cache, kv, new Date(now), list), rest: left() }));
      expect(run.used).toBeLessThanOrEqual(SCHEDULED_BUDGET);
      for (const l of run.value.warmed.left) expect(l.why).toMatch(/^autre version, budget : /);
      events.push({ written: run.value.warmed.written, used: run.used, rest: run.value.rest, at: now });
      now += 5 * 60_000;
    }
    expect(done()).toBe(true);
    // The oldest first: the last of the list was written the earliest.
    expect(events[0].written[0]).toBe(list[list.length - 1].key);
    expect(events[0].written.length).toBeGreaterThanOrEqual(2);
    // From their cold costs, the agendas' share kept: 35 minutes at most after a deploy, every copy is of its version.
    expect(events.length).toBeLessThanOrEqual(7);
    // The agendas, read after the copies, keep their share of every event that built copies due only for their version,
    // less the copies' two writes each (the data center's cache, KV), which go in the part of the budget kept for writes.
    // A copy due by its rate meanwhile (the traffic's, every 30 minutes; the vigilance, at every event) is built as it
    // always was, and the earthquakes every other event.
    const everyEvent = new Set(list.filter((s) => s.every === 5 || s.every === 10).map((s) => s.key));
    const byRate = (key: string, at: number) => everyEvent.has(key) || at - writtenAt.get(key)! >= 30 * 60_000;
    for (const e of events.filter((e) => !e.written.some((k) => byRate(k, e.at)))) {
      expect(e.rest + 2 * e.written.length).toBeGreaterThanOrEqual(AFTER_DEPLOY_RESERVE);
    }
    // Each written once more, with the new version in its metadata.
    expect((kv.metadata.get(kvKey(`${SATELLITES_KEY}-version`)) as { version?: string }).version).not.toBe("2.0.0");
    for (const s of pages) {
      expect(kv.writes.get(kvKey(s.key)), s.key).toBe(2);
      expect((kv.metadata.get(kvKey(s.key)) as { version?: string }).version).toBe("2.0.0");
    }
    // Then none is due for its version any more, only by its rate.
    const after = await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    for (const k of after.value.written) expect(byRate(k, now), k).toBe(true);
    expect(after.value.left.filter((l) => l.why.startsWith("autre version"))).toEqual([]);
  });
});

describe("the shared copies after a deploy that raises no revision", () => {
  it("are none due for their version: the events cost what they cost before the deploy", async () => {
    const kv = new FakeKv();
    const now = T0;
    const edge = new CountedStore();
    // The real list's keys, each written by the previous version 15 seconds apart, none due by its rate nor at its slot.
    const list: Shared[] = SHARED.map((s) => ({ ...s, build: async () => (count(s.cold ?? 25), {}) }));
    for (const [i, s] of list.entries()) {
      const at = now - (i + 1) * 15_000;
      const version = stampOf(s.key, "1.0.0");
      const entry = { value: {}, fetchedAt: at, cost: s.cold, ...(version && { version }) };
      await kv.put(kvKey(s.key), JSON.stringify(entry), { metadata: { fetchedAt: at, cost: s.cold, every: typeof s.every === "number" ? s.every : 30, ...(version && { version }) } });
      await edge.put(s.key, entry);
    }
    const event = (version: string) =>
      counted(SCHEDULED_BUDGET, () => warmShared(new Cache(new TieredStore(new MemoryStore(), edge), () => now, false, undefined, version), kv, new Date(now), list));
    const before = await event("1.0.0");
    const after = await event("2.0.0");
    expect(before.value).toEqual({ written: [], left: [] });
    expect(after.value).toEqual({ written: [], left: [] });
    expect(after.used).toBe(before.used);
    // A page's copy read by the data center after the deploy: served, not built again.
    const page = new Cache(new TieredStore(new MemoryStore(), new SharedFallback(edge, kv, () => now, "2.0.0")), () => now, false, undefined, "2.0.0");
    expect((await page.peek("web:air"))!.outdated).toBeUndefined();
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
    const run = await counted(TIGHT, async () => {
      const first = await warmShared(cache, kv, new Date(T0), pages);
      return { first, after: await warmShared(cache, kv, new Date(T0), after) };
    });
    expect(run.used).toBeLessThanOrEqual(TIGHT);
    // Short of subrequests, the page copies take the invocation: the ensemble waits, and never makes one of them wait.
    expect(run.value.after.written).toEqual([]);
    expect(run.value.after.left[0].why).toMatch(/^budget : /);
    // An event with the page copies fresh: it fits.
    const quiet = await counted(TIGHT, async () => {
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
      await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    }
    const perDay = (every: number) => (24 * 60) / every + 1;
    // The volcano's copy goes every 5 minutes during an alert: its quickest rate bounds it.
    for (const s of SHARED) expect(kv.writes.get(kvKey(s.key)), s.key).toBeLessThanOrEqual(perDay(typeof s.every === "number" ? s.every : 5));
    const total = [...kv.writes.values()].reduce((a, b) => a + b, 0);
    // The vigilance and the news every 5 minutes, the earthquakes every 10, the rivers every 15, quiet here, the volcano's
    // copy, quiet too, every 30 minutes like four others, the ONF's map and the counts of /chiffres every hour, and the
    // satellites' grids every 3 hours (about 1 180 a day, partagees.ts).
    expect(total).toBeLessThanOrEqual(1176);
    expect(total).toBeGreaterThanOrEqual(1133);
  });

  it("refreshes a copy at each of its slots, though written a few seconds into the event before", async () => {
    // As in the Worker: each event a second past its minute, each build two seconds long. The volcano's copy in an
    // alert, every 5 minutes, went every 10: a few seconds short of its rate, and its last copy still fresh in the cache.
    const kv = new FakeKv();
    let now = T0 + 1000;
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => now, false);
    const list: Shared[] = [{ key: "web:essai-alerte", build: async () => ((now += 2000), count(2), {}), every: 5 }];
    for (let i = 0; i < 12; i++) {
      now = T0 + i * 5 * 60_000 + 1000;
      await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    }
    expect(kv.writes.get(kvKey("web:essai-alerte"))).toBe(12);
  });

  it("refreshes each copy in the events of its offset, the copies of one rate in different events", async () => {
    const kv = new FakeKv();
    let now = T0 + 1000;
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => now, false);
    const built: Record<string, number[]> = {};
    const copy = (key: string, offset: number): Shared =>
      ({ key, offset, every: 30, build: async () => ((built[key] ??= []).push(new Date(now).getUTCMinutes()), (now += 2000), count(2), {}) });
    const list = [copy("web:essai-5", 5), copy("web:essai-10", 10), copy("web:essai-25", 25)];
    // None in KV: all built in the first event, then each at its own minutes, every 30 minutes. The one at 5 not at 00:05,
    // a few seconds short of 5 minutes (its margin, a sixth of its rate) after the first build: at its next slot, 00:35.
    // The one at 10 at 00:10 already, 10 minutes after.
    for (let i = 0; i < 36; i++) {
      now = T0 + i * 5 * 60_000 + 1000;
      await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    }
    expect(built["web:essai-5"]).toEqual([0, 35, 5, 35, 5, 35]);
    expect(built["web:essai-10"]).toEqual([0, 10, 40, 10, 40, 10, 40]);
    expect(built["web:essai-25"]).toEqual([0, 25, 55, 25, 55, 25, 55]);
    expect(slotStart(T0 + 47 * 60_000, 30, 10)).toBe(T0 + 40 * 60_000);
    expect(slotStart(T0 + 7 * 60_000, 30, 10)).toBe(T0 - 20 * 60_000);
  });

  it("brings a copy written off its slots back on them at its next slot, or the one after within its margin", async () => {
    // web:mer, every 3 hours at 01:15 UTC and every 3 hours after: rebuilt at 20:46 for its version on 26 October 2026,
    // it then went by its rate, 5 minutes later at each refresh, out of its slots for two days.
    // Keys of their own: the module remembers the copies it wrote.
    const run = async (key: string, from: number, hours: number, tight?: number) => {
      const kv = new FakeKv();
      let now = 0;
      const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => now, false);
      const at: number[] = [];
      const list: Shared[] = [{ key, build: async () => (at.push(now), (now += 2000), count(2), {}), every: 180, offset: 75 }];
      for (let t = from; t < from + hours * 3600_000; t += 5 * 60_000) {
        now = t + 1000;
        await counted(t === tight ? 1 : SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
      }
      const hhmm = at.map((x) => new Date(x).toISOString().slice(11, 16));
      const ages = at.slice(1).map((x, i) => (x - at[i]) / 60_000);
      return { hhmm, ages, writes: kv.writes.get(kvKey(key)) };
    };
    // Written at 20:45, 90 minutes after its slot: at 22:15 again, then on its slots, 8 a day, for three days.
    const late = await run("web:essai-mer-tard", T0 + (20 * 60 + 45) * 60_000, 3 * 24);
    expect(late.hhmm.slice(0, 4)).toEqual(["20:45", "22:15", "01:15", "04:15"]);
    expect(late.hhmm.slice(1).every((h) => ["01:15", "04:15", "07:15", "10:15", "13:15", "16:15", "19:15", "22:15"].includes(h))).toBe(true);
    expect(late.writes).toBe(1 + 3 * 8);
    // Written at 01:00, 15 minutes before its slot, within its margin: not at 01:15, at 04:15, 3 h 15 later, never past
    // its rate and margin; then on its slots.
    const close = await run("web:essai-mer-proche", T0 + 60 * 60_000, 24);
    expect(close.hhmm.slice(0, 4)).toEqual(["01:00", "04:15", "07:15", "10:15"]);
    expect(Math.max(...close.ages)).toBeLessThanOrEqual(180 + 30);
    expect(close.writes).toBe(8);
    // Left for the budget at its slot: tried again in the next event, then on its slots again.
    const left = await run("web:essai-mer-reportee", T0 + 60 * 60_000 + 15 * 60_000, 12, T0 + (4 * 60 + 15) * 60_000);
    expect(left.hhmm).toEqual(["01:15", "04:20", "07:15", "10:15"]);
  });

  it("gives every copy of the real list an offset within its rate, a multiple of the events' 5 minutes", () => {
    for (const s of [...SHARED, ...SHARED_AFTER]) {
      const every = typeof s.every === "number" ? s.every : s.range!.usual;
      expect(s.offset, s.key).toBeDefined();
      expect(s.offset! % 5 === 0 && s.offset! >= 0 && s.offset! < every, s.key).toBe(true);
    }
  });

  it("builds the power cuts' copy before the page that carries it, and reads them again sooner while a mairie is silent", async () => {
    const kv = new FakeKv();
    let now = T0;
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => now, false);
    const order: string[] = [];
    let silent = true;
    const courant = SHARED.find((s) => s.key === "web:courant")!;
    const electricite = SHARED.find((s) => s.key === "web:electricite")!;
    // Keys of their own: the copies the tests before wrote are remembered by the module.
    expect(courant.before).toEqual([electricite.key]);
    const [C, E] = ["web:courant-ordre", "web:electricite-ordre"];
    const list: Shared[] = [
      { ...electricite, key: E, build: async () => (order.push(E), count(2), {}) },
      { ...courant, key: C, before: [E], build: async () => (order.push(C), count(2), { indisponibles: silent ? ["Sainte-Marie"] : [] }) },
    ];
    // The page's copy more overdue than the power cuts': built after them all the same.
    await kv.put(kvKey(C), JSON.stringify({ value: {}, fetchedAt: T0 - 3 * 3600_000 }), { metadata: { fetchedAt: T0 - 3 * 3600_000, every: 120 } });
    await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    expect(order).toEqual([C, E]);
    // Sainte-Marie silent: read again at its next slot of 30 minutes (00:20); once it answers, at its slots of 2 hours
    // (00:50, the copy read silent, then 02:20).
    const until = async (end: number) => {
      while (now < T0 + end * 60_000) {
        now += 5 * 60_000;
        await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
      }
    };
    await until(20);
    expect(kv.writes.get(kvKey(C))).toBe(3);
    silent = false;
    await until(50);
    expect(kv.writes.get(kvKey(C))).toBe(4);
    await until(135);
    expect(kv.writes.get(kvKey(C))).toBe(4);
    await until(140);
    expect(kv.writes.get(kvKey(C))).toBe(5);
  });

  it("reads the events of /chiffres again an hour after a list in part, not at every event, and every 6 hours once whole", async () => {
    const kv = new FakeKv();
    let now = T0;
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => now, false);
    let silent = true;
    const evenements = SHARED.find((s) => s.key === "web:chiffres:evenements")!;
    // A key of its own: the copies the tests before wrote are remembered by the module.
    const K = "web:chiffres:evenements-partiel";
    const list: Shared[] = [{ ...evenements, key: K, before: [], build: async () => (count(2), { nombre: 40, ...(silent ? { sans: ["Le Séchoir"] } : {}) }) }];
    const events = async (minutes: number) => {
      for (const end = now + minutes * 60_000; now < end; now += 5 * 60_000) await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    };
    // Two hours of events while an agenda is silent: at the first, then in the slots of its hour (minute 30), never
    // at every event.
    await events(120);
    expect(kv.writes.get(kvKey(K))).toBe(3);
    // Whole again at the next slot, then not before 6 hours.
    silent = false;
    await events(60);
    expect(kv.writes.get(kvKey(K))).toBe(4);
    await events(3 * 60);
    expect(kv.writes.get(kvKey(K))).toBe(4);
  });

  it("short of subrequests, leaves a build that would not fit after a full AROME prefetch to a later event, and says why", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    const list: Shared[] = [{ key: "web:essai-lourd", build: async () => (count(15), {}), every: 30 }];
    // What the build takes, learnt once.
    await counted(SCHEDULED_BUDGET, () => measured("web:essai-lourd", () => list[0].build(cache, new Date(T0))));
    const run = await counted(TIGHT, async () => {
      count(28); // the AROME grids of a new run
      return warmShared(cache, kv, new Date(T0), list);
    });
    expect(run.value.written).toEqual([]);
    expect(run.value.left).toEqual([{ key: "web:essai-lourd", why: "budget : 29 faites, 17 prévues" }]);
    expect(run.used).toBeLessThanOrEqual(TIGHT);
    // An ordinary event, the grids already there: it fits.
    const quiet = await counted(TIGHT, async () => {
      count(2);
      return warmShared(cache, kv, new Date(T0), list);
    });
    expect(quiet.value.written).toEqual(["web:essai-lourd"]);
    expect(quiet.used).toBeLessThanOrEqual(TIGHT);
  });

  it("builds every copy due, from cold, after a full AROME prefetch, with the agendas' share left: none put off", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new CountedStore()), () => T0, false);
    const build = (s: Shared): Shared => ({ ...s, key: `${s.key}-tout`, build: async () => (count(s.cold ?? 25), {}) });
    const run = await counted(SCHEDULED_BUDGET, async () => {
      count(MAX_NEW_GRIDS + 10); // a new AROME run: its grids, the run list and the bundles
      const first = await warmShared(cache, kv, new Date(T0), SHARED.map(build));
      const after = await warmShared(cache, kv, new Date(T0), SHARED_AFTER.map(build));
      return { first, after, rest: left() };
    });
    expect(run.value.first.left).toEqual([]);
    expect(run.value.after.left).toEqual([]);
    expect(run.value.first.written.length + run.value.after.written.length).toBe(SHARED.length + SHARED_AFTER.length);
    // What the planned agendas may take after them, at the most: more than they need (the 5 pages of Sportsregions the
    // dearest, 17 when all are due together, BUDGET.md), and than the counts of /chiffres and their events, 85 with their
    // lookups, the earthquakes and the ONF's map, 10 with theirs, all three together (112), built too. 130 before the
    // news was read every 5 minutes (actualites:fil, 13 with its lookup), 117 since.
    expect(run.value.rest).toBeGreaterThan(112);
    expect(run.used).toBeLessThanOrEqual(SCHEDULED_BUDGET);
  });

  it("right after a deploy, warms every copy from their cold costs in the first event", async () => {
    const kv = new FakeKv();
    let now = T0;
    const cache = new Cache(new TieredStore(new MemoryStore(), new CountedStore()), () => now, false);
    // Builds that take their cold cost, under keys no isolate has built: the costs are known from the list only.
    const list: Shared[] = SHARED.map((s) => ({ ...s, key: `${s.key}-deploy`, build: async () => (count(s.cold ?? 25), { at: now }) }));
    const events: string[][] = [];
    while (events.length < 10 && kv.data.size < list.length) {
      // The AROME grids already there, as in most events: none fetched.
      const run = await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
      expect(run.used).toBeLessThanOrEqual(SCHEDULED_BUDGET);
      for (const l of run.value.left) expect(l.why).toMatch(/^budget : /);
      events.push(run.value.written);
      now += 5 * 60_000;
    }
    expect(kv.data.size).toBe(list.length);
    // Every copy in the first event: five minutes after a deploy, all are in KV.
    expect(events.length).toBe(1);
    expect(events[0].length).toBe(list.length);
  });

  it("short of subrequests, tries a copy an hour past its time at its cold cost, and says in the log when it is left all the same", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false, undefined, "2.0.0");
    // Copies written by another isolate whose builds took 31 at night: never under 33 with 4 spent, 32 left.
    const at = (key: string, ago: number, every = 30, version?: string) =>
      kv.put(kvKey(key), JSON.stringify({ value: {}, fetchedAt: T0 - ago * 60_000, cost: 31, version }), { metadata: { fetchedAt: T0 - ago * 60_000, cost: 31, every, version } });
    await at("web:essai-retard", 16 * 60, 30, "2.0.0");
    await at("web:essai-recent", 45, 30, "2.0.0");
    // Due only because the previous version built it, an hour and a half ago: not late, its rate is 3 hours.
    await at("web:essai-version", 90, 3 * 60, "1.0.0");
    const list: Shared[] = [
      { key: "web:essai-retard", build: async () => (count(12), {}), every: 30, cold: 15 },
      { key: "web:essai-recent", build: async () => (count(12), {}), every: 30, cold: 15 },
      { key: "web:essai-version", build: async () => (count(12), {}), every: 3 * 60, cold: 15 },
    ];
    const said: string[] = [];
    const error = console.error;
    console.error = (...a: unknown[]) => void said.push(a.join(" "));
    try {
      const run = await counted(TIGHT, async () => {
        count(4); // the AROME prefetch, the grids already there
        return warmShared(cache, kv, new Date(T0), list);
      });
      // Sixteen hours late: tried at 2 + 15, and built.
      expect(run.value.written).toEqual(["web:essai-retard"]);
      expect(JSON.parse(kv.data.get(kvKey("web:essai-retard"))!).cost).toBe(12);
      // Due for its version: expected at 31, with the agendas' reserve, and never said late. A quarter of an hour late:
      // still expected at 31, left, and not yet said.
      expect(run.value.left).toEqual([
        { key: "web:essai-version", why: "autre version, budget : 18 faites, 33 prévues" },
        { key: "web:essai-recent", why: "budget : 18 faites, 33 prévues" },
      ]);
      expect(run.used).toBeLessThanOrEqual(TIGHT);
      expect(said).toEqual([]);
      // An hour and a quarter late, its cold cost does not fit either: one line says so.
      const later = await counted(TIGHT, async () => {
        count(25);
        return warmShared(cache, kv, new Date(T0 + 60 * 60_000), list);
      });
      expect(later.value.written).toEqual([]);
      expect(said).toEqual(["copie partagée en retard : web:essai-recent, écrite il y a 105 min, reportée (budget : 26 faites, 17 prévues)"]);
    } finally {
      console.error = error;
    }
  });

  it("keeps a build's cost with its KV copy, for an isolate that has not built it", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    const list: Shared[] = [{ key: "web:essai-garde", build: async () => (count(5), {}), every: 30 }];
    // Its copy, written an hour ago by another isolate, which found it took 5.
    await kv.put(kvKey("web:essai-garde"), JSON.stringify({ value: {}, fetchedAt: T0 - 3600_000, cost: 5 }));
    // Taken to cost 25 without it, it would not fit after these.
    const run = await counted(SCHEDULED_BUDGET, async () => {
      count(25);
      return warmShared(cache, kv, new Date(T0), list);
    });
    expect(run.value.written).toEqual(["web:essai-garde"]);
    expect(run.used).toBeLessThanOrEqual(SCHEDULED_BUDGET);
    expect(JSON.parse(kv.data.get(kvKey("web:essai-garde"))!).cost).toBe(5);
  });

  it("takes every copy's age and cost from one listing of KV, not a read each", async () => {
    const kv = new FakeKv();
    let now = T0;
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => now, false);
    // Without the vigilance and the earthquakes, due at every event or every other.
    const list: Shared[] = SHARED.filter((s) => s.every !== 5 && s.every !== 10).map((s) => ({ ...s, key: `${s.key}-liste`, cold: 2, build: async () => (count(2), { at: now }) }));
    await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    expect(kv.data.size).toBe(list.length);
    // Each copy written with what the event needs as its key's metadata.
    expect(kv.metadata.get(kvKey("web:air-liste"))).toEqual({ fetchedAt: T0, cost: 2, every: 60 });
    kv.reads = 0;
    kv.lists = 0;
    now += 5 * 60_000;
    const run = await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    expect(run.value).toEqual({ written: [], left: [] });
    expect(kv.lists).toBe(1);
    expect(kv.reads).toBe(0);
    // One subrequest for the ages, whatever the number of copies.
    expect(run.used).toBe(1);
    // A copy another isolate wrote a minute ago: known from the listing alone, its cost too.
    const other: Shared = { key: "web:essai-autre-isolat", build: async () => (count(2), {}), every: 30 };
    await kv.put(kvKey(other.key), JSON.stringify({ value: {}, fetchedAt: now - 60_000, cost: 9 }), { metadata: { fetchedAt: now - 60_000, cost: 9, every: 30 } });
    kv.reads = 0;
    const again = await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), [...list, other]));
    expect(again.value).toEqual({ written: [], left: [] });
    expect(kv.reads).toBe(0);
  });

  it("lists KV once for the event's two calls, the copies and those after", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    const build = (s: Shared): Shared => ({ ...s, key: `${s.key}-une-liste`, build: async () => (count(2), {}) });
    const run = await counted(SCHEDULED_BUDGET, async () => {
      const listing = listShared(kv);
      const first = await warmShared(cache, kv, new Date(T0), SHARED.map(build), listing);
      const after = await warmShared(cache, kv, new Date(T0), SHARED_AFTER.map(build), listing);
      return [...first.written, ...after.written].length;
    });
    expect(run.value).toBe(SHARED.length + SHARED_AFTER.length);
    expect(kv.lists).toBe(1);
  });

  it("reads a copy whole when its key has no metadata yet, or when KV does not list", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    // Written by the code before the metadata, ten minutes ago, in its slot: not due, known only by reading it.
    const list: Shared[] = [{ key: "web:essai-ancienne", build: async () => (count(2), {}), every: 30, offset: 15 }];
    await kv.put(kvKey("web:essai-ancienne"), JSON.stringify({ value: {}, fetchedAt: T0 - 10 * 60_000 }));
    const run = await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(T0), list));
    expect(run.value).toEqual({ written: [], left: [] });
    expect(kv.reads).toBe(1);
    // KV's listing fails: each copy is read, as before the listing.
    kv.down = true;
    kv.reads = 0;
    await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(T0), list));
    expect(kv.reads).toBe(1);
  });

  it("stays within a build's budget when a build costs more than thought, and says it was cut", async () => {
    const kv = new FakeKv();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    // Never run in this isolate: taken to cost 25, it would take three builds' budget.
    const list: Shared[] = [{ key: "web:essai-imprevu", build: async () => { for (let i = 0; i < 3 * BUILD_BUDGET; i++) count(); return {}; }, every: 30 }];
    const run = await counted(SCHEDULED_BUDGET, async () => {
      count(2);
      return warmShared(cache, kv, new Date(T0), list);
    });
    const settled = await run.settled();
    expect(run.value.written).toEqual([]);
    expect(run.value.left[0].key).toBe("web:essai-imprevu");
    expect(run.value.left[0].why).toMatch(/^erreur : .*Too many subrequests/);
    // Cut at the build's budget, the rest of the event's left to the other copies.
    expect(settled.used).toBeLessThanOrEqual(2 + BUILD_BUDGET + 2);
  });

  it("spreads the last copy when the source failed, once, and says so after", async () => {
    const kv = new FakeKv();
    let now = T0;
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => now, false);
    await cache.get("web:essai-panne", 60, async () => ({ n: 1 }));
    now += 3600_000;
    const list: Shared[] = [{ key: "web:essai-panne", build: async () => { throw new Error("source muette"); }, every: 30 }];
    // KV has none: the last copy goes there, with its time, the one every data center then serves.
    const first = await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    expect(first.value).toEqual({ written: ["web:essai-panne"], left: [] });
    expect(JSON.parse(kv.data.get(kvKey("web:essai-panne"))!)).toMatchObject({ value: { n: 1 }, fetchedAt: T0 });
    // KV has it: not written again.
    now += 3600_000;
    const run = await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(now), list));
    expect(run.value).toEqual({ written: [], left: [{ key: "web:essai-panne", why: "copie de secours" }] });
  });
});

describe("a copy built alongside the others", () => {
  // A copy whose build waits on a slow site until `open`, before two quick ones. Their keys of their own in each test:
  // what this isolate wrote is remembered (`wrote`).
  let n = 0;
  const setup = () => {
    const k = (name: string) => `web:essai-${name}-${++n}`;
    const [slow, quick1, quick2] = [k("lent"), k("vite"), k("vite")];
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const built: string[] = [];
    const quick = (key: string): Shared => ({ key, every: 30, build: async () => (built.push(key), count(2), {}) });
    const list: Shared[] = [{ key: slow, every: 15, alongside: true, build: async () => (await gate, built.push(slow), count(2), {}) }, quick(quick1), quick(quick2)];
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => T0, false);
    return { list, cache, built, open: () => open(), slow, quick1, quick2 };
  };

  it("does not hold back the copies after it: they are built and written while it waits, and it is handed over", async () => {
    const { list, cache, built, open, slow, quick1, quick2 } = setup();
    const kv = new FakeKv();
    const held: Promise<void>[] = [];
    const run = await counted(SCHEDULED_BUDGET, async () => {
      const warmed = await warmShared(cache, kv, new Date(T0), list, listShared(kv), (work) => void held.push(work));
      const before = { written: [...warmed.written], built: [...built] };
      open();
      await Promise.all(held);
      return { before, after: warmed.written };
    });
    expect(held.length).toBe(1);
    expect(run.value.before).toEqual({ written: [quick1, quick2], built: [quick1, quick2] });
    expect(run.value.after).toEqual([quick1, quick2, slow]);
    expect(kv.writes.get(kvKey(slow))).toBe(1);
  });

  it("is waited for at the end when nothing is given to hold it", async () => {
    const { list, cache, open, slow, quick1, quick2 } = setup();
    const kv = new FakeKv();
    open();
    const run = await counted(SCHEDULED_BUDGET, () => warmShared(cache, kv, new Date(T0), list));
    expect([...run.value.written].sort()).toEqual([quick1, quick2, slow].sort());
  });

  it("keeps what it is expected to take out of what the copies after it may use, until it is done", async () => {
    const { list, cache, open } = setup();
    const kv = new FakeKv();
    // Expected to take its cold cost and the lookup: 22.
    list[0] = { ...list[0], cold: 20 };
    const seen: number[] = [];
    list[1] = { ...list[1], build: async () => (seen.push(left()), count(2), {}) };
    const held: Promise<void>[] = [];
    const run = await counted(SCHEDULED_BUDGET, async () => {
      // After the listing of KV, one subrequest.
      const listing = listShared(kv);
      await listing;
      const base = left();
      await warmShared(cache, kv, new Date(T0), list, listing, (work) => void held.push(work));
      open();
      await Promise.all(held);
      return { base, after: left() };
    });
    expect(seen[0]).toBe(run.value.base - 22);
    // Once done, only what was spent is gone: each copy's build and its KV write.
    expect(run.value.after).toBe(run.value.base - 9);
  });
});
