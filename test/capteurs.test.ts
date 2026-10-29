import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { count, counted } from "../src/budget.js";
import { Cache, MemoryStore, type CacheEntry } from "../src/cache.js";
import * as airMesures from "../src/providers/air-mesures.js";
import * as capteurs from "../src/providers/capteurs.js";
import { parse as parseAtmo } from "../src/providers/atmo.js";
import { REGISTRY } from "../src/registre.js";
import { CAPTEURS_AUCUN, CAPTEURS_AVERTISSEMENT, measuredAt, qualiteAir } from "../src/tools/air.js";
import { airPage } from "../src/web/domains.js";
import { esc } from "../src/web/map.js";
import { SHARED } from "../src/web/partagees.js";

// Invented sensors: their identifiers are made up, their points are the centres of two communes of the gazetteer, and
// the others are off the island (Stuttgart) or indoors. None is a sensor of La Réunion.
const at = (id: number, lat: number, lon: number, ts: string, values: Record<string, string>, indoor = 0) => ({
  id: id * 10,
  timestamp: ts,
  sampling_rate: null,
  location: { id, latitude: String(lat), longitude: String(lon), altitude: "10.0", country: "FR", exact_location: 1, indoor },
  sensor: { id, pin: "1", sensor_type: { id: 14, name: "SDS011", manufacturer: "Nova Fitness" } },
  sensordatavalues: Object.entries(values).map(([value_type, value], i) => ({ id: id * 100 + i, value_type, value })),
});
const ANSWER = [
  at(900001, -20.87999, 55.44814, "2026-10-29 06:20:00", { P1: "20.4", P2: "12.1" }),
  at(900002, -20.93546, 55.29168, "2026-10-29 06:21:30", { P1: "8", P2: "" }),
  at(900003, 48.77, 9.17, "2026-10-29 06:20:00", { P1: "30", P2: "20" }),
  at(900004, -20.87999, 55.44814, "2026-10-29 06:20:00", { P1: "40", P2: "25" }, 1),
  at(900005, -20.87999, 55.44814, "2026-10-29 06:20:00", { temperature: "24.1", humidity: "70" }),
];
// 10:25 in La Réunion.
const NOW = new Date("2026-10-29T06:25:00Z");
const atmo = parseAtmo(JSON.parse(readFileSync(new URL("./fixtures/atmo_974.json", import.meta.url), "utf8")));
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
function cache() {
  const store = new MemoryStore();
  void store.put("atmo:974", { value: atmo, fetchedAt: NOW.getTime() });
  return new Cache(store, () => NOW.getTime());
}

afterEach(() => {
  capteurs.configure(undefined);
  airMesures.configure(undefined);
  vi.unstubAllGlobals();
});

describe("the sensors of private people (Sensor.Community)", () => {
  it("keeps the island's outdoor sensors with particles, each by its commune, its time in UTC", () => {
    expect(capteurs.parse(ANSWER)).toEqual([
      { cle: "900001", commune: "Saint-Denis", pm10: 20.4, pm2_5: 12.1, mesure_a: "2026-10-29T06:20:00Z" },
      { cle: "900002", commune: "Le Port", pm10: 8, mesure_a: "2026-10-29T06:21:30Z" },
    ]);
  });

  it("keeps each sensor's latest measure for 2 hours, and writes when they changed or an hour after", async () => {
    vi.stubGlobal("fetch", async () => Response.json(ANSWER));
    const written: capteurs.Copie[] = [];
    const write = async (c: capteurs.Copie) => void written.push(c);
    const { value, used } = await counted(10, () => capteurs.collect(null, write, NOW));
    expect(used).toBe(1);
    expect(value).toBe("2 lus, 2 des 2 dernières heures, écrits");
    // The same sensors read again 15 minutes later: not written; an hour after the write, written again.
    expect(await capteurs.collect(written[0], write, new Date(NOW.getTime() + 15 * 60_000))).toMatch(/inchangés : non réécrits$/);
    expect(written).toHaveLength(1);
    await capteurs.collect(written[0], write, new Date(NOW.getTime() + 60 * 60_000));
    expect(written).toHaveLength(2);
    // None read for 2 hours and more: the sensors drop out, and the empty list is written.
    vi.stubGlobal("fetch", async () => Response.json([]));
    await capteurs.collect(written[1], write, new Date(NOW.getTime() + 2 * 3600_000 + 60_000));
    expect(written.at(-1)!.capteurs).toEqual([]);
  });

  it("is read at 10, 25, 40 and 55 past (UTC), and registered", () => {
    const due = (min: number) => capteurs.refreshDue(new Date(Date.UTC(2026, 9, 29, 6, min)));
    expect([0, 10, 14, 15, 25, 40, 55, 59].map(due)).toEqual([false, true, true, false, true, true, true, true]);
    expect(REGISTRY.find((e) => e.id === "capteurs:air")).toMatchObject({ trigger: "planifiée", every: 15, offset: 10, run: { subrequests: 3, kvReads: 1, kvWrites: 1 } });
  });

  it("says when a sensor measured: today, or yesterday", () => {
    expect(measuredAt("2026-10-29T06:20:00Z", NOW)).toBe("à 10:20");
    expect(measuredAt("2026-10-28T19:10:00Z", new Date("2026-10-28T21:00:00Z"))).toBe("hier à 23:10");
  });

  it("gives them apart from the index, by commune, never an identifier nor a place, with the warning", async () => {
    // As the scheduled event stores them.
    const copie = { lu: "2026-10-29T06:10:00Z", capteurs: capteurs.merge([], capteurs.parse(ANSWER), NOW) };
    capteurs.configure(async () => copie);
    const r = body(await qualiteAir(cache(), undefined, NOW));
    const c = r.capteurs_amateurs;
    expect(c.avertissement).toBe(CAPTEURS_AVERTISSEMENT);
    expect(c.valeurs).toEqual([
      { commune: "Le Port", pm10: 8, unite: "µg/m³", mesurees: "à 10:21" },
      { commune: "Saint-Denis", pm2_5: 12.1, pm10: 20.4, unite: "µg/m³", mesurees: "à 10:20" },
    ]);
    expect(c.lu_par_rundata).toBe("29/10 10:10");
    expect(JSON.stringify(c)).not.toMatch(/9000\d\d|latitude|longitude|-20\.8/);
    expect(r.sources.map((s: { source: string }) => s.source)).toContain(capteurs.SOURCE.nom);
    // The index comes first, and its words never name a sensor.
    expect(Object.keys(r).indexOf("communes")).toBeLessThan(Object.keys(r).indexOf("capteurs_amateurs"));
    expect(`${r.resume} ${r.nature}`).not.toMatch(/capteur/i);
    // A place's answer carries them too.
    expect(body(await qualiteAir(cache(), "Saint-Denis", NOW)).capteurs_amateurs.valeurs).toHaveLength(2);
  });

  it("drops a sensor older than 2 hours, and says none in one sentence", async () => {
    capteurs.configure(async () => ({ lu: "2026-10-29T06:10:00Z", capteurs: [{ cle: "900001", commune: "Saint-Denis", pm10: 20, mesure_a: "2026-10-29T04:20:00Z" }] }));
    const c = body(await qualiteAir(cache(), undefined, NOW)).capteurs_amateurs;
    expect(c).not.toHaveProperty("valeurs");
    expect(c.aucun).toBe(CAPTEURS_AUCUN);
  });

  it("has none where the store is not configured, nor while it has no copy", async () => {
    expect(body(await qualiteAir(cache(), undefined, NOW))).not.toHaveProperty("capteurs_amateurs");
    capteurs.configure(async () => null);
    expect(body(await qualiteAir(cache(), undefined, NOW))).not.toHaveProperty("capteurs_amateurs");
  });

  it("shows them on /air under the index, raw, without a colour, and the guide folded", async () => {
    capteurs.configure(async () => ({ lu: "2026-10-29T06:10:00Z", capteurs: capteurs.parse(ANSWER) }));
    const answer = body(await qualiteAir(cache(), undefined, NOW));
    const page = airPage("https://rundata.re", { value: answer, fetchedAt: NOW, stale: false }, NOW);
    const start = page.indexOf('id="h-capteurs-air"');
    expect(start).toBeGreaterThan(page.indexOf('id="h-communes-air"'));
    const section = page.slice(start, page.indexOf("</section>", start));
    expect(section).toContain("<li>Saint-Denis · PM2,5 : 12,1 µg/m³ · PM10 : 20,4 µg/m³ · mesurées à 10:20 <span class=\"note\">non étalonné</span></li>");
    expect(section).toContain(`<b>${CAPTEURS_AVERTISSEMENT}</b>`);
    expect(section).toContain('<details class="card" id="brancher"><summary>Brancher son capteur</summary>');
    expect(section).not.toMatch(/class="[^"]*\b(?:aq|lvl|level)-/);
    // Empty: one sentence and the link to the guide.
    capteurs.configure(async () => ({ lu: "2026-10-29T06:10:00Z", capteurs: [] }));
    const none = body(await qualiteAir(cache(), undefined, NOW));
    expect(airPage("https://rundata.re", { value: none, fetchedAt: NOW, stale: false }, NOW)).toContain(`<p>${esc(CAPTEURS_AUCUN)} <a href="#brancher">Brancher un capteur</a></p>`);
  });

  it("costs, from cold, what the budget's registry says: the index and the two copies read from KV", async () => {
    vi.stubGlobal("fetch", async () => new Response(readFileSync(new URL("./fixtures/atmo_974.json", import.meta.url))));
    // As worker.ts: one KV read each, counted.
    const mesure = { station: "FR38001", nom_fichier: "STATION", type: "fond", polluant: "O3", debut: "2026-10-29T07:00:00+04:00", fin: "2026-10-29T08:00:00+04:00", valeur: 30, unite: "µg-m3" };
    airMesures.configure(async () => (count(), { lu: "2026-10-29T05:40:00Z", derniere_heure: mesure.fin, mesures: [mesure] }));
    capteurs.configure(async () => (count(), { lu: "2026-10-29T06:10:00Z", capteurs: [] }));
    class EdgeLike extends MemoryStore {
      async get(key: string, since?: number) {
        count(1, "read");
        return super.get(key, since);
      }
      async put(key: string, entry: CacheEntry) {
        count(1, true);
        return super.put(key, entry);
      }
    }
    const { used } = await counted(50, () => qualiteAir(new Cache(new EdgeLike(), () => NOW.getTime()), undefined, NOW));
    expect(used).toBeLessThanOrEqual(SHARED.find((s) => s.key === "web:air")!.cold!);
    for (const id of ["qualite_air", "web:air"]) expect(REGISTRY.find((e) => e.id === id)!.run.kvReads, id).toBe(2);
    expect(REGISTRY.find((e) => e.id === "qualite_air")!.run.subrequests).toBe(used);
  });
});
