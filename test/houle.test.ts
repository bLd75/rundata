import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_BUDGET, count, counted, left } from "../src/budget.js";
import { Cache, MemoryStore, TieredStore, type CacheEntry } from "../src/cache.js";
import * as acspo from "../src/providers/acspo.js";
import * as houle from "../src/providers/houle.js";
import * as uv from "../src/providers/uv.js";
import { SATELLITES, temperatureMer } from "../src/tools/mer.js";
import { previsionMeteo } from "../src/tools/prevision.js";

// Recorded from Open-Meteo for 22 to 25/10/2026: the ECMWF wave model at the beaches of the page /mer, and the CAMS
// UV index over the island's six cells.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const json = (f: string) => JSON.parse(String(fixture(f)));
const NOW = new Date("2026-10-22T06:00:00Z"); // Thursday, 10:00 in Réunion
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

function overLimit() {
  if (left() < 0) throw new Error("Too many subrequests by single Worker invocation");
}

/** The data center's cache: each read or write is a subrequest, noted by key. */
class EdgeLike extends MemoryStore {
  ops: string[] = [];
  async get(key: string) {
    count();
    overLimit();
    this.ops.push(key);
    return super.get(key);
  }
  async put(key: string, entry: CacheEntry) {
    count();
    overLimit();
    this.ops.push(key);
    return super.put(key, entry);
  }
}

const isolate = (edge = new EdgeLike()) => new Cache(new TieredStore(new MemoryStore(), edge), () => NOW.getTime(), false);

/** An isolate whose data center holds the satellites' grids the scheduled event shared: temperature_mer reads them there. */
async function withSea() {
  const edge = new EdgeLike();
  const satellites = [{ source: "acspo", jours: [acspo.parseAscii(String(fixture("acspo.ascii")), "2026-10-21")], lu: NOW.getTime() }];
  await edge.put(SATELLITES, { value: satellites, fetchedAt: NOW.getTime() });
  return isolate(edge);
}

let fetched: string[];
let down: RegExp | null;

function upstream(url: string): Response {
  if (down?.test(url)) throw new Error("source down");
  if (url.includes("marine-api.open-meteo")) return new Response(fixture("openmeteo_houle.json"));
  if (url.includes("air-quality-api.open-meteo")) return new Response(fixture("cams_uv.json"));
  if (url.includes("/thredds/dodsC/gridLEODYNRTL3SWW00/")) return new Response(fixture("acspo.ascii"));
  if (url.includes("erdMH1sstd1day")) return new Response(fixture("modis.csv"));
  if (url.includes("open-meteo.com/data")) return new Response(fixture("openmeteo_meta.json"));
  if (url.includes("open-meteo")) return new Response(fixture("openmeteo_cilaos.json"));
  throw new Error(`unexpected ${url}`);
}

beforeEach(() => {
  fetched = [];
  down = null;
  vi.stubGlobal("fetch", async (url: string) => {
    overLimit();
    fetched.push(String(url));
    return upstream(String(url));
  });
});

afterEach(() => vi.unstubAllGlobals());

const marine = () => fetched.filter((u) => u.includes("marine-api")).length;
const cams = () => fetched.filter((u) => u.includes("air-quality-api")).length;

describe("houle.parse", () => {
  it("keeps one step every 3 hours from local midnight, for every point of the coast", () => {
    const w = houle.parse(json("openmeteo_houle.json"));
    expect(w.points).toHaveLength(14);
    expect(new Date(w.debut).toISOString()).toBe("2026-10-21T20:00:00.000Z"); // 22/10 0h in Réunion
    expect(w.points[0].hauteur).toHaveLength(32);
    expect(houle.stepTime(w, 1).toISOString()).toBe("2026-10-21T23:00:00.000Z");
    for (const p of w.points) expect(p.hauteur.every((h) => h != null && h > 0 && h < 10)).toBe(true);
  });
});

describe("the waves in temperature_mer", () => {
  it("answer « la houle à Saint-Leu ? » with a forecast labelled as such, apart from the measured temperature", async () => {
    const r = body(await temperatureMer(await withSea(), "Saint-Leu", NOW));
    expect(r.resume).toMatch(/Vagues PRÉVUES près de Saint-Leu \(modèle WAM du Centre européen \(ECMWF\), pas une mesure\) : \d+(,\d)? m (du |de l')[a-z-]+, période \d+ s vers 9h\u00a0; jusqu'à \d+(,\d)? m/);
    const s = r.etat_de_la_mer;
    expect(s.nature).toBe("prevision");
    expect(s.point_du_modele.distance_km).toBeLessThan(10);
    expect(s.maintenant).toMatchObject({ heures: "jeudi 22/10 9h", hauteur: expect.stringMatching(/ m$/), periode: expect.stringMatching(/ s$/) });
    expect(s.jours.map((d: { jour: string }) => d.jour)).toEqual(["jeudi 22/10", "vendredi 23/10", "samedi 24/10", "dimanche 25/10"]);
    expect(s.pas_de_3h).toHaveLength(8);
    expect(s.avertissements.join(" ")).toMatch(/PRÉVISION d'un modèle numérique de vagues, pas une mesure.*lagon/);
    expect(s.avertissements.join(" ")).toMatch(/vigilance vagues-submersion/);
    // Never mixed: the measurement stays the satellite's, the forecast has no temperature.
    expect(r.mesure.nature).toBe("mesure_satellite");
    expect(JSON.stringify(s)).not.toMatch(/temperature/);
    expect(r.sources.map((x: { source: string }) => x.source)).toContain(houle.SOURCE.nom);
  });

  it("are left out away from the coast, and said so", async () => {
    const r = body(await temperatureMer(isolate(), "Cilaos", NOW));
    expect(r.etat_de_la_mer).toBeUndefined();
    expect(r.resume).toMatch(/Pas de prévision de vagues à moins de 15 km de Cilaos/);
    expect(r.sources.map((x: { source: string }) => x.source)).not.toContain(houle.SOURCE.nom);
  });

  it("still answer without the satellites' copy", async () => {
    const r = await temperatureMer(isolate(), "Saint-Leu", NOW);
    expect(r.isError).toBeUndefined();
    const b = body(r);
    expect(b.resume).toMatch(/^Température de l'eau : les sources satellite ne répondent pas/);
    expect(b.etat_de_la_mer.nature).toBe("prevision");
    expect(b.mesure).toBeUndefined();
  });

  it("go with each point of the tour of the island", async () => {
    const r = body(await temperatureMer(await withSea(), undefined, NOW));
    expect(r.points.every((p: { vagues_prevision?: string }) => /^\d+(,\d)? m /.test(p.vagues_prevision ?? ""))).toBe(true);
    expect(r.resume).toMatch(/Eau de mer, MESURÉE par satellite\u00a0: .* Vagues PRÉVUES maintenant \(modèle WAM .*pas une mesure\) : Plage de Boucan-Canot \d/);
  });

  it("cost one request for the whole coast cold, three subrequests with the cache, then one, then none", async () => {
    const edge = new EdgeLike();
    const cache = isolate(edge);
    const cold = await counted(PAGE_BUDGET, async () => {
      await temperatureMer(cache, "Saint-Leu", NOW);
      await temperatureMer(cache, "Saint-Denis", NOW);
      await temperatureMer(cache, undefined, NOW);
    });
    expect(cold.used).toBeLessThanOrEqual(PAGE_BUDGET);
    expect(marine()).toBe(1);
    expect(edge.ops.filter((k) => k.startsWith("houle:"))).toEqual(["houle:plages", "houle:plages"]); // the miss, the write
    // Another isolate of the same data center: one read of the edge.
    edge.ops = [];
    await temperatureMer(isolate(edge), "Saint-Pierre", NOW);
    expect(marine()).toBe(1);
    expect(edge.ops.filter((k) => k.startsWith("houle:"))).toEqual(["houle:plages"]);
    // The same isolate: from memory.
    edge.ops = [];
    await temperatureMer(cache, "Le Port", NOW);
    expect(edge.ops.filter((k) => k.startsWith("houle:"))).toEqual([]);
  });
});

describe("the UV index in prevision_meteo", () => {
  it("gives each day's highest index on the WHO scale, labelled a forecast and credited apart", async () => {
    const r = body(await previsionMeteo(isolate(), "Saint-Leu", undefined, NOW));
    expect(r.jours.length).toBeGreaterThan(3);
    for (const d of r.jours.slice(0, 4)) expect(d.indice_uv_max).toMatch(/^\d+ \((faible|modéré|élevé|très élevé|extrême)\)$/);
    expect(r.resume).toMatch(/UV \d+ \(/);
    expect(r.avertissements.join(" ")).toMatch(/Indice UV : PRÉVISION du service européen Copernicus.*pas une mesure.*échelle de l'OMS/);
    expect(r.sources.map((x: { source: string }) => x.source)).toContain(uv.SOURCE.nom);
  });

  it("is one request for the whole island, three subrequests cold", async () => {
    const edge = new EdgeLike();
    const cache = isolate(edge);
    await counted(PAGE_BUDGET, async () => {
      await previsionMeteo(cache, "Saint-Leu", undefined, NOW);
      await previsionMeteo(cache, undefined, undefined, NOW);
    });
    expect(cams()).toBe(1);
    expect(edge.ops.filter((k) => k.startsWith("uv:"))).toEqual(["uv:ile", "uv:ile"]);
  });

  it("is left out, not an error, when CAMS does not answer", async () => {
    down = /air-quality-api/;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = body(await previsionMeteo(isolate(), "Saint-Leu", undefined, NOW));
    expect(r.jours[0].indice_uv_max).toBeUndefined();
    expect(r.avertissements.join(" ")).not.toMatch(/Indice UV/);
    expect(r.sources.map((x: { source: string }) => x.source)).not.toContain(uv.SOURCE.nom);
  });

  it("picks the cell over the place, and reads the WHO scale", () => {
    const cells = uv.parse(json("cams_uv.json"));
    expect(cells).toHaveLength(6);
    expect(uv.at(cells, 55.28, -21.17)).toMatchObject({ lat: expect.closeTo(-21.3, 1), lon: expect.closeTo(55.1, 1) });
    expect([2, 3, 6, 8, 11].map(uv.level)).toEqual(["faible", "modéré", "élevé", "très élevé", "extrême"]);
  });
});
