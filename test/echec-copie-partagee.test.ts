import { describe, expect, it } from "vitest";
import { Cache, type CacheEntry, MemoryStore, TieredStore } from "../src/cache.js";
import { KEY as SEISMES } from "../src/providers/seismes.js";
import { UpstreamError } from "../src/types.js";
import { type Kv, kvKey, SharedFallback } from "../src/web/partagees.js";

/** A KV namespace in memory, counting its reads by key. */
class FakeKv implements Kv {
  data = new Map<string, string>();
  reads = new Map<string, number>();
  async get(key: string) {
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
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

/** A data center's cache as the Worker builds it (worker.ts), each its own: memory, then its cache with KV behind. */
const center = (kv: Kv, clock: { t: number }) =>
  new Cache(new TieredStore(new MemoryStore(), new SharedFallback(new MemoryStore(), kv, () => clock.t)), () => clock.t, false);

const T0 = Date.parse("2026-10-26T17:00:00Z");
const FRESH = 10 * 60; // providers/seismes.ts

// A shared copy's failed refresh is kept in KV (web/partagees.ts SharedFallback): every data center leaves a silent
// source alone until its breaker closes (26/10/2026: the IPGP's catalogue silent from 18:56, asked 15 times in 50
// minutes by the scheduled events and each data center's readers).
describe("a shared copy whose source does not answer (web/partagees.ts `SharedFallback`)", () => {
  const copy = (at: number): CacheEntry => ({ value: [{ magnitude: 1.2 }], fetchedAt: at });

  it("is asked once for every data center until its breaker closes, the last copy served", async () => {
    const kv = new FakeKv();
    const clock = { t: T0 };
    await kv.put(kvKey(SEISMES), JSON.stringify(copy(T0 - 2 * 3600_000)));
    let tries = 0;
    const silent = async () => {
      tries++;
      throw new UpstreamError("ipgp_ovpf_seismes", "délai dépassé");
    };
    const first = await center(kv, clock).get(SEISMES, FRESH, silent);
    expect(first).toMatchObject({ stale: true, source: "ipgp_ovpf_seismes", fetchedAt: new Date(T0 - 2 * 3600_000) });
    expect(tries).toBe(1);
    // Another data center, two minutes later: the failure is in KV, the source is not asked.
    clock.t += 2 * 60_000;
    expect(await center(kv, clock).get(SEISMES, FRESH, silent)).toMatchObject({ stale: true, source: "ipgp_ovpf_seismes" });
    expect(tries).toBe(1);
    // Its breaker closed: asked again.
    clock.t += 10 * 60_000;
    await center(kv, clock).get(SEISMES, FRESH, silent);
    expect(tries).toBe(2);
  });

  it("reads the failure only for a copy late for its refresh", async () => {
    const kv = new FakeKv();
    const clock = { t: T0 };
    // Written by the scheduled event 11 minutes ago, every 10: due, not late.
    await kv.put(kvKey(SEISMES), JSON.stringify(copy(T0 - 11 * 60_000)));
    await center(kv, clock).get(SEISMES, FRESH, async () => [{ magnitude: 2 }]);
    expect(kv.reads.get(`copie-echec:${SEISMES}`)).toBeUndefined();
  });

  it("forgets a failure older than the copy: the source answered since", async () => {
    const kv = new FakeKv();
    const clock = { t: T0 };
    await kv.put(kvKey(SEISMES), JSON.stringify(copy(T0 - 2 * 3600_000)));
    await kv.put(`copie-echec:${SEISMES}`, JSON.stringify({ at: T0 - 3 * 3600_000, source: "ipgp_ovpf_seismes" }));
    let tries = 0;
    const got = await center(kv, clock).get(SEISMES, FRESH, async () => (tries++, [{ magnitude: 2 }]));
    expect(tries).toBe(1);
    expect(got).toMatchObject({ stale: false, value: [{ magnitude: 2 }] });
  });

  it("writes no failure for a copy that is not shared", async () => {
    const kv = new FakeKv();
    await center(kv, { t: T0 }).get("volcan:pitonlive", FRESH, async () => {
      throw new UpstreamError("pitonlive", "délai dépassé");
    }).catch(() => undefined);
    expect([...kv.data.keys()]).toEqual([]);
  });
});
