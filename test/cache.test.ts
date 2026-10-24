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

  it("remembers a failure as long as the source asks, but not one of the invocation's budget", async () => {
    const c = clock();
    const cache = new Cache(undefined, c.now);
    let calls = 0;
    const down = async () => {
      calls++;
      throw new Error("HTTP 502");
    };
    await expect(cache.get("slow", 60, down, 1800)).rejects.toThrow("502");
    c.advance(1799);
    await expect(cache.get("slow", 60, down, 1800)).rejects.toThrow("502");
    expect(calls).toBe(1);
    c.advance(2);
    await expect(cache.get("slow", 60, down, 1800)).rejects.toThrow("502");
    expect(calls).toBe(2);

    const limit = async () => {
      calls++;
      throw new Error("Too many subrequests by single Worker invocation");
    };
    await expect(cache.get("other", 60, limit, 1800)).rejects.toThrow("Too many");
    expect((await cache.get("other", 60, async () => "ok", 1800)).value).toBe("ok");
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

describe("peek with a freshness", () => {
  /** A slower store that counts how often it is asked. */
  class Slow extends MemoryStore {
    asked = 0;
    async get(key: string) {
      this.asked++;
      return super.get(key);
    }
  }

  it("is answered from memory when its copy is that fresh, and asks the slower store otherwise", async () => {
    const c = clock();
    const slow = new Slow();
    const cache = new Cache(new TieredStore(new MemoryStore(), slow), c.now);
    await cache.get("k", 300, async () => 1);
    slow.asked = 0;
    expect((await cache.peek("k", c.now() - 300_000))!.value).toBe(1);
    expect(slow.asked).toBe(0);
    // Without a freshness, as before: every store, for the newest copy.
    await cache.peek("k");
    expect(slow.asked).toBe(1);
    // Older than asked: the slower store too, which may have a newer one.
    c.advance(301);
    await slow.put("k", { value: 2, fetchedAt: c.now() });
    expect((await cache.peek("k", c.now() - 300_000))!.value).toBe(2);
  });

  it("then lets getFrom refresh that copy without reading the stores again", async () => {
    const c = clock();
    const slow = new Slow();
    const cache = new Cache(new TieredStore(new MemoryStore(), slow), c.now);
    await cache.get("k", 300, async () => 1);
    c.advance(400);
    const seen = await cache.peek<number>("k", c.now() - 300_000);
    slow.asked = 0;
    expect((await cache.getFrom("k", seen, 3600, async () => 2)).value).toBe(1);
    expect((await cache.getFrom("k", seen, 300, async () => 2)).value).toBe(2);
    expect(slow.asked).toBe(0);
  });
});

