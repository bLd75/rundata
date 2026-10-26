import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { resolvePlace } from "../src/places/resolve.js";
import * as arome from "../src/providers/arome.js";
import * as ensemble from "../src/providers/ensemble.js";
import { configure } from "../src/providers/mf-auth.js";
import * as openmeteo from "../src/providers/openmeteo.js";
import * as uv from "../src/providers/uv.js";
import { readTiff } from "../src/tiff.js";
import { previsionMeteo } from "../src/tools/prevision.js";

// Grids recorded from the AROME outre-mer run of 21/10/2026 18:00 UTC: the step starting 22/10 08:00 UTC
// (12:00 in Réunion), and the run's first hour for the terrain height.
const tif = (f: string) => readFileSync(new URL(`./fixtures/arome/${f}.tif`, import.meta.url));
const json = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const ensIle = () => ensemble.parse(json("openmeteo_ens_ile.json"), json("openmeteo_ens_meta.json").last_run_initialisation_time * 1000);
const RUN = new Date("2026-10-21T18:00:00Z");
const STEP = new Date("2026-10-22T08:00:00Z");
const NOW = new Date("2026-10-22T06:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const H = 3600_000;

const relief = () => arome.relief(arome.parseGrid(tif("ps")), arome.parseGrid(tif("pmsl")), arome.parseGrid(tif("t2m0")));

/** The run, its terrain and the one recorded step are cached; ECMWF for Cilaos too. */
async function offlineCache(listAgeMs = 0) {
  const store = new MemoryStore();
  const at = NOW.getTime();
  const listed = at - listAgeMs;
  await store.put("arome:calculs", { value: { liste: { value: [RUN.toISOString()], fetchedAt: listed } }, fetchedAt: listed });
  const bundle: Record<string, { value: unknown; fetchedAt: number }> = { relief: { value: arome.pack(relief()), fetchedAt: at } };
  const fields: [string, string, number][] = [["temperature", "t2m", 0], ["nuages", "cloud", 1], ["rafales", "gust", 2], ["pluie", "rain3h", 3], ["foudre", "lightning3h", 3]];
  for (const [field, file, h] of fields) {
    bundle[arome.gridKey(field, new Date(STEP.getTime() + h * H))] = { value: arome.pack(arome.parseGrid(tif(file))), fetchedAt: at };
  }
  await store.put(arome.bundleKey(RUN), { value: bundle, fetchedAt: at });
  await store.put(openmeteo.cacheKey(resolvePlace("Cilaos")!.lieu), { value: json("openmeteo_cilaos.json"), fetchedAt: at });
  await store.put("openmeteo:meta", { value: json("openmeteo_meta.json"), fetchedAt: at });
  await store.put("uv:ile", { value: uv.parse(json("cams_uv.json")), fetchedAt: at });
  await store.put(ensemble.KEY, { value: ensIle(), fetchedAt: at });
  return new Cache(store, () => at);
}

afterEach(() => {
  vi.unstubAllGlobals();
  configure({});
});

const noNetwork = () => vi.stubGlobal("fetch", async () => { throw new Error("no network in tests"); });

describe("readTiff", () => {
  it("reads the WCS grid: 27 × 23 points from 55.2 E, 20.85 S, every 0.025°", () => {
    const r = readTiff(tif("t2m"));
    expect(r).toMatchObject({ width: 27, height: 23, x0: 55.2 });
    expect(r.y0).toBeCloseTo(-20.85, 6);
    expect(r.dx).toBeCloseTo(0.025, 6);
    expect(r.values).toHaveLength(27 * 23);
    const v = r.values.filter((x): x is number => x != null);
    expect(Math.min(...v)).toBeGreaterThan(10); // °C, not Kelvin
    expect(Math.max(...v)).toBeLessThan(30);
  });
});

describe("relief", () => {
  it("finds the island's mountains from the pressure fields", () => {
    const z = relief();
    const max = Math.max(...z.values.map((v) => v ?? 0));
    expect(max).toBeGreaterThan(2000);
    expect(max).toBeLessThan(3100);
    expect(z.values[0]).toBeLessThan(20); // north-west corner, at sea
  });
});

describe("newestRun", () => {
  it("takes the latest run listed", () => {
    const caps = ["2026-10-21T12.00.00Z", "2026-10-21T18.00.00Z", "2026-10-21T06.00.00Z"]
      .map((r) => `<wcs:CoverageId>TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___${r}</wcs:CoverageId>`).join("");
    expect(arome.newestRun(caps)?.toISOString()).toBe("2026-10-21T18:00:00.000Z");
  });
});

describe("weatherCode", () => {
  it.each([
    [0, 10, 0, 0], [0, 90, 0, 3], [1, 90, 0, 61], [5, 90, 0, 63], [20, 100, 0, 65], [5, 90, 1, 95], [null, null, null, null],
  ])("rain %s mm, cloud %s %%, lightning %s → %s", (rain, cloud, lightning, code) => {
    expect(arome.weatherCode(rain, cloud, lightning)).toBe(code);
  });
});

describe("prevision_meteo with AROME", () => {
  it("answers this afternoon in Cilaos from AROME, ECMWF taking over the step not loaded", async () => {
    configure({ token: "test" });
    noNetwork();
    const r = body(await previsionMeteo(await offlineCache(), "Cilaos", "cet après-midi", NOW));
    expect(r.nature).toBe("prevision");
    expect(r.resume).toMatch(/^PRÉVISION \(modèle AROME outre-mer de Météo-France, maille de 2,5 km, calcul de 21\/10 22:00, relayé ensuite par IFS/);
    expect(r.pas_de_3h.map((s: { heures: string; modele: string }) => [s.heures, s.modele])).toEqual([
      ["jeudi 22/10 12h–15h", "AROME outre-mer de Météo-France"],
      ["jeudi 22/10 15h–18h", "IFS HRES du Centre européen (ECMWF)"],
    ]);
    // Brought down from the model's terrain (about 1 600 m there) to the village, 1 209 m: warmer than the raw grid.
    const t = Number(r.pas_de_3h[0].temperature.replace(",", ".").replace(" °C", ""));
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(25);
    const w = r.avertissements.join(" ");
    expect(w).toMatch(/pas une mesure/);
    expect(w).toMatch(/microclimats/);
    expect(w).toMatch(/vigilance officielle/);
    expect(w).toMatch(/relief du modèle est à 1\d{3} m : les températures sont ramenées à l'altitude de Cilaos \(1\u202f209 m\)/);
    expect(r.jours[0].modeles).toMatch(/AROME outre-mer de Météo-France de 12h à 15h/);
    // The UV index comes from its own forecast, credited and explained apart.
    expect(r.jours[0].indice_uv_max).toMatch(/^\d+ \((faible|modéré|élevé|très élevé|extrême)\)$/);
    expect(w).toMatch(/Indice UV : PRÉVISION du service européen Copernicus/);
    expect(r.sources.map((s: { source: string }) => s.source)).toEqual([arome.SOURCE.nom, openmeteo.SOURCE.nom, uv.SOURCE.nom]);
  });

  it("downloads at most the budget of grids for one question, nearest steps first", async () => {
    configure({ token: "test" });
    const grid = tif("t2m");
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      if (!String(url).includes("GetCoverage")) throw new Error("no network in tests");
      urls.push(String(url));
      return new Response(grid);
    });
    const r = body(await previsionMeteo(await offlineCache(), "Cilaos", undefined, NOW));
    // Whole steps only: five grids each, seven for the morning's with their cloud layer.
    expect(urls.length).toBeLessThanOrEqual(arome.MAX_NEW_GRIDS);
    expect(urls.length).toBeGreaterThan(arome.MAX_NEW_GRIDS - 7);
    // The step under way (9h) and the next ones; 12h was cached already.
    expect(urls.some((u) => u.includes("time(2026-10-22T05:00:00Z)"))).toBe(true);
    expect(r.pas_de_3h[0]).toMatchObject({ heures: "jeudi 22/10 9h–12h", modele: "AROME outre-mer de Météo-France" });
    expect(r.resume).toMatch(/^PRÉVISION \(modèle AROME/);
  });

  it("falls back to ECMWF alone, saying so, when AROME does not answer", async () => {
    configure({ token: "test" });
    noNetwork();
    const store = new MemoryStore();
    await store.put(openmeteo.cacheKey(resolvePlace("Cilaos")!.lieu), { value: json("openmeteo_cilaos.json"), fetchedAt: NOW.getTime() });
    const r = body(await previsionMeteo(new Cache(store, () => NOW.getTime()), "Cilaos", "demain", NOW));
    expect(r.resume).toMatch(/^PRÉVISION \(modèle IFS HRES/);
    expect(r.avertissements.join(" ")).toMatch(/AROME de Météo-France n'a pas répondu/);
  });

  it("does not ask AROME for days beyond its 48 hours", async () => {
    configure({ token: "test" });
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      throw new Error("no network in tests");
    });
    const r = body(await previsionMeteo(await offlineCache(), "Cilaos", "dans 3 jours", NOW));
    expect(r.resume).toMatch(/^PRÉVISION \(modèle IFS HRES/);
    expect(urls).toEqual([]);
  });
});

describe("a run listed before all its hours are out", () => {
  // The 0 h UTC run of 22/10 answered up to 23/10 03:00 UTC excluded (404 after), the 18 h UTC run before it in full.
  const NEWEST = "2026-10-22T00.00.00Z";
  const BEFORE = "2026-10-21T18.00.00Z"; // RUN
  const MISSING_FROM = Date.parse("2026-10-23T03:00:00Z");
  const START = Date.parse("2026-10-22T07:20:00Z");
  let asked: { run: string; time: number }[];

  function partialRun() {
    asked = [];
    configure({ token: "test" });
    vi.stubGlobal("fetch", async (url: string) => {
      const u = decodeURIComponent(String(url));
      if (u.includes("GetCapabilities")) {
        return new Response([BEFORE, NEWEST].map((r) => `<x>TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___${r}</x>`).join(""));
      }
      if (!u.includes("GetCoverage")) throw new Error("no network in tests");
      const run = u.match(/___(\d{4}-\d\d-\d\dT\d\d\.\d\d\.\d\dZ)/)![1];
      const time = Date.parse(u.match(/time\(([^)]+)\)/)![1]);
      asked.push({ run, time });
      if (run === NEWEST && time >= MISSING_FROM) return new Response("not found", { status: 404 });
      const tif = u.includes("PRESSURE__GROUND") ? "ps" : u.includes("MEAN_SEA_LEVEL") ? "pmsl" : "t2m";
      return new Response(readFileSync(new URL(`./fixtures/arome/${tif}.tif`, import.meta.url)));
    });
  }

  async function cacheAt(clock: { now: number }) {
    const store = new MemoryStore();
    await store.put(openmeteo.cacheKey(resolvePlace("Cilaos")!.lieu), { value: json("openmeteo_cilaos.json"), fetchedAt: START });
    await store.put("openmeteo:meta", { value: json("openmeteo_meta.json"), fetchedAt: START });
    await store.put("uv:ile", { value: uv.parse(json("cams_uv.json")), fetchedAt: START });
    await store.put(ensemble.KEY, { value: ensIle(), fetchedAt: START });
    return new Cache(store, () => clock.now);
  }

  it("takes the hours not out yet from the run before, and says so", async () => {
    partialRun();
    const clock = { now: START };
    const r = body(await previsionMeteo(await cacheAt(clock), "Cilaos", "demain", new Date(START)));
    expect(r.resume).toMatch(/^PRÉVISION \(modèle AROME outre-mer de Météo-France, maille de 2,5 km, calcul de 22\/10 04:00, et de 21\/10 22:00 pour la suite/);
    expect(r.modele.calculs_suivants).toEqual([{ run_du_modele: "21/10 22:00", a_partir_de: "23/10 06:00" }]);
    // Midnight to 6h from the newest run, then the run before, then ECMWF. Cold, the question's 40 grids reach 15h:
    // the steps of the night and of the morning take two more each for the cloud layer (the prefetch fills the rest).
    const models = r.pas_de_3h.map((s: { heures: string; modele: string }) => s.modele);
    expect(models).toHaveLength(8);
    expect(models.slice(0, 5).every((m: string) => m.startsWith("AROME"))).toBe(true);
    expect(models.slice(5).every((m: string) => /^IFS/.test(m))).toBe(true);
    expect(r.avertissements.join(" ")).toMatch(/calcul d'AROME de 22\/10 04:00 n'est pas encore entièrement publié .* à partir de 23\/10 06:00, les valeurs viennent du calcul de 21\/10 22:00/);
    expect(asked.some((a) => a.run === BEFORE)).toBe(true);
  });

  it("does not ask again for the missing hours for a while, then does", async () => {
    partialRun();
    const clock = { now: START };
    const c = await cacheAt(clock);
    await previsionMeteo(c, "Cilaos", "demain", new Date(START));
    const late = () => asked.filter((a) => a.run === NEWEST && a.time >= MISSING_FROM).length;
    const first = late();
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(6); // the grids already in flight when the first 404 came back

    clock.now = START + 10 * 60_000;
    const before = asked.length;
    await previsionMeteo(c, "Cilaos", "demain", new Date(clock.now));
    expect(late()).toBe(first); // the missing hours not tried again
    expect(asked.length - before).toBeLessThanOrEqual(12); // at most the steps the first question had no room for, 15h and 18h

    clock.now = START + 30 * 60_000;
    await previsionMeteo(c, "Cilaos", "demain", new Date(clock.now));
    expect(late()).toBeGreaterThan(first);
  });

  it("is not an error in the logs", async () => {
    partialRun();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    await previsionMeteo(await cacheAt({ now: START }), "Cilaos", "demain", new Date(START));
    expect(errors).not.toHaveBeenCalled();
    expect(logs).toHaveBeenCalledWith(expect.stringMatching(/pas encore publié à partir de 2026-10-23T03:00:00Z/));
    errors.mockRestore();
    logs.mockRestore();
  });
});

describe("the run list", () => {
  it("is used as it is when old and the service does not answer in time", async () => {
    configure({ token: "test" });
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    // Two hours old: past the questions' freshness, so they ask, fail, and keep it.
    const r = body(await previsionMeteo(await offlineCache(2 * H), "Cilaos", "cet après-midi", NOW));
    expect(r.resume).toMatch(/^PRÉVISION \(modèle AROME/);
  });

  it("says which request failed when there is none to fall back on", async () => {
    configure({ token: "test" });
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(arome.prepare(new Cache(new MemoryStore(), () => NOW.getTime()), [STEP])).rejects.toThrow(
      /^arome: liste des calculs \(GetCapabilities\) : The operation was aborted due to timeout$/,
    );
    errors.mockRestore();
  });
});
