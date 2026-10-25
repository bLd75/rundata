import { describe, expect, it } from "vitest";
import type { AgendaAnswer } from "../src/web/data.js";
import { tracePage, traficPage } from "../src/web/domains.js";
import { weekendPage } from "../src/web/evenements.js";
import { cloudSeaTold, communeEvents, forecastLinks, hikesNear, summitOf, weatherNear } from "../src/web/liens.js";
import { placePage } from "../src/web/pages.js";
import { pageOf } from "../src/web/places.js";

const NOW = new Date("2026-10-27T06:00:00Z");
const O = "https://rundata.re";

describe("links between the weather, the hikes and the communes", () => {
  it("find the hikes around a place, and the weather page nearest a trail", () => {
    const cilaos = pageOf("cilaos")!;
    expect(hikesNear(cilaos.place.lon, cilaos.place.lat).map((x) => x.r.slug)).toContain("sentier-du-piton-des-neiges");
    expect(weatherNear(55.708, -21.244).slug).toBe("piton-de-la-fournaise");
  });

  it("put « Randonner autour de » on a place's weather page, with its sector's page", () => {
    const html = placePage(O, pageOf("cilaos")!, null, NOW);
    expect(html).toContain(`<h2 id="h-rando">Randonner autour de Cilaos</h2>`);
    expect(html).toContain(`href="/randonnees/sentier-du-piton-des-neiges"`);
    expect(html).toContain(`<a href="/randonnees/cilaos">Randonnée à Cilaos`);
  });

  it("put the nearest weather on a trail's page", () => {
    const d = { value: { nom: "x", slug: "x", genre: "sentier", km: 1, etat: "Ouvert", ferme: false, troncons: [], lignes: [{ etat: "ouvert", points: [[55.70, -21.24], [55.71, -21.245]] }], profil: [], randonnees: [], fermes: [], inconnus: [], sources: [] }, fetchedAt: NOW } as any;
    expect(tracePage(O, "sentier", "x", "Sentier", d, NOW)).toContain(`<a href="/meteo/piton-de-la-fournaise">météo Piton de la Fournaise</a>`);
  });

  it("link a summit's trail to the cloud sea of the morning there, only while that page tells it", () => {
    const at = (points: [number, number][]) => summitOf(points);
    const page = (points: [number, number][]) => tracePage(O, "sentier", "x", "Sentier", { value: { nom: "x", slug: "x", genre: "sentier", km: 1, etat: "Ouvert", ferme: false, troncons: [], lignes: [{ etat: "ouvert", points }], profil: [], randonnees: [], fermes: [], inconnus: [], sources: [] }, fetchedAt: NOW } as any, NOW, undefined, at(points));
    // Le Bloc → Piton des Neiges: the summit at its end; its morning is told on /randonnees.
    const neiges: [number, number][] = [[55.48328, -21.12347], [55.48, -21.09914]];
    expect(page(neiges)).toContain(`<p class="note">Au-dessus ou dans les nuages ? <a href="/randonnees#mer-de-nuages">Mer de nuages au Piton des Neiges : la prévision</a> du modèle AROME de Météo-France, pas une mesure.</p>`);
    expect(page([[55.38607, -21.07203], [55.38718, -21.06905]])).toContain(`<a href="/meteo/maido#mer-de-nuages">Mer de nuages au Maïdo : la prévision</a> du modèle AROME de Météo-France, pas une mesure.</p>`);
    // The Grand Bénare has no page: the Maïdo's, with the height between them.
    expect(page([[55.39915, -21.16335], [55.42217, -21.11613]])).toContain(`<a href="/meteo/maido#mer-de-nuages">Mer de nuages au Maïdo : la prévision</a> du modèle AROME de Météo-France, pas une mesure. Le sommet du Grand Bénare est environ 700\u00a0m plus haut que le Maïdo.</p>`);
    expect(page([[55.68916, -21.22227], [55.6919, -21.22206]])).toContain(`<a href="/meteo/piton-de-la-fournaise#mer-de-nuages">Mer de nuages au Pas de Bellecombe : la prévision</a>`);
    // Caverne Dufour, 2 km below the Piton des Neiges: not a summit.
    expect(at([[55.5709, -21.16109], [55.49538, -21.11113]])).toBeUndefined();
    // The link only while the page it leads to tells the cloud sea: else it would lead nowhere.
    const copy = (value: object) => ({ value, fetchedAt: NOW }) as any;
    expect(cloudSeaTold(at(neiges)!, copy({ hauts: [{ nom: "Maïdo" }, { nom: "Piton des Neiges" }] }))).toBe(true);
    expect(cloudSeaTold(at(neiges)!, copy({ hauts: [{ nom: "Maïdo" }] }))).toBe(false);
    expect(cloudSeaTold(at(neiges)!, copy({}))).toBe(false);
    expect(cloudSeaTold(at(neiges)!, undefined)).toBe(false);
    const maido = at([[55.38757, -21.06885]])!;
    expect(cloudSeaTold(maido, copy({ prevision: { mer_de_nuages: { titre: "Mer de nuages demain matin" } } }))).toBe(true);
    expect(cloudSeaTold(maido, copy({ prevision: {} }))).toBe(false);
    expect(tracePage(O, "sentier", "x", "Sentier", null, NOW)).not.toContain("mer-de-nuages");
  });

  it("give a commune's outings and the forecast of the communes of each weekend day", () => {
    const rows = [{ titre: "Kabar", date: "2026-10-31T19:00", quand: "samedi 31/10 à 19:00", genres: ["concert"], commune: "Saint-Paul", lien: "https://example.re" }];
    const agenda = { value: { resume: "", nombre: 1, evenements: rows, couverture: "", a_savoir: "", sources: [], ce_week_end: [] } as unknown as AgendaAnswer, fetchedAt: NOW };
    expect(communeEvents(pageOf("saint-paul")!, agenda)).toMatchObject({ valeur: "1 événement" });
    expect(communeEvents(pageOf("cilaos")!, agenda)).toMatchObject({ valeur: "Rien d'annoncé" });
    // From a commune's site: said with the event.
    const fromSite = { value: { ...agenda.value, evenements: [{ ...rows[0], source: "site de la commune de Saint-Paul, lu le samedi 24/10 à 08:00" }] } as unknown as AgendaAnswer, fetchedAt: NOW };
    expect(communeEvents(pageOf("saint-paul")!, fromSite)?.detail).toBe("d'ici quinze jours ; le prochain : Kabar, samedi 31/10 à 19:00 (Source\u00a0: site de la commune de Saint-Paul, lu le samedi 24/10 à 08:00)");
    expect(forecastLinks(["Saint-Paul", "Saint-Paul", undefined])).toBe(`<p class="note">Prévision météo : <a href="/meteo/saint-paul">Saint-Paul</a>.</p>`);
    expect(weekendPage(O, agenda, NOW)).toContain(`Prévision météo : <a href="/meteo/saint-paul">Saint-Paul</a>`);
  });

  it("say « bouchons » in the traffic page's title", () => {
    expect(traficPage(O, null, NOW)).toContain(`<h1>Bouchons et circulation à La Réunion <span class="n974">974</span></h1>`);
  });
});
