import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { resolvePlace } from "../src/places/resolve.js";
import { counted, WORKER_FREE_LIMIT } from "../src/budget.js";
import * as ensemble from "../src/providers/ensemble.js";
import * as openmeteo from "../src/providers/openmeteo.js";
import { parsePeriod, previsionMeteo } from "../src/tools/prevision.js";
import { placePage } from "../src/web/pages.js";
import { SHARED_AFTER } from "../src/web/partagees.js";
import { pageOf } from "../src/web/places.js";

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

describe("confidence of the forecast days (ECMWF ensemble)", () => {
  const meta = () => fixture("openmeteo_ens_meta.json");
  const ens = () => ensemble.parse(fixture("openmeteo_ens_ile.json"), meta().last_run_initialisation_time * 1000);
  // The run of 23/10/2026 18:00 UTC.
  const RUN = Date.parse("2026-10-23T18:00:00Z");

  async function withEnsemble() {
    const c = await offlineCache();
    await c.get(ensemble.KEY, 3600, async () => ens());
    return c;
  }

  it("keeps the spread of the 51 members, cell by cell", () => {
    const e = ens();
    expect(e.runAt).toBe(RUN);
    expect(e.cells).toHaveLength(6);
    for (const c of e.cells) {
      expect(c.days).toHaveLength(7);
      expect(c.days.every((d) => d.membres === 51)).toBe(true);
    }
    expect(e.cells[0].days[0]).toMatchObject({ date: "2026-10-24", tmax: [23, 23.9] });
  });

  it("agrees on the first day and parts on the seventh, the worst part deciding", () => {
    const e = ens();
    expect(e.cells.map((c) => ensemble.confidence(c.days[0]).niveau)).toEqual(Array(6).fill("forte"));
    const last = e.cells.map((c) => ensemble.confidence(c.days[6]));
    expect(last.map((c) => c.niveau)).toEqual(Array(6).fill("faible"));
    expect(last[0].pourquoi).toBe("les scénarios divergent sur le carré de 25 km : 3,3 °C d'écart sur le maximum, 33 mm d'écart sur la pluie, 7 scénarios sur 51 donnent 20 mm de pluie ou plus, 31 km/h d'écart sur les rafales");
    // Only gaps: the cell's own values may be a mountain's for a coastal town, against the forecast shown.
    for (const c of e.cells) for (const d of c.days) expect(ensemble.confidence(d).pourquoi).not.toMatch(/ de [\d,]+ à [\d,]+/);
    // Never a chance of rain for the place: the cell is 25 km wide.
    for (const c of e.cells) for (const d of c.days) expect(ensemble.confidence(d).pourquoi).not.toMatch(/%/);
  });

  it("gives each day covered its confidence, with the warning, the run and the credit", async () => {
    const r = body(await previsionMeteo(await withEnsemble(), "Cilaos", undefined, NOW));
    const byDay = Object.fromEntries(r.jours.map((j: { jour: string; confiance?: string }) => [j.jour, j.confiance]));
    expect(byDay["jeudi 22/10"]).toBeUndefined(); // before the ensemble's first day
    expect(byDay["samedi 24/10"]).toMatch(/^(forte|moyenne|faible)$/);
    expect(r.jours.find((j: { jour: string }) => j.jour === "samedi 24/10").confiance_pourquoi).toMatch(/^les scénarios/);
    expect(r.resume).toMatch(/\(confiance (forte|moyenne|faible)\)/);
    const w = r.avertissements.find((x: string) => x.startsWith("Confiance :"));
    expect(w).toContain("accord entre les 51 scénarios");
    expect(w).toContain("calcul du 23/10 22:00");
    expect(w).toContain("Ce n'est pas la probabilité que la prévision soit juste à cet endroit");
    expect(r.sources.map((s: { source: string }) => s.source)).toContain(ensemble.SOURCE.nom);
  });

  it("says nothing of a run more than 24 hours old", async () => {
    const r = body(await previsionMeteo(await withEnsemble(), "Cilaos", undefined, new Date(RUN + 25 * 3600_000)));
    expect(r.jours.some((j: { confiance?: string }) => j.confiance)).toBe(false);
    expect(r.avertissements.some((x: string) => x.startsWith("Confiance :"))).toBe(false);
    expect(r.sources.map((s: { source: string }) => s.source)).not.toContain(ensemble.SOURCE.nom);
  });

  it("is never fetched by a question in the Worker: the scheduled event keeps it", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      throw new Error("no network in tests");
    });
    const { value } = await counted(WORKER_FREE_LIMIT, async () => previsionMeteo(await offlineCache(), "Cilaos", "dans 3 jours", NOW));
    expect(urls.filter((u) => u.includes("ensemble-api"))).toEqual([]);
    expect(body(value).jours.some((j: { confiance?: string }) => j.confiance)).toBe(false);
    expect(SHARED_AFTER.some((s) => s.key === ensemble.KEY)).toBe(true);
  });

  it("reads the run time with the ensemble, and asks once more a request left unanswered, not a refused one", async () => {
    let tries = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/static/meta.json")) return Response.json(meta());
      if (tries++ === 0) throw new Error("timeout");
      return Response.json(fixture("openmeteo_ens_ile.json"));
    });
    const e = await ensemble.build();
    expect(tries).toBe(2);
    expect(e.runAt).toBe(RUN);
    expect(e.cells).toHaveLength(6);

    tries = 0;
    vi.stubGlobal("fetch", async () => {
      tries++;
      return new Response("", { status: 404 });
    });
    await expect(ensemble.build()).rejects.toThrow(/HTTP 404/);
    expect(tries).toBe(2); // the run time and the ensemble, once each
  });

  it("shows on the weather page, one line a day and the warning under the days", () => {
    const prevision = {
      resume: "",
      jours: [{ jour: "samedi 24/10", temperature_min: "18 °C", temperature_max: "25 °C", confiance: "moyenne", confiance_pourquoi: "les scénarios divergent : pluie de 0 à 12 mm" }],
      avertissements: ["Confiance : accord entre les 51 scénarios de l'ensemble du Centre européen."],
      sources: [],
    };
    const html = placePage("https://rundata.re", pageOf("cilaos")!, { value: { prevision }, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain(`<p title="les scénarios divergent : pluie de 0 à 12 mm">Confiance : moyenne</p>`);
    expect(html).toContain(`<p class="note">Confiance : accord entre les 51 scénarios`);
  });
});
