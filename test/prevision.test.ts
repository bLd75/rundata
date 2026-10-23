import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { resolvePlace } from "../src/places/resolve.js";
import * as openmeteo from "../src/providers/openmeteo.js";
import { parsePeriod, previsionMeteo } from "../src/tools/prevision.js";

const fixture = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
// The fixture was recorded on Thursday 22/10/2026 around 10:00 Réunion time.
const NOW = new Date("2026-10-22T06:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

/** Only Cilaos is in the cache; any other place would need the network, which fails. */
async function offlineCache() {
  const store = new MemoryStore();
  const at = NOW.getTime();
  await store.put(openmeteo.cacheKey(resolvePlace("Cilaos")!.lieu), { value: fixture("openmeteo_cilaos.json"), fetchedAt: at });
  await store.put("openmeteo:meta", { value: fixture("openmeteo_meta.json"), fetchedAt: at });
  return new Cache(store, () => at);
}

beforeEach(() =>
  vi.stubGlobal("fetch", async () => {
    throw new Error("no network in tests");
  }),
);
afterEach(() => vi.unstubAllGlobals());

describe("parsePeriod", () => {
  it.each([
    ["demain", "demain", [["2026-10-23", 0, 24]]],
    ["tomorrow", "demain", [["2026-10-23", 0, 24]]],
    ["ce soir", "ce soir", [["2026-10-22", 18, 24]]],
    ["cet après-midi", "cet après-midi", [["2026-10-22", 12, 18]]],
    ["demain matin", "demain matin", [["2026-10-23", 6, 12]]],
    ["cette nuit", "cette nuit", [["2026-10-22", 21, 24], ["2026-10-23", 0, 6]]],
    ["samedi", "samedi 24/10", [["2026-10-24", 0, 24]]],
    ["jeudi", "jeudi 22/10", [["2026-10-22", 0, 24]]],
    ["ce week-end", "ce week-end", [["2026-10-24", 0, 24], ["2026-10-25", 0, 24]]],
    ["dans 3 jours", "dans 3 jours", [["2026-10-25", 0, 24]]],
    ["cette semaine", "les prochaines 24 h et les jours suivants", []],
  ])("%s", (quand, libelle, slots) => {
    const p = parsePeriod(quand, NOW);
    expect(p.libelle).toBe(libelle);
    expect(p.slots.map((s) => [s.jour, s.de, s.a])).toEqual(slots);
  });

  it("falls back to the next hours when it does not understand", () => {
    expect(parsePeriod("quand les poules auront des dents", NOW)).toMatchObject({ compris: false, defaut: true });
  });
});

describe("openmeteo.parse", () => {
  it("turns local wall-clock times into instants", () => {
    const f = openmeteo.parse(fixture("openmeteo_cilaos.json"));
    expect(f.hours[0].time.toISOString()).toBe("2026-10-21T20:00:00.000Z"); // 00:00 in Réunion
    expect(f.days).toHaveLength(7);
    expect(f.altitude_m).toBe(1209);
  });
});

describe("prevision_meteo", () => {
  const always = (r: { nature: string; resume: string; avertissements: string[] }) => {
    expect(r.nature).toBe("prevision");
    expect(r.resume).toMatch(/^PRÉVISION/);
    const w = r.avertissements.join(" ");
    expect(w).toMatch(/pas une mesure/);
    expect(w).toMatch(/microclimats/);
    expect(w).toMatch(/vigilance officielle/);
  };

  it("gives tomorrow for Cilaos, labelled as a forecast", async () => {
    const r = body(await previsionMeteo(await offlineCache(), "Cilaos", "demain", NOW));
    always(r);
    expect(r.resume).toMatch(/Cilaos, demain \(vendredi 23\/10\)/);
    expect(r.jours).toHaveLength(1);
    expect(r.pas_de_3h).toHaveLength(8);
    expect(r.pas_de_3h[0].heures).toBe("vendredi 23/10 0h–3h");
    expect(r.avertissements.join(" ")).toMatch(/altitude de Cilaos \(1209 m\)/);
  });

  it("gives the next 24 hours and the following days without a time", async () => {
    const r = body(await previsionMeteo(await offlineCache(), "Cilaos", undefined, NOW));
    always(r);
    expect(r.pas_de_3h[0].heures).toBe("jeudi 22/10 9h–12h"); // the step under way at 10:00
    expect(r.pas_de_3h).toHaveLength(9);
    expect(r.jours.map((j: { jour: string }) => j.jour)).toEqual([
      "jeudi 22/10", "vendredi 23/10", "samedi 24/10", "dimanche 25/10", "lundi 26/10", "mardi 27/10", "mercredi 28/10",
    ]);
  });

  it("says when the day is past the model's range", async () => {
    const r = body(await previsionMeteo(await offlineCache(), "Cilaos", "dans 10 jours", NOW));
    expect(r.nature).toBe("prevision");
    expect(r.resume).toMatch(/ne va que jusqu'au mercredi 28\/10/);
  });

  it("tours the island with the places it could get", async () => {
    const r = body(await previsionMeteo(await offlineCache(), undefined, undefined, NOW));
    always(r);
    expect(r.lieux.map((l: { lieu: string }) => l.lieu)).toEqual(["Cilaos"]);
    expect(r.lieux[0].jours).toHaveLength(2);
  });

  it("says so when the forecast service is down and nothing is cached", async () => {
    const r = await previsionMeteo(await offlineCache(), "Saint-Denis", "demain", NOW);
    expect(r.isError).toBe(true);
    expect(body(r).nature).toBe("prevision");
  });
});
