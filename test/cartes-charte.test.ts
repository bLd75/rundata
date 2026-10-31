import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMON } from "../src/tools/eau.js";
import { communePage } from "../src/web/commune.js";
import { coupuresCommunePage } from "../src/web/coupures.js";
import { buildDae, type EauAnswer, type HistoriqueAnswer, type SeaData } from "../src/web/data.js";
import { calendrierPage, daePage, eauPage, historiquePage, traficPage, volcanPage } from "../src/web/domains.js";
import { enfantsPage } from "../src/web/enfants.js";
import { CSS, seaPage } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";

// The charter of the maps (marketing, 31/10/2026): the same kind of map, the same look.
const ORIGIN = "https://rundata.re";
const NOW = new Date("2026-10-24T06:00:00Z");
const cached = <T>(value: T) => ({ value, fetchedAt: NOW, stale: false });
const answer = (tool: string) => JSON.parse(readFileSync(new URL(`./fixtures/pages/${tool}.json`, import.meta.url), "utf8"));
/** The figure holding the page's island map. */
const figure = (html: string) => html.match(/<figure class="card mapcard[^"]*">(?:(?!<\/figure>).)*?<svg class="map(?:(?!<\/figure>).)*<\/figure>/s)?.[0] ?? "";

describe("the charter of the maps", () => {
  it("hides the summits' names on a phone, where they would be under 11 px", () => {
    expect(CSS).toContain("@media (max-width:40rem){.map .mn,.map .pk{display:none}}");
  });

  it("keeps a landmark map off a phone, and has none on /calendrier", () => {
    expect(communePage(ORIGIN, pageOf("cilaos")!, { place: null })).toContain('<figure class="card mapcard nophone"><svg class="map terrain"');
    expect(coupuresCommunePage(ORIGIN, pageOf("saint-paul")!, { coupures: null }, NOW)).toContain('<figure class="card mapcard nophone"><svg class="map terrain"');
    expect(volcanPage(ORIGIN, cached(answer("volcan_seismes")), NOW)).toContain('<figure class="card mapcard nophone"><svg class="map terrain" viewBox="0 0 1000 896" role="img" aria-label="Carte de La Réunion (974) avec le Piton de la Fournaise"');
    const calendrier = calendrierPage(ORIGIN, cached(answer("calendrier")), NOW);
    expect(calendrier).not.toContain('<svg class="map');
    expect(calendrier).toContain('<div class="wrap intro solo">');
  });

  it("draws a count in the night's colour, with its source and date under the map", async () => {
    const dae = figure(daePage(ORIGIN, cached(await buildDae()), NOW));
    expect(dae).toContain('<circle class="sh" cx=');
    expect(dae.match(/<circle class="sh"[^>]*fill="([^"]+)"/g)?.every((c) => c.endsWith('fill="#14202b"'))).toBe(true);
    expect(dae).not.toContain("#2b8a3e");
    expect(dae).toContain('<circle r="34" fill="#14202b"/><text y="11">52</text></svg>défibrillateurs de la commune</span>');
    expect(dae).toContain('<span class="mls">Liste nationale Géo&#39;DAE, lue le 24/10.</span>');
    const enfants = figure(enfantsPage(ORIGIN, null, NOW));
    expect(enfants.match(/<circle class="sh"[^>]*fill="([^"]+)"/g)?.every((c) => c.endsWith('fill="#14202b"'))).toBe(true);
    expect(enfants).not.toContain("#e8590c");
    expect(enfants).toContain('<span class="mls">Lieux d&#39;OpenStreetMap, Data ES et Basilic, liste lue le 25/10.</span>');
  });

  it("draws each mark of the legend as on the map, never a coloured word, then what was measured and when", () => {
    const site = (s: string, lon: number, lat: number, q: string, day: string) => ({
      site: s, commune: "Saint-Paul", lon, lat, qualite_dernier_prelevement: q, dernier_prelevement: day, derniers_prelevements: [], mauvais_sur_12_mois: 0,
    });
    const eau = figure(eauPage(ORIGIN, cached({
      baignades: [site("Plage de l'Hermitage", 55.22, -21.08, "bonne", "14/10/2026"), site("Bassin Manapany", 55.6, -21.37, "mauvaise", "20/10/2026")],
      communes: [], lu: NOW.toISOString(), a_savoir: COMMON, sources: [],
    } as unknown as EauAnswer), NOW));
    expect(eau).toContain('<circle r="34" fill="#e3262d"/><text y="11">!</text></svg>mauvaise</span>');
    // The white edge that parts a mark from the map must not paint over the ring of a station with no recent measure.
    expect(CSS).toContain(".mlg circle:not([stroke]),.mlg rect,.mlg path{stroke:#fff;stroke-width:5}");
    expect(eau).toContain('<span class="mls">Qualité au dernier prélèvement de l&#39;ARS, du 14/10 au 20/10/2026.</span>');
    // Every site's name in the bubble, none written on the map, where the frame cut them.
    expect(eau).not.toContain('class="mn"');
    expect(eau).toContain("<title>Bassin Manapany : mauvaise</title>");

    const station = (s: string, lon: number, lat: number, rapport: string) => ({
      zone: "Nord", station: s, altitude_m: 10, lon, lat, pluie: { total_mm: 20, jours_de_pluie: 3, normale_mm: 60, rapport_a_la_normale: rapport },
    });
    const historique = figure(historiquePage(ORIGIN, cached({
      resume: "", periode: { du: "24/09/2026", au: "23/10/2026", jours: 30 }, stations: [station("Saint-Denis-Gillot", 55.52, -20.89, "33 %"), station("Bellecombe", 55.68, -21.21, "100 %"), station("Saint-Benoît", 55.71, -21.03, "160 %")], a_savoir: [], sources: [],
    } as HistoriqueAnswer), NOW));
    expect(historique).toContain('<rect x="-64" y="-24" width="128" height="48" rx="24" fill="#ff922b"/><text y="11" style="fill:#14202b">40 %</text></svg>moins de 80\u00a0%\u00a0: nettement moins que la normale</span>');
    expect(historique).not.toMatch(/<span style="color:/);
    expect(historique).toContain('<span class="mls">Pluie mesurée par Météo-France du 24/09 au 23/10, en % de la normale 1991-2020.</span>');
    // The figure in the night's colour on every pill, where white reads badly (contrast 1.75 to 2.48:1, night 6.67 to 9.46:1), on the map as in the legend.
    expect(historique).toContain('fill="#69db7c"/><text y="11" style="fill:#14202b">100 %</text></svg>de 80 à 125\u00a0%\u00a0: proche de la normale</span>');
    expect(historique).toContain('fill="#4dabf7"/><text y="11" style="fill:#14202b">160 %</text></svg>plus de 125\u00a0%\u00a0: nettement plus que la normale</span>');
    expect(historique).toMatch(/fill="#69db7c"\/><text x="[\d.]+" y="[\d.]+" class="mv" style="fill:#14202b">100 %<\/text>/);
    expect(historique).toMatch(/fill="#ff922b"\/><text x="[\d.]+" y="[\d.]+" class="mv" style="fill:#14202b">33 %<\/text>/);
    expect(historique).toMatch(/fill="#4dabf7"\/><text x="[\d.]+" y="[\d.]+" class="mv" style="fill:#14202b">160 %<\/text>/);

    const mer = figure(seaPage(ORIGIN, cached({
      plages: [{ nom: "Plage de Boucan Canot", commune: "Saint-Paul", lon: 55.22, lat: -21.03, valeur: 25.4, jour: "2026-10-22", distance_km: 3 }],
      sources: [],
    } as unknown as SeaData), NOW));
    expect(mer).toContain("</svg>température de l&#39;eau au large de la plage</span>");
    expect(mer).toContain('<span class="mls">Mesure par satellite (NOAA CoastWatch et NASA), moyenne du 22/10.</span>');
  });

  it("puts the speed cameras' map in a card of its own, with its legend; the Waze map as wide as the island it draws", () => {
    const trafic = traficPage(ORIGIN, null, NOW);
    expect(trafic).toMatch(/<figure class="mapcard"><svg class="map terrain"[^>]*aria-label="\d+ radars fixes à La Réunion/);
    expect(trafic).toContain('fill="#14202b"/><text y="11">90</text></svg>Radar fixe : vitesse limitée en km/h</span>');
    // In the night's colour on the map too: the dark theme's ink made white figures on light pills.
    const radars = trafic.match(/<figure class="mapcard">(?:(?!<\/figure>).)*<\/figure>/s)?.[0] ?? "";
    expect(radars.match(/<rect class="sh"[^>]*fill="([^"]+)"/g)?.every((c) => c.endsWith('fill="#14202b"'))).toBe(true);
    // Wider than the island, the frame made the names script measure 1 076 px for an island drawn on 607: 24 names at 9 px.
    expect(CSS).toContain(".wz-box>.map{width:min(100%,calc(clamp(22rem,65vh,34rem)*1000/896));margin:0 auto}");
  });
});
