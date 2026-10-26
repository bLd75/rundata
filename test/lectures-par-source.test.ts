import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { count, counted, later, readsSaid } from "../src/budget.js";
import { getText } from "../src/http.js";

// To see which source is read more often than its freshness (26/10/2026: the volcano's release read every 5 minutes
// for every 30), each log line of an invocation says how many times it read each source (worker.ts).
describe("the reads of each source in an invocation (budget.ts `countRead`, worker.ts)", () => {
  beforeEach(() => vi.stubGlobal("fetch", async () => new Response("ok")));
  afterEach(() => vi.unstubAllGlobals());

  it("counts each source's reads, those after the answer too, and not the cache's subrequests", async () => {
    const { settled } = await counted(10, async () => {
      await getText("prefecture_communiques", "https://www.reunion.gouv.fr/a", 1000);
      await getText("ipgp_ovpf_seismes", "https://ws.ipgp.fr/b", 1000);
      // A copy read from the cache, and one written: subrequests, not reads of a source.
      count(1, "read");
      count(1, true);
      later(getText("prefecture_communiques", "https://www.reunion.gouv.fr/c", 1000));
      return "fait";
    });
    const total = await settled();
    expect(total.used).toBe(5);
    expect(readsSaid(total.reads)).toBe(", lectures : prefecture_communiques 2, ipgp_ovpf_seismes 1");
  });

  it("does not count a read the budget refused", async () => {
    const { reads } = await counted(1, async () => {
      await getText("a", "https://a.example/", 1000);
      await getText("b", "https://b.example/", 1000).catch(() => undefined);
    });
    expect(Object.fromEntries(reads)).toEqual({ a: 1 });
  });

  it("says nothing without a read", () => {
    expect(readsSaid(new Map())).toBe("");
  });
});
