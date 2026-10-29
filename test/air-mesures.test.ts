import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { count, counted } from "../src/budget.js";
import { Cache, MemoryStore, type CacheEntry } from "../src/cache.js";
import * as airMesures from "../src/providers/air-mesures.js";
import { parse } from "../src/providers/atmo.js";
import { qualiteAir } from "../src/tools/air.js";
import { airPage } from "../src/web/domains.js";
import { REGISTRY } from "../src/registre.js";
import { SHARED } from "../src/web/partagees.js";

// Lines of the LCSQA's file of 29/10/2026 (FR_E2_2026-10-29.csv, read at 10:08): one of Metz, then Atmo Réunion's,
// valid or not, among them a nitrogen monoxide (outside the index) and empty values (-1).
const lines = readFileSync(new URL("./fixtures/lcsqa_e2_974.csv", import.meta.url), "utf8").split("\n");
const all = lines.flatMap((l) => airMesures.mesure(l) ?? []);
const kept = airMesures.latest(all);
// 10:00 in La Réunion.
const NOW = new Date("2026-10-29T06:00:00Z");
const copie: airMesures.Copie = { lu: "2026-10-29T05:40:00Z", derniere_heure: "2026-10-29T08:00:00+04:00", mesures: kept };
const atmo = parse(JSON.parse(readFileSync(new URL("./fixtures/atmo_974.json", import.meta.url), "utf8")));
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
function cache() {
  const store = new MemoryStore();
  void store.put("atmo:974", { value: atmo, fetchedAt: NOW.getTime() });
  return new Cache(store, () => NOW.getTime());
}

afterEach(() => {
  airMesures.configure(undefined);
  vi.unstubAllGlobals();
});

/** The data center's cache, counted as the Worker counts it (worker.ts EdgeStore): a read, a write. */
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

describe("measures at Atmo Réunion's stations", () => {
  it("keeps Atmo Réunion's valid measures of the index's pollutants, hours in local time", () => {
    expect(all.every((m) => m.station.startsWith("FR38"))).toBe(true);
    expect(all.some((m) => m.polluant === "NO")).toBe(false);
    expect(all.find((m) => m.station === "FR38001" && m.polluant === "O3" && m.fin.endsWith("08:00:00+04:00"))).toEqual({
      station: "FR38001",
      nom_fichier: "LYC. LISLET GEOFFROY",
      type: "fond",
      polluant: "O3",
      debut: "2026-10-29T07:00:00+04:00",
      fin: "2026-10-29T08:00:00+04:00",
      valeur: 30.5,
      unite: "µg-m3",
    });
    // Not valid (-1), never a 0 nor a value from elsewhere: Ligne Paradis's ozone and Luther King's last PM10 are not kept.
    expect(all.some((m) => m.station === "FR38014")).toBe(false);
    expect(all.filter((m) => m.station === "FR38011").map((m) => m.fin)).toEqual(["2026-10-29T01:00:00+04:00"]);
    // A detection limit (2) or half of it (3) in place of the value is not a measure; 4 is valid for ozone only.
    const line = lines.find((l) => l.includes('"FR38001"') && l.includes('"NO2"'))!;
    for (const code of ["2", "3", "4", "-99"]) expect(airMesures.mesure(line.replace(/"1"$/, `"${code}"`))).toBeUndefined();
  });

  it("keeps the latest measure of each station, type and pollutant", () => {
    expect(kept.map((m) => `${m.station} ${m.type} ${m.polluant} ${m.valeur}`)).toEqual([
      "FR38001 fond NO2 6.8",
      "FR38001 fond O3 30.5",
      "FR38001 fond PM10 11.6",
      "FR38009 trafic NO2 21.5",
      "FR38009 industrielle SO2 1.1",
      "FR38011 fond PM10 22.1",
      "FR38021 fond O3 41",
    ]);
    for (const m of kept) expect(airMesures.STATIONS[m.station]).toBeDefined();
  });

  it("says each value with its hour, station, type, commune, as raw, and late past 3 h, apart from the forecast", async () => {
    airMesures.configure(async () => copie);
    const r = body(await qualiteAir(cache(), undefined, NOW));
    const m = r.mesures_aux_stations;
    expect(m.nature).toBe("MESURES brutes, non validées, aux stations d'Atmo Réunion, publiées par le LCSQA : ce n'est pas l'indice ATMO, qui est une prévision.");
    expect(m.valeurs[0]).toEqual({ polluant: "dioxyde d'azote", valeur: 6.8, unite: "µg/m³", heure: "de 7 h à 8 h", station: "Lycée Lislet Geoffroy", type: "fond", commune: "Saint-Denis", statut: "mesure brute, non validée" });
    expect(m.valeurs.every((v: { statut: string }) => v.statut === "mesure brute, non validée")).toBe(true);
    // Ended at 07:00, 3 h before: not late. At 01:00 and 06:00: late.
    expect(m.valeurs.filter((v: { retard?: string }) => v.retard).map((v: { station: string; retard: string }) => `${v.station} ${v.retard}`)).toEqual(["Luther King mesurée il y a 9 h", "Grand Fond mesurée il y a 4 h"]);
    expect(m.lu_par_rundata).toBe("29/10 09:40");
    expect(r.sources.map((s: { source: string }) => s.source)).toContain(airMesures.SOURCE.nom);
    // The forecast's words never name a measure.
    expect(`${r.resume} ${r.nature}`).not.toMatch(/mesure brute|station/);
  });

  it("gives a place its commune's stations, else the nearest one with its distance", async () => {
    airMesures.configure(async () => copie);
    const denis = body(await qualiteAir(cache(), "Saint-Denis", NOW)).mesures_aux_stations;
    expect(new Set(denis.valeurs.map((v: { commune: string }) => v.commune))).toEqual(new Set(["Saint-Denis"]));
    expect(denis).not.toHaveProperty("station_la_plus_proche_km");
    const cilaos = body(await qualiteAir(cache(), "Cilaos", NOW)).mesures_aux_stations;
    expect(cilaos.station_la_plus_proche_km).toBeGreaterThan(0);
    expect(new Set(cilaos.valeurs.map((v: { station: string }) => v.station)).size).toBe(1);
  });

  it("has none where the store is not configured: the Worker alone reads them", async () => {
    expect(body(await qualiteAir(cache(), undefined, NOW))).not.toHaveProperty("mesures_aux_stations");
  });

  it("shows them on /air in their own section, every value raw, not validated, with its station and hour", async () => {
    airMesures.configure(async () => copie);
    const answer = body(await qualiteAir(cache(), undefined, NOW));
    const page = airPage("https://rundata.re", { value: answer, fetchedAt: NOW, stale: false }, NOW);
    const at = page.indexOf('id="h-mesures-air"');
    const section = page.slice(at, page.indexOf("</section>", at));
    expect(section).toContain("<h3>Lycée Lislet Geoffroy · Saint-Denis</h3>");
    expect(section).toContain("<li><b>ozone</b> : 30,5 µg/m³ <span class=\"note\">de 7 h à 8 h, station de type fond, mesure brute, non validée</span></li>");
    expect(section).toContain("mesurée il y a 9 h");
    expect(section.match(/<li>/g)).toHaveLength(7);
    expect(section.match(/mesure brute, non validée/g)).toHaveLength(7);
    expect(section).toContain(`<a href="${airMesures.SOURCE.url}" rel="noopener">`);
    // Without measures, no section.
    airMesures.configure(undefined);
    const none = body(await qualiteAir(cache(), undefined, NOW));
    expect(airPage("https://rundata.re", { value: none, fetchedAt: NOW, stale: false }, NOW)).not.toContain('id="h-mesures-air"');
  });

  it("costs, from cold, what the budget's registry says: the index, and the measures' copy read from KV", async () => {
    vi.stubGlobal("fetch", async () => new Response(readFileSync(new URL("./fixtures/atmo_974.json", import.meta.url))));
    // As worker.ts: one KV read, counted.
    airMesures.configure(async () => (count(), copie));
    const { used } = await counted(50, () => qualiteAir(new Cache(new EdgeLike(), () => NOW.getTime()), undefined, NOW));
    expect(used).toBeLessThanOrEqual(SHARED.find((s) => s.key === "web:air")!.cold!);
    for (const id of ["qualite_air", "web:air"]) expect(REGISTRY.find((e) => e.id === id)!.run.kvReads, id).toBe(1);
    expect(REGISTRY.find((e) => e.id === "qualite_air")!.run.subrequests).toBe(used);
  });

  it("is read every hour by the scheduled event at 45 past, from 45 to 49 (UTC)", () => {
    const at = (min: number) => airMesures.refreshDue(new Date(Date.UTC(2026, 9, 29, 6, min)));
    expect([0, 30, 44, 45, 49, 50].map(at)).toEqual([false, false, false, true, true, false]);
    const e = REGISTRY.find((x) => x.id === "air:mesures")!;
    expect(e).toMatchObject({ trigger: "planifiée", every: 60, offset: 45, run: { subrequests: 6, kvReads: 1, kvWrites: 1 } });
  });

  it("reads the day's file line by line, in pieces, 2 subrequests a file, and writes only when the latest hour changed", async () => {
    const csv = readFileSync(new URL("./fixtures/lcsqa_e2_974.csv", import.meta.url));
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      // In pieces of 97 bytes, a line cut across two of them.
      const body = new ReadableStream({
        start(c) {
          for (let i = 0; i < csv.length; i += 97) c.enqueue(csv.subarray(i, i + 97));
          c.close();
        },
      });
      return new Response(body);
    });
    const written: airMesures.Copie[] = [];
    const { value, used } = await counted(50, () => airMesures.collect(null, async (c) => void written.push(c), NOW));
    expect(asked).toEqual(["https://files.data.gouv.fr/ineris/lcsqa/concentrations-de-polluants-atmospheriques-reglementes/temps-reel/2026/FR_E2_2026-10-29.csv"]);
    expect(used).toBe(2);
    expect(value).toBe("7 mesures de 4 stations, dernière heure finie à 08:00 le 2026-10-29, écrites");
    expect(written).toEqual([{ lu: NOW.toISOString(), derniere_heure: "2026-10-29T08:00:00+04:00", mesures: kept }]);
    // The same hour an hour later: nothing written.
    const again = await airMesures.collect(written[0], async (c) => void written.push(c), new Date(NOW.getTime() + 3600_000));
    expect(again).toMatch(/inchangée : non réécrites$/);
    expect(written).toHaveLength(1);
  });

  it("reads the day before's file while the day's has none of Atmo Réunion's lines, and fails without a valid measure", async () => {
    const csv = readFileSync(new URL("./fixtures/lcsqa_e2_974.csv", import.meta.url), "utf8");
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url.slice(url.lastIndexOf("/") + 1));
      return url.endsWith("2026-10-29.csv") ? new Response("", { status: 404 }) : new Response(csv);
    });
    const written: airMesures.Copie[] = [];
    await airMesures.collect(null, async (c) => void written.push(c), NOW);
    expect(asked).toEqual(["FR_E2_2026-10-29.csv", "FR_E2_2026-10-28.csv"]);
    expect(written[0].mesures).toEqual(kept);
    // No file gives a measure: it fails, and nothing is written over the copy.
    vi.stubGlobal("fetch", async () => new Response(csv.split("\n")[0]));
    await expect(airMesures.collect(written[0], async (c) => void written.push(c), NOW)).rejects.toThrow("aucune mesure valide d'Atmo Réunion");
    expect(written).toHaveLength(1);
  });
});
