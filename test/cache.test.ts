import { describe, expect, it } from "vitest";
import { Cache, MemoryStore, TieredStore } from "../src/cache.js";

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (s: number) => (t += s * 1000) };
}

describe("Cache", () => {
  it("calls the source once per freshness window, whatever the number of questions", async () => {
    const c = clock();
    const cache = new Cache(undefined, c.now);
    let calls = 0;
    const load = async () => ++calls;
    await Promise.all([cache.get("k", 300, load), cache.get("k", 300, load), cache.get("k", 300, load)]);
    expect(calls).toBe(1);
    c.advance(299);
    expect((await cache.get("k", 300, load)).value).toBe(1);
    c.advance(2);
    expect((await cache.get("k", 300, load)).value).toBe(2);
  });

  it("serves the last good copy when the source fails, and backs off", async () => {
    const c = clock();
    const cache = new Cache(undefined, c.now);
    let calls = 0;
    await cache.get("k", 60, async () => "ok");
    c.advance(120);
    const failing = async () => {
      calls++;
      throw new Error("down");
    };
    expect(await cache.get("k", 60, failing)).toMatchObject({ value: "ok", stale: true });
    expect(await cache.get("k", 60, failing)).toMatchObject({ value: "ok", stale: true });
    expect(calls).toBe(1); // second question within the back-off did not hit the source
  });

  it("throws when the source fails and nothing is cached", async () => {
    const cache = new Cache();
    await expect(cache.get("k", 60, async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
  });

  it("can skip sharing in-flight requests (Worker)", async () => {
    const cache = new Cache(undefined, Date.now, false);
    let calls = 0;
    const load = async () => ++calls;
    await Promise.all([cache.get("k", 300, load), cache.get("k", 300, load)]);
    expect(calls).toBe(2);
  });
});

describe("TieredStore", () => {
  it("returns the newest entry of its stores and writes to all of them", async () => {
    const memory = new MemoryStore();
    const edge = new MemoryStore();
    const store = new TieredStore(memory, edge);
    await memory.put("k", { value: "old", fetchedAt: 1 });
    await edge.put("k", { value: "new", fetchedAt: 2 }); // another isolate refreshed the edge
    expect(await store.get("k")).toEqual({ value: "new", fetchedAt: 2 });
    await store.put("j", { value: 1, fetchedAt: 3 });
    expect(await memory.get("j")).toBeDefined();
    expect(await edge.get("j")).toBeDefined();
  });
});
