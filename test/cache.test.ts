import { describe, expect, it, vi } from "vitest";
import { breakerMs, Cache, MemoryStore, stampOf, TieredStore } from "../src/cache.js";
import { noteSource, withLectures } from "../src/lectures.js";
import { UpstreamError } from "../src/types.js";
import { familyOf, RENDU_REVISION, SOURCE_REVISION, sourceRevision } from "../src/web/revisions.js";

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

  it("says which source did not answer with its last copy, logs it once, and logs a read of ours that failed", async () => {
    const c = clock();
    const cache = new Cache(undefined, c.now);
    await cache.get("metar", 60, async () => "ok");
    await cache.get("page", 60, async () => "ok");
    c.advance(120);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const silent = async () => { throw new UpstreamError("metar", "HTTP 502", 502); };
    // The source's id, from its error, also within the back-off; the failure in the logs once, with the copy served.
    expect(await cache.get("metar", 60, silent)).toMatchObject({ stale: true, source: "metar" });
    expect(await cache.get("metar", 60, silent)).toMatchObject({ stale: true, source: "metar" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe(`source metar sans réponse : metar, copie du ${new Date(1_000_000).toISOString()} servie`);
    // Our read failed (the page changed shape): no source said, a line in the logs with its key.
    const r = await cache.get("page", 60, async () => { throw new Error("tableau introuvable"); });
    expect(r).toMatchObject({ stale: true });
    expect(r.source).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1][0]).toBe("lecture sans aboutir : page");
    log.mockRestore();
  });

  it("keeps the source a copy was read from, when it asked one: fresh, from the store and in a bundle", async () => {
    const c = clock();
    const store = new MemoryStore();
    const cache = new Cache(store, c.now);
    const from = (id: string) => async () => { noteSource(id); return "ok"; };
    expect(await cache.get("slot", 60, from("meteofrance"))).toMatchObject({ stale: false, from: "meteofrance" });
    // Served fresh, by this process or another one reading the store.
    expect((await cache.get("slot", 60, from("autre"))).from).toBe("meteofrance");
    expect((await new Cache(store, c.now).get("slot", 60, from("autre"))).from).toBe("meteofrance");
    const b = await cache.bundle("paquet", 60);
    expect((await b.get("horaire", 60, from("meteofrance"))).from).toBe("meteofrance");
    // Two sources asked for one entry: none said.
    const both = async () => { noteSource("metar"); noteSource("pioupiou"); return "ok"; };
    expect((await cache.get("vent", 60, both)).from).toBeUndefined();
    // A load within a load: each entry its own source.
    const outer = await cache.get("dehors", 60, async () => {
      noteSource("ovpf");
      return (await cache.get("dedans", 60, from("bgs"))).value;
    });
    expect(outer.from).toBe("ovpf");
    expect((await cache.get("dedans", 60, from("autre"))).from).toBe("bgs");
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

  it("leaves a source that failed alone for every process of the store, as long as its entry is fresh", async () => {
    const c = clock();
    const store = new MemoryStore();
    await new Cache(store, c.now).get("seismes", 600, async () => "ok");
    c.advance(700);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const silent = async () => { calls++; throw new UpstreamError("ovpf_seismes", "The operation was aborted due to timeout"); };
    expect(await new Cache(store, c.now).get("seismes", 600, silent)).toMatchObject({ value: "ok", stale: true, source: "ovpf_seismes" });
    expect(calls).toBe(1);
    // Another process, a moment later: the copy at once, the source not asked, nothing more in the logs.
    c.advance(30);
    expect(await new Cache(store, c.now).get("seismes", 600, silent)).toMatchObject({ value: "ok", stale: true, source: "ovpf_seismes" });
    c.advance(560);
    expect(await new Cache(store, c.now).get("seismes", 600, silent)).toMatchObject({ value: "ok", stale: true });
    expect(calls).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);
    // Ten minutes after the failure (its entry's freshness), asked again; back, its answer closes the breaker.
    c.advance(20);
    expect(await new Cache(store, c.now).get("seismes", 600, async () => "neuf")).toMatchObject({ value: "neuf", stale: false });
    c.advance(700);
    expect(await new Cache(store, c.now).get("seismes", 600, silent)).toMatchObject({ value: "neuf", stale: true });
    expect(calls).toBe(2);
    log.mockRestore();
  });

  it("is left alone 15 minutes at most, and at least its back-off", () => {
    expect(breakerMs(300)).toBe(300_000);
    expect(breakerMs(24 * 3600)).toBe(15 * 60_000);
    expect(breakerMs(10)).toBe(60_000);
    expect(breakerMs(60, 1800)).toBe(1_800_000);
  });

  it("serves a tool call past its time the copy of a slow source, and stores the read when it lands", async () => {
    const c = clock();
    const cache = new Cache(undefined, c.now);
    await cache.get("k", 60, async () => "vieux");
    c.advance(120);
    let landed = false;
    const slow = () => new Promise<string>((resolve) => setTimeout(() => { landed = true; resolve("neuf"); }, 150));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { value, lectures } = await withLectures(() => cache.get("k", 60, slow), 20);
    // Slow, not failed: its warning says so (fraicheur.ts).
    expect(value).toMatchObject({ value: "vieux", stale: true, tardive: true });
    expect(lectures).toMatchObject([{ key: "k", stale: true, tardive: true }]);
    expect(landed).toBe(false);
    expect(log.mock.calls[0][0]).toMatch(/^lecture trop lente pour la réponse : k, copie du /);
    log.mockRestore();
    await new Promise((r) => setTimeout(r, 200));
    expect(landed).toBe(true);
    expect(await cache.get("k", 60, async () => "autre")).toMatchObject({ value: "neuf", stale: false });
  });

  it("says a slow source whose last read failed as not answering, not as slow", async () => {
    const c = clock();
    const cache = new Cache(undefined, c.now);
    await cache.get("k", 60, async () => "vieux");
    c.advance(120);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await cache.get("k", 60, async () => { throw new UpstreamError("ipgp", "délai dépassé"); });
    // Past the breaker and the backoff: asked again, slow again.
    c.advance(3600);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const slow = () => new Promise<string>((resolve) => setTimeout(() => resolve("neuf"), 100));
    const { value } = await withLectures(() => cache.get("k", 60, slow), 10);
    expect(value).toMatchObject({ value: "vieux", stale: true, source: "ipgp" });
    expect(value).not.toHaveProperty("tardive");
    log.mockRestore();
    vi.restoreAllMocks();
    await new Promise((r) => setTimeout(r, 150));
  });

  it("waits for the vigilance and the cyclones, even past a tool call's time", async () => {
    const c = clock();
    const cache = new Cache(undefined, c.now);
    const slow = (v: string) => () => new Promise<string>((resolve) => setTimeout(() => resolve(v), 60));
    for (const key of ["vigilance", "cyclones:liste", "cyclones:avis:1:2"]) {
      await cache.get(key, 60, async () => "vieux");
      c.advance(120);
      const { value, lectures } = await withLectures(() => cache.get(key, 60, slow("neuf")), 10);
      expect(value, key).toMatchObject({ value: "neuf", stale: false });
      expect(lectures, key).toMatchObject([{ key, stale: false }]);
    }
  });

  it("waits for a slow source it has no copy of, and outside a tool call that set a time", async () => {
    const c = clock();
    const cache = new Cache(undefined, c.now);
    const slow = (v: string) => () => new Promise<string>((resolve) => setTimeout(() => resolve(v), 60));
    expect((await withLectures(() => cache.get("rien", 60, slow("premier")), 10)).value).toMatchObject({ value: "premier", stale: false });
    c.advance(120);
    expect(await cache.get("rien", 60, slow("second"))).toMatchObject({ value: "second", stale: false });
    c.advance(120);
    expect((await withLectures(() => cache.get("rien", 60, slow("troisieme")))).value).toMatchObject({ value: "troisieme", stale: false });
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


// A family missing from web/revisions.ts: its copy is stamped with the version of the code, and built again after every
// deploy, as all were before #272.
describe("a page's copy of a family without revision, after a deploy", () => {
  it("is written with the version that built it, a source's entry without", async () => {
    const store = new MemoryStore();
    const cache = new Cache(store, undefined, false, undefined, "2.0.0");
    await cache.get("web:essai", 300, async () => "liste");
    await cache.get("agenda:petite_ile", 300, async () => "lue");
    expect((await store.get("web:essai"))!.version).toBe("2.0.0");
    expect((await store.get("agenda:petite_ile"))!.version).toBeUndefined();
  });

  it("is built again at its first view when another version built it, however fresh", async () => {
    const c = clock();
    const store = new MemoryStore();
    await new Cache(store, c.now, false, undefined, "1.0.0").get("web:essai", 300, async () => "ancienne");
    // A source's entry is the source's, whatever the code: kept.
    await new Cache(store, c.now, false, undefined, "1.0.0").get("agenda:petite_ile", 300, async () => "lue");
    c.advance(10);
    const cache = new Cache(store, c.now, false, undefined, "2.0.0");
    let builds = 0;
    expect((await cache.get("web:essai", 300, async () => (builds++, "nouvelle"))).value).toBe("nouvelle");
    expect((await cache.get("web:essai", 300, async () => (builds++, "encore"))).value).toBe("nouvelle");
    expect(builds).toBe(1);
    expect((await cache.get("agenda:petite_ile", 300, async () => "relue")).value).toBe("lue");
  });

  it("stays the copy served when its build fails", async () => {
    const c = clock();
    const store = new MemoryStore();
    await new Cache(store, c.now, false, undefined, "1.0.0").get("web:essai", 300, async () => "ancienne");
    const cache = new Cache(store, c.now, false, undefined, "2.0.0");
    expect(await cache.get("web:essai", 300, async () => { throw new Error("source muette"); })).toMatchObject({ value: "ancienne", stale: true });
  });

  it("is said to be of another version by peek, and built again by getFrom from it", async () => {
    const c = clock();
    const store = new MemoryStore();
    await new Cache(store, c.now, false, undefined, "1.0.0").get("web:essai:saint-pierre", 300, async () => "ancienne");
    const cache = new Cache(store, c.now, false, undefined, "2.0.0");
    const seen = await cache.peek<string>("web:essai:saint-pierre");
    expect(seen!.outdated).toBe(true);
    // As web/data.ts `snapshot` asks: any copy of the last 24 hours will do, but not this one.
    expect((await cache.getFrom("web:essai:saint-pierre", seen, 24 * 3600, async () => "nouvelle")).value).toBe("nouvelle");
    expect((await cache.peek("web:essai:saint-pierre"))!.outdated).toBeUndefined();
  });

  it("written before the versions were kept, is built again once", async () => {
    const store = new MemoryStore();
    const cache = new Cache(store, undefined, false, undefined, "2.0.0");
    await store.put("web:essai", { value: "sans version", fetchedAt: Date.now() });
    expect((await cache.peek("web:essai"))!.outdated).toBe(true);
    expect((await cache.get("web:essai", 300, async () => "avec")).value).toBe("avec");
    expect((await store.get("web:essai"))!.version).toBe("2.0.0");
  });

  it("is never said outdated where the code has no version (Node, tests), whatever its family", async () => {
    const store = new MemoryStore();
    await store.put("web:essai", { value: 1, fetchedAt: Date.now(), version: "1.0.0" });
    await store.put("web:air", { value: 1, fetchedAt: Date.now(), version: "rendu-0" });
    const cache = new Cache(store);
    for (const key of ["web:essai", "web:air"]) {
      expect((await cache.peek(key))!.outdated).toBeUndefined();
      expect((await cache.get(key, 300, async () => 2)).value).toBe(1);
    }
  });
});

describe("a page's copy kept across the deploys that leave its family's revision", () => {
  it("is stamped with its family's revision, whatever the version, a source's entry and a family without one otherwise", async () => {
    const store = new MemoryStore();
    const cache = new Cache(store, undefined, false, undefined, "2.0.0");
    await cache.get("web:lieu:le-port", 300, async () => "copie");
    await cache.get("web:essai", 300, async () => "copie");
    await cache.get("agenda:petite_ile", 300, async () => "lue");
    expect((await store.get("web:lieu:le-port"))!.version).toBe(`rendu-${RENDU_REVISION.lieu}`);
    expect((await store.get("web:essai"))!.version).toBe("2.0.0");
    expect((await store.get("agenda:petite_ile"))!.version).toBeUndefined();
    expect(stampOf("web:lieu:le-port", "2.0.0")).toBe(stampOf("web:lieu:le-port", "1.0.0"));
  });

  it("is served across a deploy that leaves its revision, and built again only after one that raises it", async () => {
    const c = clock();
    const store = new MemoryStore();
    await new Cache(store, c.now, false, undefined, "1.0.0").get("web:lieu:le-port", 300, async () => "ancienne");
    c.advance(10);
    let builds = 0;
    const next = new Cache(store, c.now, false, undefined, "2.0.0");
    expect((await next.peek("web:lieu:le-port"))!.outdated).toBeUndefined();
    expect((await next.get("web:lieu:le-port", 300, async () => (builds++, "nouvelle"))).value).toBe("ancienne");
    expect(builds).toBe(0);
    // The deploy before the one that raised the family's revision: its copies say the revision before.
    await store.put("web:lieu:le-port", { value: "avant", fetchedAt: c.now(), version: `rendu-${RENDU_REVISION.lieu - 1}` });
    expect((await next.peek("web:lieu:le-port"))!.outdated).toBe(true);
    expect((await next.get("web:lieu:le-port", 300, async () => (builds++, "nouvelle"))).value).toBe("nouvelle");
    expect(builds).toBe(1);
  });

  it("names its family by the first part of its key", () => {
    expect(familyOf("web:lieu:le-port")).toBe("lieu");
    expect(familyOf("web:volcan")).toBe("volcan");
    expect(familyOf("web:randonnees:cap-noir")).toBe("randonnees");
  });
});

// The news feed's entry, read by the old code a few minutes before a deploy that changed one of its links, made the
// page built again after it show the old links until its next turn (26/10/2026, Freedom's).
describe("a source's entry listed in SOURCE_REVISION, after a deploy", () => {
  const fil = "actualites:fil";
  const n = SOURCE_REVISION[fil];

  it("is stamped with its source's revision, whatever the version; a source not listed is not stamped", async () => {
    const store = new MemoryStore();
    const cache = new Cache(store, undefined, false, undefined, "2.0.0");
    await cache.get(fil, 300, async () => "lu");
    await cache.get("agenda:petite_ile", 300, async () => "lue");
    expect((await store.get(fil))!.version).toBe(`source-${n}`);
    expect((await store.get("agenda:petite_ile"))!.version).toBeUndefined();
    expect(stampOf(fil, "2.0.0")).toBe(stampOf(fil, "1.0.0"));
    expect(stampOf(fil, undefined)).toBeUndefined();
  });

  it("is named by its key, or by the first part of its key", () => {
    expect(sourceRevision(fil)).toBe(n);
    expect(sourceRevision("actualites:autre")).toBeUndefined();
    expect(sourceRevision("agenda:petite_ile")).toBeUndefined();
  });

  it("is kept across a deploy that leaves its number, and read again at its first ask after one that raises it, once", async () => {
    const c = clock();
    const store = new MemoryStore();
    await new Cache(store, c.now, false, undefined, "1.0.0").get(fil, 300, async () => "ancien");
    await new Cache(store, c.now, false, undefined, "1.0.0").get("agenda:petite_ile", 300, async () => "lue");
    c.advance(10);
    let reads = 0;
    const next = new Cache(store, c.now, false, undefined, "2.0.0");
    expect((await next.get(fil, 300, async () => (reads++, "nouveau"))).value).toBe("ancien");
    expect(reads).toBe(0);
    // Read by the code before the one that raised the number.
    await store.put(fil, { value: "avant", fetchedAt: c.now(), version: `source-${n - 1}` });
    expect((await next.peek(fil))!.outdated).toBe(true);
    expect((await next.get(fil, 300, async () => (reads++, "nouveau"))).value).toBe("nouveau");
    expect((await next.get(fil, 300, async () => (reads++, "encore"))).value).toBe("nouveau");
    expect(reads).toBe(1);
    // A source not listed: its entry, however written, is kept.
    expect((await next.get("agenda:petite_ile", 300, async () => (reads++, "relue"))).value).toBe("lue");
    expect(reads).toBe(1);
  });

  it("stays the entry served, dated, when its source does not answer: never nothing", async () => {
    const c = clock();
    const store = new MemoryStore();
    await store.put(fil, { value: "avant", fetchedAt: c.now(), version: `source-${n - 1}` });
    c.advance(10);
    const cache = new Cache(store, c.now, false, undefined, "2.0.0");
    const silent = async (): Promise<string> => {
      throw new UpstreamError("medias_locaux", "pas de réponse");
    };
    expect(await cache.get(fil, 300, silent)).toMatchObject({ value: "avant", stale: true });
    // Asked again within the breaker: the same copy, not an error.
    expect(await cache.get(fil, 300, silent)).toMatchObject({ value: "avant", stale: true });
    expect(await new Cache(store, c.now, false, undefined, "2.0.0").get(fil, 300, async () => { throw new Error("page changée"); })).toMatchObject({ value: "avant", stale: true });
  });
});

