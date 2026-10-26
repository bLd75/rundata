import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parseRoads, parseTrails } from "../src/providers/sentiers.js";
import { sentiersRandonnee, trailsNamed } from "../src/tools/sentiers.js";
import type { SentiersAnswer } from "../src/web/data.js";
import { closedTrails, randonneesLive, sentiersPage } from "../src/web/domains.js";

// The ONF's map of the trails on 24/10/2026, last edited on 20/10: 56 trails closed out of 351 (389 pieces).
const fixture = (f: string) => readFileSync(new URL(`./fixtures/onf/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

describe("sentiers de randonnée", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string) => {
      const file = url.includes("/5/query") ? "sentiers.json" : url.includes("/4/query") ? "routes.json" : "couche.json";
      return new Response(fixture(file), { headers: { "content-type": "application/json" } });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads each trail's state, cause and line", () => {
    const trails = parseTrails(JSON.parse(fixture("sentiers.json")).features);
    expect(trails).toHaveLength(389);
    expect(trails.filter((t) => t.statut === "fermé")).toHaveLength(56);
    expect(trails.find((t) => t.nom === "Sentier de la Roche Pendue")).toMatchObject({ statut: "fermé", cause: "Eboulements et arbres en travers", info: "Réouverture 2026" });
    expect(trails.every((t) => !t.nom.endsWith("(hors gestion ONF)"))).toBe(true);
    const roads = parseRoads(JSON.parse(fixture("routes.json")).features);
    expect(roads.filter((r) => r.circulation === "Circulation interdite")).toHaveLength(4);
    expect(roads.some((r) => r.circulation === "Circulation autorisé")).toBe(false);
  });

  it("lists the closed trails of the island by commune", async () => {
    const b = body(await sentiersRandonnee(cache(), undefined, NOW));
    expect(b.resume).toBe("56 sentiers fermés sur 351 suivis par l'ONF à La Réunion, et 4 routes forestières interdites à la circulation.");
    expect(b.carte_mise_a_jour).toBe("20/10/2026 (ONF)");
    expect(b.fermes_par_commune[0]).toMatchObject({ commune: "Sainte-Rose" });
    expect(b.fermes_par_commune.reduce((n: number, c: { sentiers_fermes: unknown[] }) => n + c.sentiers_fermes.length, 0)).toBe(56);
  });

  it("answers for a trail by its name", async () => {
    const b = body(await sentiersRandonnee(cache(), "le sentier de la Roche Pendue est ouvert ?", NOW));
    expect(b.resume).toMatch(/^Sentier de la Roche Pendue : FERMÉ \(Eboulements et arbres en travers\)\./);
    expect(b.avertissement.sentiers_fermes).toEqual([expect.objectContaining({ sentier: "Sentier de la Roche Pendue", reouverture: "Réouverture 2026", page: "https://rundata.re/sentiers/sentier-de-la-roche-pendue" })]);
    expect(trailsNamed(parseTrails(JSON.parse(fixture("sentiers.json")).features), "Roche Plate")).toHaveLength(6);
  });

  it("takes a cirque as a whole, not the places named after it", async () => {
    const b = body(await sentiersRandonnee(cache(), "sentiers fermés à Mafate", NOW));
    // A hike of the cirque crosses a closed trail: said first.
    expect(b.resume).toBe("ATTENTION : PR25 emprunte 1 sentier fermé : La Nouvelle - Maison Laclos par PR (Éboulement). Un sentier fermé est interdit : ne pas s'y engager, prendre une variante ouverte ou renoncer. " +
      "Dans le cirque de Mafate : 5 sentiers fermés, 84 ouverts, 9 hors gestion ONF (état non connu). 50 aires d'accueil de l'ONF dans le cirque de Mafate (voir aires_accueil).");
    expect(b.avertissement.sentiers_fermes).toEqual([expect.objectContaining({ sentier: "La Nouvelle - Maison Laclos par PR", cause: "Éboulement", randonnees: ["PR25"] })]);
    expect(b.sentiers_nommes).toBeUndefined();
    expect(b.autour.sentiers_fermes.map((t: { sentier: string }) => t.sentier)).toContain("Piste DFCI de la Glacière");
  });

  it("looks around a place, with the trails named after it", async () => {
    const b = body(await sentiersRandonnee(cache(), "Bélouve", NOW));
    expect(b.resume).toMatch(/^ATTENTION : Sentier de l'École normale emprunte 1 sentier fermé : Sentier de l'École Normale\u00a0; .+\. 4 sentiers portent ce nom : 1 fermé \(Sentier de la Tamarinaie de Bélouve\)\. À moins de 4 km de Bélouve : \d+ sentiers fermés/);
    // The closed trail asked by its name is in the warning too, with no hike.
    expect(b.avertissement.sentiers_fermes).toContainEqual(expect.objectContaining({ sentier: "Sentier de la Tamarinaie de Bélouve", randonnees: [] }));
    expect(b.autour.sentiers_fermes[0].distance_km).toBeTypeOf("number");
  });

  it("gives the ONF's reception areas of a zone, or along a trail asked by its name, under the ONF's names only", async () => {
    const b = body(await sentiersRandonnee(cache(), "Maïdo", NOW));
    expect(b.resume).toContain(" 48 aires d'accueil de l'ONF à moins de 4 km de Maïdo (voir aires_accueil).");
    expect(b.aires_accueil).toMatchObject({ ou: "à moins de 4 km de Maïdo", rayon_km: 4, nombre: 48 });
    expect(b.aires_accueil.aires).toHaveLength(10);
    expect(b.aires_accueil.aires[0]).toEqual({ nom: "Site du Maïdo", distance_km: 0.2, carte: expect.stringMatching(/^https:\/\/www\.openstreetmap\.org\/\?mlat=-21\.\d+&mlon=55\.\d+/) });
    expect(b.aires_accueil.a_savoir).toBe("Aires d'accueil de l'ONF, sous le nom que leur donne sa carte des sentiers (mise à jour le 20/05/2026), codes compris : « RF » désigne une route forestière, et « pk » le point kilométrique sur cette route. La carte ne dit pas ce qu'on trouve sur chaque aire, ni ce qu'on a le droit d'y faire (camper, faire du feu) : se renseigner auprès de l'ONF.");
    expect(b.sources.map((s: { source: string }) => s.source).join()).toContain("Aires d'accueil des forêts (ONF La Réunion)");
    // A commune: those of the commune (Cilaos, a cirque, takes the cirque's).
    const paul = body(await sentiersRandonnee(cache(), "Saint-Paul", NOW));
    expect(paul.aires_accueil).toMatchObject({ ou: "dans la commune de Saint-Paul", nombre: 55 });
    expect(paul.aires_accueil).not.toHaveProperty("rayon_km");
    expect(paul.resume).toContain(" 55 aires d'accueil de l'ONF dans la commune de Saint-Paul (voir aires_accueil).");
    const cilaos = body(await sentiersRandonnee(cache(), "Cilaos", NOW));
    expect(cilaos.aires_accueil).toMatchObject({ ou: "dans le cirque de Cilaos", rayon_km: 6, nombre: 29 });
    // A trail asked by its name, with no place: those within 300 m of it.
    const trail = body(await sentiersRandonnee(cache(), "le sentier de la Roche Pendue est ouvert ?", NOW));
    if (trail.aires_accueil) expect([trail.aires_accueil.ou, trail.aires_accueil.rayon_km]).toEqual(["à moins de 300 m du sentier", 0.3]);
    // The island: none, and never a word of what a place allows.
    const ile = body(await sentiersRandonnee(cache(), undefined, NOW));
    expect(ile.aires_accueil).toBeUndefined();
    // Camping is named only to say the map does not tell it (a forest road's « circulation autorisée » is not ours).
    for (const x of [b, cilaos, paul]) expect(JSON.stringify([x.aires_accueil, x.resume]).replace(x.aires_accueil.a_savoir, "")).not.toMatch(/bivouac|camping|camper|autoris/i);
  });
});

describe("the count of closed trails on the pages", () => {
  // The ONF's map cuts some trails in several pieces, each a point on the map: counted by name, as the tool counts them
  // (26/10/2026: 62 points, 56 trails on /sentiers's description and the home page's tile, 56 in sentiers_randonnee).
  const answer = {
    resume: "", fermes_par_commune: [], routes_forestieres_fermees: [], a_savoir: [], sources: [], suivis: 351, randonnees: [],
    points: [{ nom: "Sentier A", lon: 55.5, lat: -21.1 }, { nom: "Sentier A", lon: 55.51, lat: -21.11 }, { nom: "Sentier B", lon: 55.6, lat: -21.2 }],
  } as unknown as SentiersAnswer;
  const copy = { value: answer, fetchedAt: NOW, stale: false };

  it("are the trails, not the pieces of the map, on /sentiers and the tiles", () => {
    const html = sentiersPage("https://rundata.re", copy, NOW);
    expect(html).toContain(`<span class="big">2</span><p>sentiers fermés sur <b>351</b>`);
    expect(html).not.toMatch(/\b3 sentiers fermés/);
    expect(randonneesLive(copy)?.valeur).toBe("2 sentiers fermés");
    expect(closedTrails(answer)).toBe(2);
  });
});
