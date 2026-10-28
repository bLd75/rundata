import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { resolvePlace } from "../src/places/resolve.js";
import * as arome from "../src/providers/arome.js";
import { configure } from "../src/providers/mf-auth.js";
import * as openmeteo from "../src/providers/openmeteo.js";
import { BEYOND, CAVEAT, LABEL, cielDeNuit, etat, merDeNuages, morning, morningStarts, night, nightStarts, softened } from "../src/tools/nuages.js";
import { previsionMeteo, stepSky } from "../src/tools/prevision.js";
import type { Forecast, ForecastHour } from "../src/types.js";
import { randonneesPage } from "../src/web/domains.js";
import { placePage } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";
import { withVolcan } from "../src/web/volcan-alerte.js";

const tif = (f: string) => readFileSync(new URL(`./fixtures/arome/${f}.tif`, import.meta.url));
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const H = 3600_000;

const hour = (time: string, nuages_pct: number, base: number | null, top: number | null): ForecastHour => ({
  time: new Date(time), duree_h: 3, temperature: 12, pluie_mm: 0, code: 1, nuages_pct, vent_kmh: null, rafales_kmh: null, vent_dir: null,
  nuages_base_m: base, nuages_sommet_m: top,
});
const forecast = (hours: ForecastHour[]) => ({ hours }) as Forecast;
const MAIDO = resolvePlace("Maïdo")!.lieu;
// Saturday 24/10, 18:00 in La Réunion: the morning told is tomorrow's.
const EVENING = new Date("2026-10-24T14:00:00Z");
const SIX = "2026-10-25T02:00:00Z"; // 6 h, Sunday
const NINE = "2026-10-25T05:00:00Z"; // 9 h

describe("where a place stands against the cloud sea", () => {
  it("reads the cloud fields' pressures as altitudes, none for a clear cell", () => {
    expect(arome.cloudAltitude(0)).toBeNull();
    expect(arome.cloudAltitude(84220)).toBeGreaterThan(1550);
    expect(arome.cloudAltitude(84220)).toBeLessThan(1700);
    expect(arome.cloudLayer(84220, 81442)).toEqual({ base: arome.cloudAltitude(84220), top: arome.cloudAltitude(81442) });
    // A top under the base is the fields disagreeing: not said.
    expect(arome.cloudLayer(81130, 0).top).toBeNull();
  });

  it("gives the five states in marketing's order", () => {
    expect(etat(hour(SIX, 10, 1200, 1800), 2190)?.etat).toBe("degage");
    expect(etat(hour(SIX, 80, 1200, 1800), 2190)).toEqual({ etat: "dessus", texte: "au-dessus de la mer de nuages (nuages entre 1 200 et 1 800 m)" });
    expect(etat(hour(SIX, 80, 1200, 2130), 2190)).toEqual({ etat: "bord", texte: "au bord de la mer de nuages (nuages jusqu'à 2 100 m)" });
    expect(etat(hour(SIX, 80, 1200, 2300), 2190)?.etat).toBe("dans");
    expect(etat(hour(SIX, 80, 2400, 2900), 2190)).toEqual({ etat: "sous", texte: "sous les nuages (à partir de 2 400 m)" });
  });

  it("says a layer thinner than the rounding at one height, never « entre 1 900 et 1 900 m »", () => {
    expect(etat(hour(SIX, 80, 1860, 1940), 2190)).toEqual({ etat: "dessus", texte: "au-dessus de la mer de nuages (nuages vers 1 900 m)" });
    expect(etat(hour(SIX, 80, 1860, 1940), 1900)).toEqual({ etat: "dans", texte: "dans les nuages (vers 1 900 m)" });
    // A hundred apart once rounded: still from one to the other.
    expect(etat(hour(SIX, 80, 1840, 1960), 2190)?.texte).toBe("au-dessus de la mer de nuages (nuages entre 1 800 et 2 000 m)");
  });

  it("says nothing of a step without AROME's layer, and keeps high clouds out of the cloud sea", () => {
    const ifs = { ...hour(SIX, 80, null, null) };
    delete ifs.nuages_base_m;
    expect(etat(ifs, 2190)).toBeNull();
    expect(etat(hour(SIX, 60, 12000, 13000), 2190)).toEqual({ etat: "degage", texte: "dégagé sous des nuages élevés" });
    // A top of deep clouds is not the cloud sea's: inside, from the base up.
    expect(etat(hour(SIX, 80, 2000, 13000), 2190)?.texte).toBe("dans les nuages (à partir de 2 000 m)");
  });

  it("tells this morning before noon, what is left of it, and tomorrow's after", () => {
    expect(morning(new Date("2026-10-24T03:00:00Z"))).toMatchObject({ libelle: "ce matin", de: [6, 9] });
    expect(morning(new Date("2026-10-24T06:00:00Z"))).toMatchObject({ libelle: "ce matin", de: [9] });
    expect(morning(EVENING)).toMatchObject({ libelle: "demain matin", jour: "2026-10-25", de: [6, 9] });
    expect(morningStarts(EVENING).map((t) => t.toISOString())).toEqual(["2026-10-25T02:00:00.000Z", "2026-10-25T05:00:00.000Z"]);
  });

  it("says the view closes when the cloud sea rises over the place during the morning", () => {
    const mn = merDeNuages(forecast([hour(SIX, 80, 1200, 1800), hour(NINE, 90, 1400, 2300)]), MAIDO, EVENING)!;
    expect(mn.titre).toBe("Mer de nuages demain matin");
    expect(mn.resume).toBe(
      "Maïdo (2 197 m), demain matin : de 6 h à 9 h, au-dessus de la mer de nuages (nuages entre 1 200 et 1 800 m)\u00a0; " +
        "de 9 h à 12 h, dans les nuages (entre 1 400 et 2 300 m). La vue se ferme dans la matinée, selon le modèle.",
    );
    expect(mn).toMatchObject({ prevision: LABEL, mise_en_garde: CAVEAT });
  });

  it("says the view closes only into the clouds, not under them", () => {
    const under = merDeNuages(forecast([hour(SIX, 10, null, null), hour(NINE, 90, 2400, 2900)]), MAIDO, EVENING)!;
    expect(under.ligne).toBe("De 6\u00a0h à 9\u00a0h, dégagé\u00a0; de 9\u00a0h à 12\u00a0h, sous les nuages (à partir de 2\u202f400\u00a0m).");
  });

  it("puts the place's words before its altitude, in one pair of brackets", () => {
    const p = resolvePlace("Pas de Bellecombe")!.lieu;
    const mn = merDeNuages(forecast([hour(SIX, 10, null, null), hour(NINE, 10, null, null)]), p, EVENING, { nom: "Pas de Bellecombe", precision: "volcan" })!;
    expect(mn.resume).toMatch(/^Pas de Bellecombe \(volcan, 2\u202f\d{3}\u00a0m\), demain matin : de 6\u00a0h à 12\u00a0h, dégagé\.$/);
  });

  it("merges two windows of the same state", () => {
    const mn = merDeNuages(forecast([hour(SIX, 80, 1200, 1800), hour(NINE, 85, 1200, 1800)]), MAIDO, EVENING)!;
    expect(mn.ligne).toBe("De 6 h à 12 h, au-dessus de la mer de nuages (nuages entre 1 200 et 1 800 m).");
  });

  it("is not given below the Hauts, nor for half a morning", () => {
    const low = { ...MAIDO, altitude_m: 300 };
    expect(merDeNuages(forecast([hour(SIX, 80, 1200, 1800), hour(NINE, 85, 1200, 1800)]), low, EVENING)).toBeNull();
    expect(merDeNuages(forecast([hour(SIX, 80, 1200, 1800)]), MAIDO, EVENING)).toBeNull();
  });

  it("does not state an open sky as a fact while a station near by measures the air saturated now", () => {
    const now = new Date("2026-10-25T03:00:00Z"); // 7 h
    const mn = merDeNuages(forecast([hour(SIX, 10, null, null), hour(NINE, 85, 1200, 1800)]), MAIDO, now)!;
    const wet = softened(mn, now, { nom: "Le Maïdo", humidite: 98, mesure: new Date(now.getTime() - 10 * 60_000) });
    expect(wet.ligne).toContain("dégagé selon le modèle, mais la station de Le Maïdo mesure 98 % d'humidité à 06:50 : nuages ou brouillard possibles");
    // An old reading, a dry one, or tomorrow's morning: as it is.
    expect(softened(mn, now, { nom: "Le Maïdo", humidite: 98, mesure: new Date(now.getTime() - 2 * H) })).toBe(mn);
    expect(softened(mn, now, { nom: "Le Maïdo", humidite: 80, mesure: now })).toBe(mn);
    const tomorrow = merDeNuages(forecast([hour(SIX, 10, null, null), hour(NINE, 85, 1200, 1800)]), MAIDO, EVENING)!;
    expect(softened(tomorrow, EVENING, { nom: "Le Maïdo", humidite: 99, mesure: EVENING })).toBe(tomorrow);
  });
});

describe("the sky of the night", () => {
  // Saturday 24/10 in La Réunion: 18 h, 18 h, 21 h, midnight, 3 h.
  const steps = ["2026-10-24T14:00:00Z", "2026-10-24T17:00:00Z", "2026-10-24T20:00:00Z", "2026-10-24T23:00:00Z"];
  const SAINT_PAUL = resolvePlace("Saint-Paul")!.lieu;

  it("tells tonight from 18 h to 6 h, only what is left of it, the night under way before 6 h, and tomorrow's when asked", () => {
    expect(night(EVENING)).toEqual({ libelle: "ce soir et cette nuit", starts: steps.map((s) => new Date(s)) });
    expect(night(new Date("2026-10-24T18:30:00Z"))?.libelle).toBe("cette nuit");
    expect(nightStarts(new Date("2026-10-24T22:10:00Z"))).toEqual([new Date(steps[2]), new Date(steps[3])]);
    expect(night(EVENING, "2026-10-25")?.libelle).toBe("demain soir et la nuit suivante");
    // AROME's two days: no night told further.
    expect(night(EVENING, "2026-10-27")).toBeNull();
  });

  it("says the Hauts above, in or under the clouds, and below them the cloud cover, the same state in a row once", () => {
    const f = forecast([hour(steps[0], 80, 1200, 1800), hour(steps[1], 10, null, null), hour(steps[2], 10, null, null), hour(steps[3], 90, 1500, 2600)]);
    const hauts = cielDeNuit(f, MAIDO, EVENING)!;
    expect(hauts.fenetres.map((w) => w.etat)).toEqual(["dessus", "degage", "dans"]);
    // The words of the cloud sea, as etat() says them (thousands and unit with non-breaking spaces).
    const over = etat(hour(steps[0], 80, 1200, 1800), 2190)!.texte;
    const inside = etat(hour(steps[3], 90, 1500, 2600), 2190)!.texte;
    expect(hauts.ligne).toBe(`De 18\u00a0h à 21\u00a0h, ${over}\u00a0; de 21\u00a0h à 3\u00a0h, dégagé\u00a0; de 3\u00a0h à 6\u00a0h, ${inside}.`);
    expect(inside).toMatch(/^dans les nuages \(entre 1.500 et 2.600.m\)$/);
    expect(hauts.titre).toBe("Ciel ce soir et cette nuit");
    const bas = cielDeNuit(f, SAINT_PAUL, EVENING)!;
    expect(bas.ligne).toBe("De 18\u00a0h à 21\u00a0h, couvert\u00a0; de 21\u00a0h à 3\u00a0h, dégagé\u00a0; de 3\u00a0h à 6\u00a0h, couvert.");
    expect(bas.resume).toMatch(/^Saint-Paul \(\d+\u00a0m\), ce soir et cette nuit : de 18/);
    expect(bas.prevision).toBe(LABEL);
    expect(bas.mise_en_garde).toBe(CAVEAT);
  });

  it("says rain, and nothing for a night with a step out of AROME", () => {
    const wet = { ...hour(steps[1], 100, 600, 3000), pluie_mm: 2.4 };
    const f = forecast([hour(steps[0], 50, 900, 1500), wet, hour(steps[2], 10, null, null), hour(steps[3], 10, null, null)]);
    expect(cielDeNuit(f, SAINT_PAUL, EVENING)!.fenetres.map((w) => w.texte)).toEqual(["partiellement nuageux", "pluie prévue", "dégagé"]);
    const ifs = { ...hour(steps[3], 10, null, null) };
    delete ifs.nuages_base_m;
    expect(cielDeNuit(forecast([hour(steps[0], 10, null, null), hour(steps[1], 10, null, null), hour(steps[2], 10, null, null), ifs]), SAINT_PAUL, EVENING)).toBeNull();
  });
});

describe("the sky of three hours under high clouds", () => {
  const MIDNIGHT = "2026-10-24T20:00:00Z";
  const high = { ...hour(MIDNIGHT, 90, 12000, 13000), code: 3 };

  it("says the overcast is of high clouds, which the night of the Hauts says open under them", () => {
    expect(stepSky([high], 3)).toBe("couvert (nuages élevés)");
    expect(stepSky([{ ...high, nuages_pct: 60, code: 2 }], 2)).toBe("partiellement nuageux (nuages élevés)");
    expect(cielDeNuit(forecast([hour("2026-10-24T14:00:00Z", 10, null, null), hour("2026-10-24T17:00:00Z", 10, null, null), high, { ...high, time: new Date("2026-10-24T23:00:00Z") }]), MAIDO, EVENING)!.ligne)
      .toBe("De 18\u00a0h à minuit, dégagé\u00a0; de minuit à 6\u00a0h, voilé par des nuages élevés, sans nuages plus bas.");
  });

  it("says the night veiled from 80 % of high clouds, never « degage », and open under them below that", () => {
    const evening = ["2026-10-24T14:00:00Z", "2026-10-24T17:00:00Z"].map((t) => hour(t, 10, null, null));
    const night = (pct: number) => forecast([...evening, { ...high, nuages_pct: pct }, { ...high, nuages_pct: pct, time: new Date("2026-10-24T23:00:00Z") }]);
    const veiled = cielDeNuit(night(80), MAIDO, EVENING)!;
    expect(veiled.fenetres.at(-1)).toEqual({ de: 0, a: 6, etat: "voile", texte: "voilé par des nuages élevés, sans nuages plus bas" });
    expect(cielDeNuit(night(79), MAIDO, EVENING)!.fenetres.at(-1)).toMatchObject({ etat: "degage", texte: "dégagé sous des nuages élevés" });
    // Below the Hauts, the cloud cover alone, as before.
    expect(cielDeNuit(night(90), resolvePlace("Saint-Paul")!.lieu, EVENING)!.fenetres.at(-1)).toMatchObject({ etat: "couvert", texte: "couvert" });
    // The morning's cloud sea keeps its words.
    expect(etat(high, 2190)).toEqual({ etat: "degage", texte: "dégagé sous des nuages élevés" });
  });

  it("keeps the plain word for low clouds, rain, a clear sky, or a step without AROME's cloud base", () => {
    expect(stepSky([{ ...high, nuages_base_m: 1500, nuages_sommet_m: 2600 }], 3)).toBe("couvert");
    expect(stepSky([{ ...high, pluie_mm: 1.2, code: 61 }], 61)).toBe("pluie faible");
    expect(stepSky([{ ...high, nuages_pct: 10, code: 0 }], 0)).toBe("ciel dégagé");
    const ifs = { ...high };
    delete ifs.nuages_base_m;
    expect(stepSky([ifs], 3)).toBe("couvert");
  });
});

describe("prevision_meteo in the Hauts", () => {
  // Grids recorded from the AROME run of 24/10/2026 06:00 UTC, for Sunday 25 at 7 h and 10 h in La Réunion.
  const RUN = new Date("2026-10-24T06:00:00Z");
  afterEach(() => {
    vi.unstubAllGlobals();
    configure({});
  });

  async function offline() {
    const store = new MemoryStore();
    const at = EVENING.getTime();
    await store.put("arome:calculs", { value: { liste: { value: [RUN.toISOString()], fetchedAt: at } }, fetchedAt: at });
    const relief = arome.relief(arome.parseGrid(tif("ps")), arome.parseGrid(tif("pmsl")), arome.parseGrid(tif("t2m0")));
    const bundle: Record<string, { value: unknown; fetchedAt: number }> = { relief: { value: arome.pack(relief), fetchedAt: at } };
    // Tonight's steps, 18 h to 6 h, with the same recorded fields (what matters here is that the answer reads them).
    const nights = [["2026-10-24T14:00:00Z", "03"], ["2026-10-24T17:00:00Z", "03"], ["2026-10-24T20:00:00Z", "06"], ["2026-10-24T23:00:00Z", "06"]] as const;
    for (const [start, hh] of [[SIX, "03"], [NINE, "06"], ...nights] as const) {
      const t = new Date(start).getTime();
      const put = (field: string, file: string, h: number) =>
        (bundle[arome.gridKey(field, new Date(t + h * H))] = { value: arome.pack(arome.parseGrid(tif(file))), fetchedAt: at });
      put("temperature", "t2m", 0);
      put("nuages", `cloud_25_${hh}z`, 1);
      put("base", `cloudbase_25_${hh}z`, 1);
      put("sommet", `cloudtop_25_${hh}z`, 1);
      put("rafales", "gust", 2);
      put("pluie", "rain3h", 3);
      put("foudre", "lightning3h", 3);
    }
    await store.put(arome.bundleKey(RUN), { value: bundle, fetchedAt: at });
    // ECMWF for the days after AROME's (Cilaos' recorded answer, at the Maïdo).
    await store.put(openmeteo.cacheKey(MAIDO), { value: JSON.parse(readFileSync(new URL("./fixtures/openmeteo_cilaos.json", import.meta.url), "utf8")), fetchedAt: at });
    return new Cache(store, () => at);
  }

  it("answers « dégagé au Maïdo demain matin ? » with the cloud sea of the model's cell, labelled", async () => {
    configure({ token: "test" });
    vi.stubGlobal("fetch", async () => {
      throw new Error("no network in tests");
    });
    const r = body(await previsionMeteo(await offline(), "Maïdo", "demain matin", EVENING));
    expect(r.mer_de_nuages.fenetres.map((w: { etat: string }) => w.etat)).toEqual(["degage", "dans"]);
    expect(r.mer_de_nuages.ligne).toMatch(/^De 6 h à 9 h, dégagé\u00a0; de 9 h à 12 h, dans les nuages \(à partir de 2 \d00 m\)\. La vue se ferme/);
    expect(r.resume).toContain(`Mer de nuages, ${LABEL} : Maïdo (2\u202f197\u00a0m), demain matin : de 6\u00a0h à 9\u00a0h, dégagé`);
    expect(r.mer_de_nuages.mise_en_garde).toBe(CAVEAT);
  });

  it("answers « dégagé ce soir au Maïdo ? » with the sky of the night, labelled, without asking for anything", async () => {
    configure({ token: "test" });
    vi.stubGlobal("fetch", async () => {
      throw new Error("no network in tests");
    });
    const r = body(await previsionMeteo(await offline(), "Maïdo", "ce soir", EVENING));
    expect(r.ciel_de_nuit.titre).toBe("Ciel ce soir et cette nuit");
    expect(r.ciel_de_nuit.fenetres.length).toBeGreaterThan(0);
    expect(r.ciel_de_nuit.fenetres.at(-1).a).toBe(6);
    expect(r.resume).toContain(`Ciel de nuit, ${LABEL} : Maïdo (2\u202f197\u00a0m), ce soir et cette nuit : de 18\u00a0h à `);
    // Not for a morning.
    expect(body(await previsionMeteo(await offline(), "Maïdo", "demain matin", EVENING)).ciel_de_nuit).toBeUndefined();
  });

  it("says the cloud sea is not forecast beyond AROME's two days", async () => {
    configure({ token: "test" });
    vi.stubGlobal("fetch", async () => {
      throw new Error("no network in tests");
    });
    const r = body(await previsionMeteo(await offline(), "Maïdo", "mercredi", EVENING));
    expect(r.avertissements).toContain(BEYOND);
  });
});

describe("the cloud sea on the site", () => {
  const mn = merDeNuages(forecast([hour(SIX, 80, 1200, 1800), hour(NINE, 90, 1400, 2300)]), MAIDO, EVENING)!;

  it("has its card on the Maïdo's page, right after the measurement, labelled", () => {
    const p = pageOf("maido")!;
    const station = { station: "Le Maïdo", source: "Météo-France", altitude_m: 2150, heure_mesure: "24/10 17:54", age_min: 6, mesures: { temperature: "9,1 °C", humidite: "99 %" }, avertissements: [] };
    const data = { value: { meteo: { resume: "", stations: [station], sources: [] }, prevision: { resume: "", sources: [], mer_de_nuages: mn } }, fetchedAt: EVENING, stale: false };
    const html = placePage("https://rundata.re", p, data, EVENING);
    expect(html).toContain('<section id="mer-de-nuages" class="card" aria-labelledby="h-nuages"><h3 id="h-nuages">Mer de nuages demain matin</h3>');
    expect(html.indexOf("mer-de-nuages")).toBeLessThan(html.indexOf("h-ia"));
    expect(html).toContain("Prévision du modèle AROME de Météo-France (carrés de 2,5 km).");
    // Tomorrow's morning: a reading of now says nothing of it.
    expect(html).not.toContain("selon le modèle, mais");
  });

  it("lists the Hauts on /randonnees, each name linked to its weather page", () => {
    const hauts = [{ nom: "Maïdo", slug: "maido", ...mn }, { nom: "Piton des Neiges", ...merDeNuages(forecast([hour(SIX, 80, 1200, 1800), hour(NINE, 90, 1400, 2300)]), resolvePlace("Piton des Neiges")!.lieu, EVENING)! }];
    const data = { value: { randonnees: [], secteurs: [], lignes: [], fermes: 0, suivis: 0, sources: [], hauts }, fetchedAt: EVENING, stale: false };
    const html = randonneesPage("https://rundata.re", data, EVENING);
    expect(html).toContain("Les Hauts demain matin : au-dessus ou dans les nuages ?");
    expect(html).toContain('<li><a href="/meteo/maido#mer-de-nuages">Maïdo</a> (2');
    expect(html).toContain("<li>Piton des Neiges (3");
    expect(html).toContain("Prévision, pas une mesure. Le modèle voit l&#39;île par carrés de 2,5 km");
  });

  it("says the Enclos is forbidden at the Pas de Bellecombe during a volcano alert, there only", () => {
    const p = resolvePlace("Pas de Bellecombe")!.lieu;
    const clear = merDeNuages(forecast([hour(SIX, 10, null, null), hour(NINE, 10, null, null)]), p, EVENING, { nom: "Pas de Bellecombe", precision: "volcan" })!;
    const hauts = [{ nom: "Maïdo", slug: "maido", ...mn }, { nom: "Pas de Bellecombe", slug: "piton-de-la-fournaise", enclos: true, ...clear }];
    const data = { value: { randonnees: [], secteurs: [], lignes: [], fermes: 0, suivis: 0, sources: [], hauts }, fetchedAt: EVENING, stale: false };
    const quiet = randonneesPage("https://rundata.re", data, EVENING);
    expect(quiet).not.toContain("Enclos interdit");
    // What the texts say there, linked from the viewpoint's line alone, alert or not.
    const monter = `<a href="/volcan#monter">Puis-je monter au volcan ? →</a></li>`;
    expect(quiet).toContain(`de 6\u00a0h à 12\u00a0h, dégagé. ${monter}`);
    const alert = withVolcan({ niveau: "Alerte 1", eruption: false }, () => randonneesPage("https://rundata.re", data, EVENING));
    expect(alert).toContain(`de 6\u00a0h à 12\u00a0h, dégagé. Accès à l&#39;Enclos interdit. ${monter}`);
    expect(alert.match(/Enclos interdit\.(?: <a [^>]*>[^<]*<\/a>)?<\/li>/g)).toHaveLength(1);
    expect(alert.match(/\/volcan#monter/g)).toHaveLength(1);
  });
});
