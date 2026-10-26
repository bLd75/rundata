import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { resolvePlace } from "../src/places/resolve.js";
import { counted, PAGE_BUDGET } from "../src/budget.js";
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
    expect(r.avertissements.join(" ")).toMatch(/altitude de Cilaos \(1\u202f209 m\)/);
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

describe("today, from the hours still to come", () => {
  // Cilaos's forecast of the fixture, with 9,6 mm in the night (2h–5h, showers at 6h), 1,2 mm at 10h and 0,4 mm at 15h:
  // the model's total for the day says 11,2 mm. Open-Meteo gives each hour's rain on the next one (openmeteo.parse).
  async function wetCache(at: Date) {
    const j = fixture("openmeteo_cilaos.json");
    for (const i of [3, 4, 5]) j.hourly.precipitation[i] = 3.2;
    j.hourly.precipitation[11] = 1.2;
    j.hourly.precipitation[16] = 0.4;
    j.hourly.weather_code[6] = 81;
    j.daily.precipitation_sum[0] = 11.2;
    j.daily.weather_code[0] = 81;
    const store = new MemoryStore();
    await store.put(openmeteo.cacheKey(resolvePlace("Cilaos")!.lieu), { value: j, fetchedAt: at.getTime() });
    await store.put("openmeteo:meta", { value: fixture("openmeteo_meta.json"), fetchedAt: at.getTime() });
    return new Cache(store, () => at.getTime());
  }

  it("leaves out the rain already fallen, in the day and in the summary", async () => {
    const at = new Date("2026-10-22T06:00:00Z"); // 10:00 in La Réunion
    const r = body(await previsionMeteo(await wetCache(at), "Cilaos", undefined, at));
    expect(r.jours[0]).toMatchObject({ jour: "jeudi 22/10", pluie: "1,6 mm de pluie", ciel_en_journee: "ciel dégagé" });
    expect(r.resume).toContain("aujourd'hui : ciel dégagé, ");
    expect(r.resume).toContain(", 1,6 mm de pluie");
    expect(r.resume).not.toMatch(/11,2 mm|averses/);
    // The day's lowest and highest temperatures, the night's included.
    const dry = body(await previsionMeteo(await offlineCache(), "Cilaos", undefined, NOW)).jours[0];
    expect([r.jours[0].temperature_min, r.jours[0].temperature_max]).toEqual([dry.temperature_min, dry.temperature_max]);
    expect(dry.temperature_min).toMatch(/^11 /);
    // Tomorrow is the model's day, untouched.
    expect(r.jours[1].pluie).toBe(body(await previsionMeteo(await offlineCache(), "Cilaos", "demain", NOW)).jours[0].pluie);
  });

  it("counts the hour under way for the part left of it", async () => {
    const at = new Date("2026-10-22T06:30:00Z"); // 10:30: half of 10h–11h's 1,2 mm is still to come
    const r = body(await previsionMeteo(await wetCache(at), "Cilaos", "aujourd'hui", at));
    expect(r.jours[0].pluie).toBe("1 mm de pluie");
    const late = new Date("2026-10-22T12:00:00Z"); // 16:00: nothing left
    expect(body(await previsionMeteo(await wetCache(late), "Cilaos", "aujourd'hui", late)).jours[0].pluie).toBe("pas de pluie prévue");
  });

  it("does the same on the tour of the island", async () => {
    const at = new Date("2026-10-22T06:00:00Z");
    const r = body(await previsionMeteo(await wetCache(at), undefined, undefined, at));
    expect(r.lieux[0].jours[0].pluie).toBe("1,6 mm de pluie");
    expect(r.resume).toContain("Cilaos : aujourd'hui ciel dégagé, ");
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

  it("shortens the reason for a day's card: the same gaps, maximum, rain, gusts, then the heavy rain, each number held to its unit", () => {
    const e = ens();
    const nb = (s: string) => s.replace(/ (°C|mm|km\/h)/g, "\u00a0$1");
    expect(ensemble.cardReason(ensemble.confidence(e.cells[0].days[6]).pourquoi)).toBe(nb("Écarts entre scénarios : 3,3 °C sur le maximum, 33 mm de pluie, 31 km/h de rafales. 7 scénarios sur 51 à 20 mm ou plus."));
    expect(ensemble.cardReason("les scénarios divergent sur le carré de 25 km : 11 mm d'écart sur la pluie")).toBe(nb("Écarts entre scénarios : 11 mm de pluie."));
    expect(ensemble.cardReason("les scénarios divergent sur le carré de 25 km : 4 scénarios sur 51 donnent 20 mm de pluie ou plus")).toBe(nb("4 scénarios sur 51 à 20 mm de pluie ou plus."));
    expect(ensemble.cardReason("les scénarios s'accordent (1,2 °C d'écart sur le maximum, pluie et vent sans grand écart)")).toBeUndefined();
    // Every day of the run that is not sure has its short reason, with as many gaps as its full one.
    for (const c of e.cells) for (const d of c.days) {
      const { niveau, pourquoi } = ensemble.confidence(d);
      const short = ensemble.cardReason(pourquoi);
      if (niveau === "forte") expect(short).toBeUndefined();
      else expect(short!.split(/, |\. /).length).toBe(pourquoi.split(" : ")[1].split(", ").length);
    }
  });

  it("gives each day covered its confidence, with the warning, the run and the credit", async () => {
    const r = body(await previsionMeteo(await withEnsemble(), "Cilaos", undefined, NOW));
    const byDay = Object.fromEntries(r.jours.map((j: { jour: string; confiance?: string }) => [j.jour, j.confiance]));
    expect(byDay["jeudi 22/10"]).toBeUndefined(); // before the ensemble's first day
    expect(byDay["samedi 24/10"]).toMatch(/^(forte|moyenne|faible)$/);
    expect(r.jours.find((j: { jour: string }) => j.jour === "samedi 24/10").confiance_pourquoi).toMatch(/^les scénarios/);
    expect(r.resume).toMatch(/\(confiance (forte|moyenne|faible)\)/);
    const w = r.avertissements.find((x: string) => x.startsWith("Confiance :"));
    expect(w).toBe("Confiance : elle dit si les 51 scénarios du Centre européen de prévision (ECMWF) s'accordent, sur un carré d'environ 25 km (calcul du 23/10 à 22:00). Ce n'est pas la probabilité que la prévision soit juste, et ces scénarios ne viennent pas du modèle de la prévision affichée. Confiance faible : les scénarios divergent, revoyez la prévision plus près du jour.");
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
    const { value } = await counted(PAGE_BUDGET, async () => previsionMeteo(await offlineCache(), "Cilaos", "dans 3 jours", NOW));
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

  it("shows on the weather page, one line a day, why a day is not sure in plain sight, and the warning under the days", () => {
    const prevision = {
      resume: "",
      jours: [
        { jour: "samedi 24/10", temperature_min: "18 °C", temperature_max: "25 °C", confiance: "moyenne", confiance_pourquoi: "les scénarios divergent sur le carré de 25 km : 12 mm d'écart sur la pluie" },
        { jour: "dimanche 25/10", temperature_min: "18 °C", temperature_max: "26 °C", confiance: "forte", confiance_pourquoi: "les scénarios s'accordent (1,2 °C d'écart sur le maximum, pluie et vent sans grand écart)" },
      ],
      avertissements: ["Confiance : accord entre les 51 scénarios de l'ensemble du Centre européen."],
      sources: [],
    };
    const html = placePage("https://rundata.re", pageOf("cilaos")!, { value: { prevision }, fetchedAt: NOW, stale: false }, NOW);
    // A phone shows no title: the reason is under the day, short, and a sure day says nothing more.
    expect(html).toContain(`<p>Confiance : <b>moyenne</b></p><p class="why">Écarts entre scénarios : 12\u00a0mm de pluie.</p>`);
    expect(html).toContain(`<p>Confiance : <b>forte</b></p></li>`);
    expect(html).not.toContain("s&#39;accordent (1,2");
    expect(html).not.toContain(`title="les scénarios`);
    expect(html).toContain(`<p class="note">Confiance : accord entre les 51 scénarios`);
  });
});
