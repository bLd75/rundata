import { describe, expect, it } from "vitest";
import { count, counted, measured } from "../src/budget.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { site } from "../src/web/site.js";

// In a file of its own: what the builds took is remembered per process (budget.ts), and here no build has run yet,
// as in a new isolate.
const NOW = new Date("2026-10-24T06:00:00Z");

describe("what a page's build took, kept with its copy", () => {
  it("is written with the copy of a measured build, and read back by peek; a source's copy has none", async () => {
    const cache = new Cache(new MemoryStore(), () => NOW.getTime());
    await counted(40, () => cache.get("web:essai-cout", 300, () => measured("web:essai-cout", async () => (count(3), { n: 1 }))));
    await counted(40, () => cache.get("source-essai", 300, async () => (count(2), { n: 1 })));
    expect((await cache.peek("web:essai-cout"))!.cost).toBe(3);
    expect(await cache.peek("source-essai")).not.toHaveProperty("cost");
  });

  it("lets a new isolate bring an old tile up to date when what it took fits, not only when 25 are left", async () => {
    // A commune's feed reads three copies and brings the oldest up to date after the response.
    const feed = async (cost?: number) => {
      const store = new MemoryStore();
      const old = NOW.getTime() - 3600_000;
      for (const key of ["web:coupures", "web:randonnees", "web:volcan"]) await store.put(key, { value: {}, fetchedAt: old, ...(cost != null && { cost }) });
      const cache = new Cache(store, () => NOW.getTime());
      const pending: Promise<unknown>[] = [];
      // An invocation with 12 subrequests left besides the writes: under 25, over what these builds took.
      // The copies here are empty, so the feed itself fails: only what was started before it counts.
      await counted(16, () => site(new Request("https://rundata.re/communes/saint-paul.rss"), cache, (p) => pending.push(p.catch(() => undefined)), NOW).catch(() => null));
      return pending.length;
    };
    expect(await feed()).toBe(0);
    expect(await feed(4)).toBe(1);
  });
});
