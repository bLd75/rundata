import { describe, expect, it } from "vitest";
import type { Cached } from "../src/cache.js";
import { DAES } from "../src/providers/dae.js";
import { CATEGORIES } from "../src/web/categories.js";
import { communePage } from "../src/web/commune.js";
import { homePage, type HomeLive } from "../src/web/home.js";
import { meteoPage } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";

const NOW = new Date("2026-10-23T14:40:00Z");
const ORIGIN = "https://rundata.re";
const cached = <T>(value: unknown): Cached<T> => ({ value, fetchedAt: new Date(NOW.getTime() - 60_000), stale: false }) as Cached<T>;
const WAIT = "Se met à jour";

// The home page's tiles, by category: « k-dae » → its HTML.
const homeTiles = (page: string) =>
  Object.fromEntries([...page.matchAll(/<li class="tile k-([a-z]+)[^"]*">(.*?)<\/li>/gs)].map((m) => [m[1], m[2]]));

// Copies that came back with nothing to show: the tile says so, from the copy.
const EMPTY: HomeLive = {
  meteo: cached({ stations: [], mer: [], sources: [], indisponibles: [] }),
  volcan: cached({}),
  air: cached({ communes: [] }),
  electricite: cached({}),
  calendrier: cached({}),
  bus: cached({ gares: [] }),
  velos: cached({ stations: [] }),
  bornes: cached({ stations: [] }),
  eau: cached({ baignades: [] }),
  historique: cached({ stations: [] }),
};
// The categories whose copy is not given above: they wait for it.
const NO_COPY = ["vigilance", "trafic", "sentiers", "secheresse", "coupures", "sport", "cyclones", "agenda", "actualites"];
// Nothing to fetch: the lists bundled with the server.
const BUNDLED = ["dae", "enfants"];
// From the weather's copy.
const SEA = ["mer"];

describe("a tile with nothing to show", () => {
  it("says « Se met à jour » on the home page only while its copy is missing", () => {
    const tiles = homeTiles(homePage(ORIGIN, EMPTY, NOW));
    const waiting = Object.entries(tiles).filter(([, html]) => html.includes(WAIT)).map(([k]) => k);
    expect(waiting.sort()).toEqual([...NO_COPY].sort());
  });

  it("says in one line what was read, and when, when the copy has nothing to show", () => {
    const tiles = homeTiles(homePage(ORIGIN, EMPTY, NOW));
    const line = (k: string) => tiles[k].match(/<\/div>(<p class="t[vd](?: all)?">.*?<\/p>)<p class="ta">/s)![1];
    expect(line("meteo")).toBe(`<p class="td all">Aucune température dans la lecture des stations de 18:39.</p>`);
    expect(line("mer")).toBe(`<p class="td all">Pas de mesure satellite de la mer dans la lecture de 18:39.</p>`);
    expect(line("volcan")).toBe(`<p class="td all">Textes de l&#39;OVPF et de la préfecture lus à 18:39 : état du volcan à lire sur la page.</p>`);
    expect(line("velos")).toBe(`<p class="td all">Disponibilités Altervélo absentes de la lecture de 18:39.</p>`);
    expect(line("bornes")).toBe(`<p class="td all">État des bornes absent de la lecture de 18:39.</p>`);
    expect(line("eau")).toBe(`<p class="td all">Résultats de l&#39;ARS absents de la lecture de 18:39.</p>`);
    expect(line("historique")).toBe(`<p class="td all">Rapport à la normale pas encore calculé pour les 30 derniers jours (lecture de 18:39).</p>`);
    expect(line("air")).toBe(`<p class="td all">Indice ATMO du jour pas encore dans la lecture de 18:39.</p>`);
    expect(line("electricite")).toBe(`<p class="td all">Production d&#39;EDF absente de la lecture de 18:39.</p>`);
    expect(line("calendrier")).toBe(`<p class="td all">Ni vacances en cours ni jour férié à venir dans le calendrier lu le 23/10.</p>`);
    // The commune pages' words when no bus is left.
    expect(line("bus")).toBe(`<p class="tv">Pas de départ</p><p class="td">aux gares dans les prochaines heures, d'après les horaires publiés</p>`);
  });

  it("dates a reading of another day", () => {
    const tiles = homeTiles(homePage(ORIGIN, EMPTY, new Date(NOW.getTime() + 24 * 3600_000)));
    expect(tiles.meteo).toContain("Aucune température dans la lecture des stations du 23/10 à 18:39.");
    expect(tiles.volcan).toContain("Textes de l&#39;OVPF et de la préfecture lus le 23/10 à 18:39 : ");
  });

  it("covers every category with a page: a new one needs a value, or its copy listed here", () => {
    const listed = [...Object.keys(EMPTY), ...SEA, ...NO_COPY, ...BUNDLED];
    for (const c of CATEGORIES.filter((x) => x.path)) expect(listed, c.key).toContain(c.key);
    // Without a page, a question to ask.
    for (const c of CATEGORIES.filter((x) => !x.path)) expect(c.exemple, c.key).toBeTruthy();
  });

  it("gives the bundled lists a value even with no copy at all", () => {
    const tiles = homeTiles(homePage(ORIGIN, null, NOW));
    expect(tiles.dae).toContain(`<p class="tv">${DAES.length.toLocaleString("fr-FR").replace(/\s/g, " ")} défibril&shy;lateurs</p>`);
    expect(tiles.dae).toMatch(/<p class="td all">dans les 24 communes, avec leur accès · Géo'DAE du \d\d\/\d\d<\/p>/);
    expect(tiles.enfants).toContain(`<p class="tv">`);
    for (const k of BUNDLED) expect(tiles[k], k).not.toContain(WAIT);
  });

  it("says those lines and the defibrillators' source in full on a phone, the others cut after three lines", () => {
    const tiles = homeTiles(homePage(ORIGIN, EMPTY, NOW));
    expect(tiles.historique).toContain(`<p class="td all">Rapport à la normale`);
    expect(tiles.dae).toContain(`<p class="td all">dans les 24 communes`);
    expect(tiles.bus).toContain(`<p class="td">aux gares`);
  });

  it("keeps an empty copy out of the figures under the home page's title", () => {
    const page = homePage(ORIGIN, EMPTY, NOW);
    const facts = page.match(/<ul class="facts-live"[^>]*>(.*?)<\/ul>/s)?.[1] ?? "";
    expect(facts).not.toContain("Pas de mesure");
    expect(facts).not.toContain("Pas d'indice");
  });

  it("leaves the weather page's figure out when its copy has no temperature", () => {
    expect(meteoPage(ORIGIN, EMPTY.meteo, NOW)).toContain("Les mesures se chargent");
  });

  it("says « Se met à jour » on a commune's page only while its copy is missing", () => {
    const p = pageOf("saint-paul")!;
    const page = communePage(ORIGIN, p, {
      place: cached({ meteo: { stations: [] } }),
      commune: cached({ sources: [] }),
      air: cached({ communes: [] }),
      mer: cached({ plages: [], maree: [] }),
      volcan: cached({}),
      electricite: cached({}),
    }, NOW);
    const tile = (name: string) => page.match(new RegExp(`<h3>(?:<a href="[^"]+">)?${name}(?:</a>)?</h3>(.*?)</li>`, "s"))![1];
    for (const name of ["Météo", "Air", "Mer", "Bus", "Volcan", "Électricité"]) expect(tile(name), name).not.toContain(WAIT);
    expect(tile("Météo")).toContain(`<p class="td all">Aucune température près de Saint-Paul dans la lecture de 18:39.</p>`);
    expect(tile("Air")).toContain(`<p class="td all">Saint-Paul n&#39;est pas dans l&#39;indice ATMO lu à 18:39.</p>`);
    expect(tile("Mer")).toContain(`<p class="td all">Pas de mesure satellite au large de Saint-Paul dans la lecture de 18:39.</p>`);
    expect(tile("Volcan")).toContain("Textes de l&#39;OVPF et de la préfecture lus à 18:39 : état du volcan à lire sur la page.");
    expect(tile("Électricité")).toContain("Production d&#39;EDF absente de la lecture de 18:39.");
    // Its departures not read: never « Pas de départ », which would be wrong.
    expect(tile("Bus")).not.toContain("Pas de départ");
    // No copy of the vigilance, the water notices, the agenda: they wait for it.
    for (const name of ["Vigilance", "Eau", "Sorties"]) expect(tile(name), name).toContain(WAIT);
  });
});
