import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { merge, parseInfo } from "../src/providers/velos.js";
import { velosLibreService } from "../src/tools/velos.js";
import { velosPage } from "../src/web/domains.js";
import { DESCRIPTION_MAX } from "../src/web/pages.js";
import { deadAnchors, doubleIds, mapLinks } from "./cartes.js";

// Eight Altervélo stations on the night of 23 to 24/10/2026 (the operator's test station among them); one is set not
// renting, and one given a scooter, to cover both.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")).data.stations;
const stations = parseInfo(fixture("altervelo_station_information.json"));
const status = fixture("altervelo_station_status.json");
const NOW = new Date("2026-10-23T20:35:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
function cache() {
  const store = new MemoryStore();
  void store.put("velos:info", { value: stations, fetchedAt: NOW.getTime() });
  void store.put("velos:status", { value: status, fetchedAt: NOW.getTime() });
  return new Cache(store, () => NOW.getTime());
}

describe("Altervélo", () => {
  it("drops the test station and finds each station's commune", () => {
    expect(stations.map((s) => s.nom)).not.toContain("TEST");
    const at = Object.fromEntries(stations.map((s) => [s.nom, s.commune]));
    expect(at["IUT"]).toBe("Saint-Pierre");
    expect(at["Pôle d'échanges de Saint-Louis"]).toBe("Saint-Louis");
    expect(at["Village Roche Carangue"]).toBe("L'Étang-Salé");
  });

  it("counts bikes and scooters apart", () => {
    const s = merge(stations, status).find((x) => x.nom === "ZAC Maxime Rivière")!;
    expect([s.velos, s.trottinettes, s.places]).toEqual([6, 1, 4]);
  });

  it("answers for a station by its name", async () => {
    const r = body(await velosLibreService(cache(), "il reste des vélos à la station IUT ?", NOW));
    expect(r.resume).toBe("Station Altervélo IUT (Saint-Pierre) : aucun vélo et 8 places libres.");
  });

  it("gives the nearest stations to a place, and the nearest with a bike", async () => {
    const r = body(await velosLibreService(cache(), "plage de Terre Sainte", NOW));
    expect(r.resume).toMatch(/^Station Altervélo la plus proche de Terre Sainte : Eglise de Terre Sainte, à \d+ m : aucun vélo/);
    expect(r.stations.find((s: { nom: string }) => s.nom === "Stade de Terre Sainte").etat).toBe("location impossible en ce moment");
  });

  it("lists a commune's stations, those with bikes first", async () => {
    const r = body(await velosLibreService(cache(), "Saint-Pierre", NOW));
    expect(r.resume).toBe("Altervélo à Saint-Pierre : 7 vélos disponibles dans 4 stations, dont ZAC Maxime Rivière (6 vélos électriques, 1 trottinette et 4 places libres).");
    expect(r.stations[0].nom).toBe("ZAC Maxime Rivière");
  });

  it("says where the service is when the place has none", async () => {
    const r = body(await velosLibreService(cache(), "Saint-Denis", NOW));
    expect(r.resume).toMatch(/^Pas de vélo en libre-service Altervélo à Saint-Denis : le service ne couvre que Saint-Pierre, Saint-Louis, L'Étang-Salé\./);
  });

  it("sums up the network", async () => {
    const r = body(await velosLibreService(cache(), undefined, NOW));
    expect(r.resume).toBe("Altervélo en ce moment : 19 vélos disponibles dans 6 stations ouvertes (Saint-Pierre 7, Saint-Louis 0, L'Étang-Salé 12).");
  });

  it("makes a page of the network, station by station", async () => {
    const value = body(await velosLibreService(cache(), undefined, NOW));
    const html = velosPage("https://rundata.re", { value, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain(`<span class="big">19</span>`);
    // Each commune served leads to its stations.
    expect(mapLinks(html).map((l) => l.href)).toEqual(["#c-l-etang-sale", "#c-saint-louis", "#c-saint-pierre"]);
    // Each commune has its bubble (marketing's charter of the maps): those served, their bikes and their link; the others,
    // no station. The legend draws the colour, then when the stations were read.
    expect(html).toMatch(/<a class="zn" href="#c-saint-pierre" aria-label="Saint-Pierre : 7\u00a0vélos disponibles, voir le détail" data-pn="Saint-Pierre" data-p2="7\u00a0vélos disponibles" data-pv="commune">/);
    expect(html).toContain('<a class="zn" tabindex="-1" aria-hidden="true" data-pn="Le Tampon" data-p2="pas de station Altervélo">');
    expect(html).toContain('<rect x="-30" y="-30" width="60" height="60" rx="8" style="fill:var(--hl)"/></svg>commune desservie par Altervélo</span>');
    expect(html).toContain('<span class="mls">Vélos disponibles d&#39;après les stations, relevé de 00:35.</span>');
    expect(deadAnchors(html)).toEqual([]);
    expect(doubleIds(html)).toEqual([]);
    expect(html).toContain("<li><span>ZAC Maxime Rivière</span><span><b>6</b>\u00a0vélos · <b>1</b>\u00a0trottinette · 4\u00a0places</span></li>");
    expect(html).toContain("<li><span>Stade de Terre Sainte</span><span>location impossible en ce moment</span></li>");
    // A count stays with its word at the end of a line (marketing).
    expect(html).toContain('Saint-Pierre <span class="note">7\u00a0vélos, 4\u00a0stations</span>');
    const desc = html.match(/name="description" content="([^"]*)"/)![1];
    expect(desc.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("keeps each station's position for the page's « Y aller », never in the tool's answer", async () => {
    expect(JSON.stringify(body(await velosLibreService(cache(), undefined, NOW)))).not.toContain('"lat"');
    const value = body(await velosLibreService(cache(), undefined, NOW, true));
    expect(value.stations.every((s: { lat?: number; lon?: number }) => Number.isFinite(s.lat) && Number.isFinite(s.lon))).toBe(true);
    const html = velosPage("https://rundata.re", { value, fetchedAt: NOW, stale: false }, NOW);
    expect(html.match(/class="aller"/g)).toHaveLength(value.stations.length);
    expect(html.match(/<dialog id="aller"/g)).toHaveLength(1);
  });
});
