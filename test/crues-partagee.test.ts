import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { counted, SCHEDULED_BUDGET } from "../src/budget.js";
import { Cache, type CacheEntry, MemoryStore, TieredStore } from "../src/cache.js";
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
    expect(asked).toBe(3);
    expect(r.fetchedAt).toEqual(NOW);
  });

  it("is read from Vigicrues as before when the scheduled event no longer keeps it", async () => {
    const kv = new FakeKv();
    await kv.put(kvKey(KEY), JSON.stringify(await builtAgo(2 * 60)));
    const cache = center(new MemoryStore(), kv, NOW);
    const r = await cache.get(KEY, FRESH_SECONDS, () => buildCrues(cache, NOW));
    expect(asked).toBe(3);
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
