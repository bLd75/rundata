import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKER_FREE_LIMIT, count, counted, left } from "../src/budget.js";
import { Cache, MemoryStore, TieredStore, type CacheEntry } from "../src/cache.js";
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

/** A Worker isolate: memory, the data center's cache, and the KV shared with the others. */
const isolate = (kv = new MemoryStore()) =>
  new Cache(new TieredStore(new MemoryStore(), new EdgeLike()), () => NOW.getTime(), false, kv);

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
    ["prevision_meteo, Cilaos demain", (c: Cache) => previsionMeteo(c, "Cilaos", "demain", NOW), WORKER_FREE_LIMIT],
    ["prevision_meteo, tour of the island", (c: Cache) => previsionMeteo(c, undefined, undefined, NOW), WORKER_FREE_LIMIT],
  ])("%s stays within the limit", async (_, ask, most) => {
    const { value, used } = await counted(WORKER_FREE_LIMIT, () => ask(isolate()));
    expect(value.isError).toBeFalsy();
    expect(used).toBeLessThanOrEqual(most);
  });

  it("forecasts from AROME cold, with as many grids as the invocation allows", async () => {
    const { value, used } = await counted(WORKER_FREE_LIMIT, () => previsionMeteo(isolate(), "Cilaos", "demain", NOW));
    expect(body(value).resume).toMatch(/^PRÉVISION \(modèle AROME/);
    expect(coverages.length).toBeGreaterThan(10);
    expect(used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
  });

  it("asks nothing again of a warm isolate", async () => {
    const c = isolate();
    await counted(WORKER_FREE_LIMIT, () => meteoActuelle(c, "Cilaos", NOW));
    const { used } = await counted(WORKER_FREE_LIMIT, () => meteoActuelle(c, "Saint-Pierre", NOW));
    expect(used).toBe(0);
  });
});

describe("scheduled AROME prefetch", () => {
  it("fills the run in a few invocations, after which a question in another data center downloads no grid", async () => {
    const kv = new MemoryStore();
    let runs = 0;
    for (;;) {
      runs++;
      const { value, used } = await counted(WORKER_FREE_LIMIT, () => prefetchForecasts(isolate(kv), NOW));
      expect(used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
      if (!value?.later) break;
      expect(runs).toBeLessThan(5);
    }
    const prefetched = coverages.length;
    expect(prefetched).toBeGreaterThan(60); // 14 steps of 5 fields left in the run, and the terrain
    const r = await counted(WORKER_FREE_LIMIT, () => previsionMeteo(isolate(kv), "Cilaos", "demain", NOW));
    expect(coverages.length).toBe(prefetched);
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
    const { value, used } = await counted(WORKER_FREE_LIMIT, () => ask(isolate()));
    expect(value.isError).toBeFalsy();
    expect(used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
  });

  it("is filled by the prefetch from both runs, after which a question downloads nothing", async () => {
    const kv = new MemoryStore();
    for (let runs = 1; ; runs++) {
      const { value, used } = await counted(WORKER_FREE_LIMIT, () => prefetchForecasts(isolate(kv), NOW));
      expect(used).toBeLessThanOrEqual(WORKER_FREE_LIMIT);
      if (!value?.later) break;
      expect(runs).toBeLessThan(6);
    }
    const prefetched = coverages.length;
    const r = await counted(WORKER_FREE_LIMIT, () => previsionMeteo(isolate(kv), "Cilaos", "demain", NOW));
    expect(coverages.length).toBe(prefetched);
    const res = body(r.value);
    expect(res.resume).toMatch(/calcul de 22\/10 04:00, et de 21\/10 22:00 pour la suite/);
    expect(res.pas_de_3h.filter((s: { modele: string }) => s.modele.startsWith("AROME")).length).toBe(7);
  });
});
