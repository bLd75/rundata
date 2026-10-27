import { describe, expect, it } from "vitest";
import { Cache, type CacheEntry, MemoryStore, TieredStore } from "../src/cache.js";
import { ISLAND_READS, REGISTRY } from "../src/registre.js";
import { UpstreamError } from "../src/types.js";

// A source read whole for the island under one key (cache.ts `island`): the isolates and data centers that have not
// read it take the copy another one put in KV, and a source that does not answer is left alone by all of them until
// its breaker closes (26/10/2026: NASA FIRMS's fires read 8 times in 50 minutes for 30 minutes of freshness).
describe("a source read for the whole island (cache.ts `island`)", () => {
  const T0 = Date.parse("2026-10-26T17:00:00Z");
  // Each isolate its own memory, all of them the same KV.
  const isolates = (kv: MemoryStore, clock: { t: number }) => () => new Cache(new MemoryStore(), () => clock.t, false, kv);

  it("reads the source once for every isolate while its copy in KV is fresh, and again after", async () => {
    const kv = new MemoryStore();
    const clock = { t: T0 };
    const isolate = isolates(kv, clock);
    let reads = 0;
    const load = async () => ++reads;
    expect((await isolate().island("feux:ile", 30 * 60, load)).value).toBe(1);
    clock.t += 20 * 60_000;
    const later = await isolate().island("feux:ile", 30 * 60, load);
    expect(later).toMatchObject({ value: 1, stale: false });
    expect(reads).toBe(1);
    clock.t += 11 * 60_000;
    expect((await isolate().island("feux:ile", 30 * 60, load)).value).toBe(2);
    expect(reads).toBe(2);
  });

  it("keeps its copies in KV apart from the other entries there", async () => {
    const kv = new MemoryStore();
    await new Cache(new MemoryStore(), () => T0, false, kv).island("uv:ile", 3600, async () => "uv");
    expect(await kv.get("uv:ile")).toBeUndefined();
    expect((await kv.get("lecture:uv:ile"))?.value).toBe("uv");
  });

  it("leaves a silent source alone in every isolate until its breaker closes, its copy served", async () => {
    const kv = new MemoryStore();
    const clock = { t: T0 };
    const isolate = isolates(kv, clock);
    await isolate().island("volcan:ovpf", 10 * 60, async () => "billets");
    clock.t += 11 * 60_000;
    let tries = 0;
    const silent = async (): Promise<string> => {
      tries++;
      throw new UpstreamError("ovpf_bluesky", "délai dépassé");
    };
    expect(await isolate().island("volcan:ovpf", 10 * 60, silent)).toMatchObject({ value: "billets", stale: true, source: "ovpf_bluesky" });
    expect(tries).toBe(1);
    // Another isolate, another data center: the failure is in KV, the source is not asked.
    clock.t += 2 * 60_000;
    expect(await isolate().island("volcan:ovpf", 10 * 60, silent)).toMatchObject({ value: "billets", stale: true, source: "ovpf_bluesky" });
    expect(tries).toBe(1);
    // The breaker closed: asked again.
    clock.t += 10 * 60_000;
    await isolate().island("volcan:ovpf", 10 * 60, silent);
    expect(tries).toBe(2);
  });

  it("is `get` where the cache has no durable store of its own (Node)", async () => {
    const store = new MemoryStore();
    const cache = new Cache(store, () => T0);
    await cache.island("avis-eau:flux", 15 * 60, async () => ["avis"]);
    expect((await store.get("avis-eau:flux"))?.value).toEqual(["avis"]);
  });

  it("counts, in the budget's registry, their KV read and write for the entries that read them", () => {
    const ids = new Set(REGISTRY.map((e) => e.id));
    for (const id of Object.keys(ISLAND_READS)) expect(ids.has(id), id).toBe(true);
    expect(REGISTRY.find((e) => e.id === "/feux")?.run).toMatchObject({ kvReads: 1, kvWrites: 1 });
  });

  it("takes, of the same copy in two stores, the one that says a failed refresh", async () => {
    const copy: CacheEntry = { value: "liste", fetchedAt: T0 };
    const [fast, slow] = [new MemoryStore(), new MemoryStore()];
    await fast.put("k", copy);
    await slow.put("k", { ...copy, echec: { at: T0 + 60_000, source: "prefecture_communiques" } });
    expect((await new TieredStore(fast, slow).get("k"))?.echec?.source).toBe("prefecture_communiques");
  });
});
