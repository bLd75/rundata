import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKER_BUDGET, WORKER_FREE_LIMIT, costOf, count, counted, later, left, measured } from "../src/budget.js";
import { Cache, MemoryStore, TieredStore, type CacheEntry } from "../src/cache.js";
import { KvStore, type KvBinding } from "../src/kv.js";
import * as arome from "../src/providers/arome.js";
import { configure } from "../src/providers/mf-auth.js";
import { temperatureMer } from "../src/tools/mer.js";
import { meteoActuelle } from "../src/tools/meteo.js";
import { prefetchForecasts, previsionMeteo } from "../src/tools/prevision.js";

// What a Worker counts: every fetch and every read or write of the data center's cache; KV has its own limit.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const NOW = new Date("2026-10-22T06:00:00Z");
const RUN = "2026-10-21T18.00.00Z";
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

function overLimit() {
  if (left() < 0) throw new Error("Too many subrequests by single Worker invocation");
}

class EdgeLike extends MemoryStore {
  async get(key: string) {
    count();
    overLimit();
    return super.get(key);
  }
  async put(key: string, entry: CacheEntry) {
    count();
    overLimit();
    return super.put(key, entry);
  }
}

/** The KV namespace shared by every data center, with what was asked of it. */
class Namespace implements KvBinding {
  values = new Map<string, string>();
  reads = 0;
  writes = 0;
  async get(key: string) {
    this.reads++;
    const v = this.values.get(key);
    return v === undefined ? null : JSON.parse(v);
  }
  async put(key: string, value: string) {
    this.writes++;
    this.values.set(key, value);
  }
}

/** A Worker isolate: memory, the data center's cache, and the KV shared with the others, read as the Worker does. */
const isolate = (kv: KvBinding = new Namespace()) =>
  new Cache(new TieredStore(new MemoryStore(), new EdgeLike()), () => NOW.getTime(), false, new KvStore(kv));

let coverages: string[];

function upstream(url: string): Response {
  if (url.includes("/token")) return Response.json({ access_token: "t", expires_in: 3600 });
  if (url.includes("DPPaquetObs")) return new Response(fixture("meteofrance_6min.csv"));
  if (url.includes("DPRadar")) return new Response(fixture("radar_lame_eau.h5"));
  if (url.includes("aviationweather")) return new Response(fixture("metar.json"));
  if (url.endsWith("/live/all")) return new Response(fixture("pioupiou_all.json"));
  if (url.includes("pioupiou")) return Response.json({ data: JSON.parse(String(fixture("pioupiou_all.json"))).data[0] });
  if (url.includes("noaacwLEOACSPO")) return new Response(fixture("acspo.csv"));
  if (url.includes("erdMH1sstd1day")) return new Response(fixture("modis.csv"));
  if (url.includes("marine-api.open-meteo")) return new Response(fixture("openmeteo_houle.json"));
  if (url.includes("air-quality-api.open-meteo")) return new Response(fixture("cams_uv.json"));
  if (url.includes("open-meteo.com/data")) return new Response(fixture("openmeteo_meta.json"));
  if (url.includes("open-meteo")) return new Response(fixture("openmeteo_cilaos.json"));
  if (url.includes("GetCapabilities")) return new Response(`<x>TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___${RUN}</x>`);
  if (url.includes("GetCoverage")) {
    coverages.push(url);
    const tif = url.includes("PRESSURE__GROUND") ? "ps" : url.includes("MEAN_SEA_LEVEL") ? "pmsl" : "t2m";
    return new Response(fixture(`arome/${tif}.tif`));
  }
  throw new Error(`unexpected ${url}`);
}

beforeEach(() => {
  coverages = [];
  configure({ applicationId: "test" });
  vi.stubGlobal("fetch", async (url: string) => {
    overLimit();
    return upstream(String(url));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  configure({});
});

describe("subrequests of a cold question in the Worker", () => {
  it.each([
    // The stations and the radar image, each read and written in the data center's cache.
    ["meteo_actuelle, Cilaos", (c: Cache) => meteoActuelle(c, "Cilaos", NOW), 30],
    ["meteo_actuelle, tour of the island", (c: Cache) => meteoActuelle(c, undefined, NOW), 25],
    ["temperature_mer, Saint-Leu", (c: Cache) => temperatureMer(c, "Saint-Leu", NOW), 10],
    ["prevision_meteo, Cilaos demain", (c: Cache) => previsionMeteo(c, "Cilaos", "demain", NOW), WORKER_BUDGET],
    ["prevision_meteo, tour of the island", (c: Cache) => previsionMeteo(c, undefined, undefined, NOW), WORKER_BUDGET],
  ])("%s stays within the limit", async (_, ask, most) => {
    const { value, used } = await counted(WORKER_BUDGET, () => ask(isolate()));
    expect(value.isError).toBeFalsy();
    expect(used).toBeLessThanOrEqual(most);
  });

  it("forecasts cold from the ECMWF model, labelled, when no AROME grid is stored yet: the grids are the scheduled event's", async () => {
    // Under the budget, the stations' share and the reserve for the ECMWF and the UV leave too few subrequests for
    // one step of five grids: none is downloaded. The prefetch below fills them, after which questions are on AROME.
    const { value, used } = await counted(WORKER_BUDGET, () => previsionMeteo(isolate(), "Cilaos", "demain", NOW));
    expect(value.isError).toBeFalsy();
    // It says why: AROME is up, its grids not loaded yet.
    expect(body(value).resume).toMatch(/^PRÉVISION \(prévision AROME pas encore chargée, modèle IFS HRES du Centre européen \(ECMWF\), maille de 9 km, pas une mesure\)/);
    expect(coverages.length).toBe(0);
    expect(used).toBeLessThanOrEqual(WORKER_BUDGET);
    // The tour of the island says it too.
    const tour = await counted(WORKER_BUDGET, () => previsionMeteo(isolate(), undefined, undefined, NOW));
    expect(body(tour.value).resume).toMatch(/^PRÉVISION \(prévision AROME pas encore chargée, modèle IFS/);
  });

  it("does not say AROME is coming when it is not plugged in, nor beyond its 48 hours", async () => {
    configure({});
    const off = await counted(WORKER_BUDGET, () => previsionMeteo(isolate(), "Cilaos", "demain", NOW));
    expect(body(off.value).resume).toMatch(/^PRÉVISION \(modèle IFS HRES/);
    configure({ applicationId: "test" });
    const far = await counted(WORKER_BUDGET, () => previsionMeteo(isolate(), "Cilaos", "dans 5 jours", NOW));
    expect(body(far.value).resume).not.toContain("AROME pas encore chargée");
  });

  it("forecasts from AROME cold under the platform's own limit, not the budget: the grids' code, as many as allowed", async () => {
    // The only case measured at WORKER_FREE_LIMIT: what an invocation could fetch if the budget were the platform's.
    const { value, used } = await counted(WORKER_FREE_LIMIT, () => previsionMeteo(isolate(), "Cilaos", "demain", NOW));
    expect(body(value).resume).toMatch(/^PRÉVISION \(modèle AROME/);
    expect(coverages.length).toBeGreaterThan(10);
    expect(used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
  });

  it("asks nothing again of a warm isolate", async () => {
    const c = isolate();
    await counted(WORKER_BUDGET, () => meteoActuelle(c, "Cilaos", NOW));
    const { used } = await counted(WORKER_BUDGET, () => meteoActuelle(c, "Saint-Pierre", NOW));
    expect(used).toBe(0);
  });
});

describe("scheduled AROME prefetch", () => {
  it("fills the run in a few invocations, after which a question in another data center downloads no grid", async () => {
    const kv = new Namespace();
    let runs = 0;
    for (;;) {
      runs++;
      const before = { reads: kv.reads, writes: kv.writes, grids: coverages.length };
      const { value, used } = await counted(WORKER_BUDGET, () => prefetchForecasts(isolate(kv), NOW));
      expect(used).toBeLessThanOrEqual(WORKER_BUDGET);
      // Each read and write of KV is a subrequest, counted with the grids.
      expect(kv.reads - before.reads + kv.writes - before.writes).toBeGreaterThan(0);
      expect(used).toBeGreaterThanOrEqual(kv.reads - before.reads + kv.writes - before.writes + coverages.length - before.grids);
      if (!value?.later) break;
      expect(runs).toBeLessThan(5);
    }
    const prefetched = coverages.length;
    expect(prefetched).toBeGreaterThan(60); // 14 steps of 5 fields left in the run, and the terrain
    const reads = kv.reads;
    const r = await counted(WORKER_BUDGET, () => previsionMeteo(isolate(kv), "Cilaos", "demain", NOW));
    expect(coverages.length).toBe(prefetched);
    // The question in another data center reads the bundle from KV: counted too, within the budget.
    expect(kv.reads).toBeGreaterThan(reads);
    expect(r.used).toBeGreaterThanOrEqual(kv.reads - reads);
    expect(r.used).toBeLessThanOrEqual(WORKER_BUDGET);
    expect(body(r.value).pas_de_3h.filter((s: { modele: string }) => s.modele.startsWith("AROME")).length).toBeGreaterThan(5);
  });
});

describe("packed grids", () => {
  it("keep values to the hundredth, and the missing ones", () => {
    const g = { x0: 55.2, y0: -20.85, dx: 0.025, dy: 0.025, width: 2, height: 2, values: [23.45, null, -1.5, 812.37] };
    const p = arome.pack(g);
    expect(p.data.length).toBeLessThan(20);
    const back = arome.unpack(JSON.parse(JSON.stringify(p)));
    expect(back.values[1]).toBeNull();
    back.values.forEach((v, i) => v != null && expect(v).toBeCloseTo(g.values[i]!, 1));
  });
});

describe("a run not all out yet, in the Worker", () => {
  // The newest run listed has its hours up to 23/10 03:00 UTC; the run before is complete.
  const NEWEST = "2026-10-22T00.00.00Z";
  const MISSING_FROM = Date.parse("2026-10-23T03:00:00Z");

  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string) => {
      overLimit();
      const u = decodeURIComponent(String(url));
      if (u.includes("GetCapabilities")) {
        return new Response([RUN, NEWEST].map((r) => `<x>TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___${r}</x>`).join(""));
      }
      if (u.includes("GetCoverage") && u.includes(NEWEST) && Date.parse(u.match(/time\(([^)]+)\)/)![1]) >= MISSING_FROM) {
        coverages.push(u);
        return new Response("not found", { status: 404 });
      }
      return upstream(String(url));
    });
  });

  it.each([
    ["Cilaos demain", (c: Cache) => previsionMeteo(c, "Cilaos", "demain", NOW)],
    ["tour of the island", (c: Cache) => previsionMeteo(c, undefined, undefined, NOW)],
  ])("%s cold stays within the limit", async (_, ask) => {
    const { value, used } = await counted(WORKER_BUDGET, () => ask(isolate()));
    expect(value.isError).toBeFalsy();
    expect(used).toBeLessThanOrEqual(WORKER_BUDGET);
  });

  it("is filled by the prefetch from both runs, after which a question downloads nothing", async () => {
    const kv = new Namespace();
    for (let runs = 1; ; runs++) {
      const { value, used } = await counted(WORKER_BUDGET, () => prefetchForecasts(isolate(kv), NOW));
      expect(used).toBeLessThanOrEqual(WORKER_BUDGET);
      if (!value?.later) break;
      expect(runs).toBeLessThan(6);
    }
    const prefetched = coverages.length;
    const r = await counted(WORKER_BUDGET, () => previsionMeteo(isolate(kv), "Cilaos", "demain", NOW));
    expect(coverages.length).toBe(prefetched);
    const res = body(r.value);
    expect(res.resume).toMatch(/calcul de 22\/10 04:00, et de 21\/10 22:00 pour la suite/);
    expect(res.pas_de_3h.filter((s: { modele: string }) => s.modele.startsWith("AROME")).length).toBe(7);
  });
});

describe("the invocation's budget", () => {
  it("refuses the subrequests past it, as the platform would, and says how many", async () => {
    const { settled } = await counted(3, async () => {
      count(2);
      count();
      expect(() => count()).toThrow(/Too many subrequests/);
      expect(left()).toBe(0);
    });
    expect(await settled()).toEqual({ used: 3, refused: 1 });
  });

  it("keeps a tenth of it for writing to the cache what was read", async () => {
    const { settled } = await counted(40, async () => {
      count(36);
      expect(left()).toBe(0);
      expect(() => count()).toThrow(/Too many subrequests/);
      count(4, true);
      expect(() => count(1, true)).toThrow(/Too many subrequests/);
    });
    expect(await settled()).toEqual({ used: 40, refused: 2 });
  });

  it("counts the work after the response against it", async () => {
    let done: () => void = () => {};
    const { used, settled } = await counted(5, async () => {
      count();
      later(new Promise<void>((r) => (done = r)).then(() => count(2)));
    });
    expect(used).toBe(1);
    done();
    expect((await settled()).used).toBe(3);
  });

  it("serves the last copy of what a refused subrequest was for, and does not hold it against the source", async () => {
    let t = NOW.getTime();
    const c = new Cache(new MemoryStore(), () => t);
    await c.get("x", 60, async () => "old");
    t += 120_000;
    let asked = 0;
    const load = async () => {
      count();
      asked++;
      return "new";
    };
    const refused = await counted(0, () => c.get("x", 60, load));
    expect(refused.value).toMatchObject({ value: "old", stale: true });
    // The next invocation, with subrequests left, asks the source at once.
    const next = await counted(5, () => c.get("x", 60, load));
    expect(next.value).toMatchObject({ value: "new", stale: false });
    expect(asked).toBe(1);
  });

  it("remembers what a job took, refused subrequests and work handed over included", async () => {
    const key = `job-${Math.random()}`;
    expect(costOf(key)).toBeUndefined();
    let done: () => void = () => {};
    const { settled } = await counted(4, () =>
      measured(key, async () => {
        count(2);
        later(new Promise<void>((r) => (done = r)).then(() => count(3)));
      }));
    expect(costOf(key)).toBe(2);
    done();
    await settled();
    // Two more done after it returned, one of them past the budget.
    expect(costOf(key)).toBe(5);
    // A cheaper run does not lower it: the next start waits for the most it may take.
    await counted(10, () => measured(key, async () => count()));
    expect(costOf(key)).toBe(5);
    // Outside a counted invocation nothing is measured.
    await measured(`${key}-node`, async () => count());
    expect(costOf(`${key}-node`)).toBeUndefined();
  });
});
