import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { counted, SCHEDULED_BUDGET, scheduled } from "../src/budget.js";
import { Cache, type CacheEntry, MemoryStore, TieredStore } from "../src/cache.js";
import { readings, type Readings, STATIONS } from "../src/providers/vigicrues.js";
import { buildCrues, type CruesAnswer, FRESH_SECONDS } from "../src/web/data.js";
import { cruesLive } from "../src/web/domains.js";
import { type Kv, kvKey, SHARED, SharedFallback, warmShared } from "../src/web/partagees.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-26T07:42:07Z");
const KEY = "web:crues";
const entry = () => SHARED.find((s) => s.key === KEY);

/** A KV namespace in memory. */
class FakeKv implements Kv {
  data = new Map<string, string>();
  async get(key: string) {
    const v = this.data.get(key);
    return v ? JSON.parse(v) : null;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
  }
  async list({ prefix }: { prefix: string }) {
    return { keys: [...this.data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
  }
}

/** A data center's cache as the Worker builds it (worker.ts): memory, then the data center's cache with KV behind. */
const center = (edge: MemoryStore, kv: Kv, at: Date) =>
  new Cache(new TieredStore(new MemoryStore(), new SharedFallback(edge, kv, () => at.getTime())), () => at.getTime(), false);

// Vigicrues Réunion: how many times it was asked, and the vigilance it answers.
let asked = 0;
let vigilance = fixture("vigicrues_vigilance.json");

beforeEach(() => {
  asked = 0;
  vigilance = fixture("vigicrues_vigilance.json");
  vi.stubGlobal("fetch", async (url: string, init?: { body?: URLSearchParams }) => {
    asked++;
    return new Response(url.endsWith("vigilance.php") ? vigilance : fixture(`vigicrues_${init?.body?.get("mesure")}.json`), { headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The rivers as Vigicrues gave them `ageMin` minutes ago. */
async function builtAgo(ageMin: number): Promise<CacheEntry> {
  const at = new Date(NOW.getTime() - ageMin * 60_000);
  const value = await buildCrues(center(new MemoryStore(), new FakeKv(), at), at);
  asked = 0;
  return { value, fetchedAt: at.getTime() };
}

/** A data center that last built the rivers' copy `ageMin` minutes ago, and has kept it since. */
async function builtThere(ageMin: number): Promise<MemoryStore> {
  const edge = new MemoryStore();
  await edge.put(KEY, await builtAgo(ageMin));
  return edge;
}

/** The home page's tile in a data center: its copy as the home page reads it, without building it (site.ts, `tileCopies`). */
async function tile(cache: Cache) {
  const copy = await cache.peek<CruesAnswer>(KEY, NOW.getTime() - FRESH_SECONDS * 1000);
  return { copy, live: cruesLive(copy ?? null, NOW) };
}

describe("the rivers kept by the scheduled event", () => {
  it("is one copy for every data center: none says Vigicrues has not answered while it does", async () => {
    // The scheduled event, in one data center, 2 minutes ago.
    const kv = new FakeKv();
    const at = new Date(NOW.getTime() - 2 * 60_000);
    const warmed = await counted(SCHEDULED_BUDGET, () => warmShared(center(new MemoryStore(), kv, at), kv, at, [entry()!]));
    expect(warmed.value.written).toEqual([KEY]);
    // The home page in another data center, which built the rivers' copy two hours ago and no view since.
    asked = 0;
    const { copy, live } = await tile(center(await builtThere(122), kv, NOW));
    expect(asked).toBe(0);
    expect(copy?.fetchedAt).toEqual(at);
    expect(live?.detail).not.toContain("lue");
  });

  it("says when the data center's own copy was read, as before, when KV has none", async () => {
    const { copy, live } = await tile(center(await builtThere(122), new FakeKv(), NOW));
    expect(asked).toBe(0);
    expect(copy?.fetchedAt).toEqual(new Date(NOW.getTime() - 122 * 60_000));
    expect(live?.detail).toMatch(/ · lue à 09:40, sans réponse depuis$/);
  });

  it("is read from Vigicrues as before when KV has no copy", async () => {
    const cache = center(new MemoryStore(), new FakeKv(), NOW);
    const r = await cache.get(KEY, FRESH_SECONDS, () => buildCrues(cache, NOW));
    // The vigilance, and the heights and the flows in 4 batches each.
    expect(asked).toBe(9);
    expect(r.fetchedAt).toEqual(NOW);
  });

  it("is read from Vigicrues as before when the scheduled event no longer keeps it", async () => {
    const kv = new FakeKv();
    await kv.put(kvKey(KEY), JSON.stringify(await builtAgo(2 * 60)));
    const cache = center(new MemoryStore(), kv, NOW);
    const r = await cache.get(KEY, FRESH_SECONDS, () => buildCrues(cache, NOW));
    // The vigilance, and the heights and the flows in 4 batches each.
    expect(asked).toBe(9);
    expect(r.fetchedAt).toEqual(NOW);
  });

  it("is kept every 15 minutes, every 5 while a river is in yellow flood vigilance or above", async () => {
    const every = entry()!.every as (last: unknown) => number;
    expect(every((await builtAgo(0)).value)).toBe(15);
    // The recorded answer with an orange vigilance on the rivière des Galets (as in crues.test.ts).
    const orange = JSON.parse(vigilance);
    orange[0] = [true, 3, "2026-10-24 03:30:00", "Fortes pluies sur l'ouest.", "", "", "", 0];
    orange.find((r: unknown[]) => r[0] === "rivière des Galets")[1] = 3;
    vigilance = JSON.stringify(orange);
    expect(every((await builtAgo(0)).value)).toBe(5);
    expect(every(undefined)).toBe(15);
  });
});

// 27/10/2026: from Cloudflare, the heights of the 29 gauges asked at once took more than the 34 s given to them, every
// read since the evening before cut, and the copy of 20:58 served to every question for 15 hours.
describe("the 29 gauges, read by the scheduled event in batches", () => {
  // Each request answered with the recorded readings of the gauges it asked for, `bump` metres higher; a batch with a
  // gauge of `silent` in it does not answer.
  let batches: string[][];
  let most: number;
  let bump: number;
  let silent: string[];
  beforeEach(() => {
    [batches, most, bump, silent] = [[], 0, 0, []];
    let now = 0;
    vi.stubGlobal("fetch", async (url: string, init?: { body?: URLSearchParams }) => {
      if (new URL(url).pathname.endsWith("vigilance.php")) return new Response(vigilance);
      const ids = Object.keys(JSON.parse(init?.body?.get("liste") ?? "{}"));
      batches.push(ids);
      most = Math.max(most, ++now);
      await new Promise((resolve) => setTimeout(resolve, 5));
      now--;
      if (ids.some((id) => silent.includes(id))) throw new Error("The operation was aborted due to timeout");
      const all = JSON.parse(fixture(`vigicrues_${init?.body?.get("mesure")}.json`)) as Record<string, [number, number][]>;
      return Response.json(Object.fromEntries(ids.filter((id) => all[id]).map((id) => [id, all[id].map(([t, v]) => [t, v + bump])])));
    });
  });

  // A data center, its own memory and cache, with the Worker's KV behind (worker.ts: the durable store).
  const there = (kv: MemoryStore, at: Date) => new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => at.getTime(), false, kv);
  const inEvent = (cache: Cache, at: Date) =>
    counted(SCHEDULED_BUDGET, async () => {
      scheduled();
      return readings(cache, "hauteur", undefined, at);
    });
  const last = (r: Readings, id: string) => r[id]?.at(-1)?.[1];
  // A gauge of the first batch and one of the last, both in the recording.
  const recorded = Object.keys(JSON.parse(fixture("vigicrues_hauteur.json")));
  const ids = STATIONS.map((s) => s.id).filter((id) => recorded.includes(id));
  const [first, other] = [ids.find((id) => STATIONS.findIndex((s) => s.id === id) < 8)!, ids.findLast((id) => STATIONS.findIndex((s) => s.id === id) >= 24)!];

  it("asks for 8 gauges at most at a time, two requests at once at most", async () => {
    const r = await inEvent(there(new MemoryStore(), NOW), NOW);
    expect(batches.map((b) => b.length)).toEqual([8, 8, 8, 5]);
    expect(new Set(batches.flat()).size).toBe(STATIONS.length);
    expect(most).toBe(2);
    expect(Object.keys(r.value.value).length).toBeGreaterThan(20);
  });

  it("serves a question, in another data center, the copy the scheduled event kept in KV, with its time, without asking", async () => {
    const kv = new MemoryStore();
    const at = new Date(NOW.getTime() - 14 * 60_000);
    await inEvent(there(kv, at), at);
    batches = [];
    const r = await readings(there(kv, NOW), "hauteur", undefined, NOW);
    expect(batches).toEqual([]);
    expect(r).toMatchObject({ fetchedAt: at, stale: false });
  });

  it("asks Vigicrues for a question only when no copy is kept anywhere", async () => {
    const r = await readings(there(new MemoryStore(), NOW), "hauteur", undefined, NOW);
    expect(batches.length).toBe(4);
    expect(r.fetchedAt).toEqual(NOW);
  });

  it("keeps, for the gauges of a batch that did not answer, their own readings from before, and the new ones of the others", async () => {
    const kv = new MemoryStore();
    const before = new Date(NOW.getTime() - 15 * 60_000);
    const old = (await inEvent(there(kv, before), before)).value.value;
    [bump, silent] = [1, [first]];
    const r = (await inEvent(there(kv, NOW), NOW)).value;
    expect(r.stale).toBe(false);
    expect(r.value[first]).toEqual(old[first]);
    expect(last(r.value, other)).toBeCloseTo(last(old, other)! + 1);
  });

  it("serves the copy before, said as Vigicrues' that did not answer, when no batch answered", async () => {
    const kv = new MemoryStore();
    const before = new Date(NOW.getTime() - 15 * 60_000);
    await inEvent(there(kv, before), before);
    silent = STATIONS.map((s) => s.id);
    const r = (await inEvent(there(kv, NOW), NOW)).value;
    expect(r).toMatchObject({ fetchedAt: before, stale: true, source: "vigicrues" });
    // And a question after it: the same copy, said the same way.
    expect(await readings(there(kv, NOW), "hauteur", undefined, NOW)).toMatchObject({ fetchedAt: before, stale: true, source: "vigicrues" });
  });
});
