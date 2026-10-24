import { describe, expect, it } from "vitest";
import type { AgendaAnswer } from "../src/web/data.js";
import { tracePage, traficPage } from "../src/web/domains.js";
import { weekendPage } from "../src/web/evenements.js";
import { communeEvents, forecastLinks, hikesNear, weatherNear } from "../src/web/liens.js";
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

  it("give a commune's outings and the forecast of the communes of each weekend day", () => {
    const rows = [{ titre: "Kabar", date: "2026-10-31T19:00", quand: "samedi 31/10 à 19:00", genres: ["concert"], commune: "Saint-Paul", lien: "https://example.re" }];
    const agenda = { value: { resume: "", nombre: 1, evenements: rows, couverture: "", a_savoir: "", sources: [], ce_week_end: [] } as unknown as AgendaAnswer, fetchedAt: NOW };
    expect(communeEvents(pageOf("saint-paul")!, agenda)).toMatchObject({ valeur: "1 événement" });
    expect(communeEvents(pageOf("cilaos")!, agenda)).toMatchObject({ valeur: "Rien d'annoncé" });
    expect(forecastLinks(["Saint-Paul", "Saint-Paul", undefined])).toBe(`<p class="note">Prévision météo : <a href="/meteo/saint-paul">Saint-Paul</a>.</p>`);
    expect(weekendPage(O, agenda, NOW)).toContain(`Prévision météo : <a href="/meteo/saint-paul">Saint-Paul</a>`);
  });

  it("say « bouchons » in the traffic page's title", () => {
    expect(traficPage(O, null, NOW)).toContain(`<h1>Bouchons et circulation à La Réunion <span class="n974">974</span></h1>`);
  });
});
