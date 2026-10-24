import { describe, expect, it } from "vitest";
import { ageIn, ageRange, extrait, themesIn } from "../src/providers/agenda-mots.js";
import { INSEE } from "../src/places/insee.js";
import { CHILDREN, enfantsAnswer, kindAsked } from "../src/tools/enfants.js";
import * as enfants from "../src/vie/enfants.js";
import { enfantsPage, LEAD, TITLE } from "../src/web/enfants.js";
import { esc } from "../src/web/map.js";
import { deadAnchors, doubleIds, mapLinks } from "./cartes.js";

const O = "https://rundata.re";
const NOW = new Date("2026-10-24T06:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const NBSP = " ";
const flat = (s: string) => s.replaceAll(NBSP, " ");

describe("the ages an event's text gives", () => {
  it("are kept in the organiser's words, never guessed", () => {
    expect(ageIn("Public : À partir de 6 mois à 6 ans. Lecture et comptines.")).toBe("À partir de 6 mois à 6 ans");
    expect(ageIn("Atelier Mahjong, ouvert aux enfants dès 10 ans")).toBe("dès 10 ans");
    expect(ageIn("Pour les 6–10 ans")).toBe("6–10 ans");
    expect(ageIn("Spectacle 8 ans et plus")).toBe("8 ans et plus");
    expect(ageRange("À partir de 6 mois à 6 ans")).toEqual({ min: 0.5, max: 6 });
    expect(ageRange("de 3 à 12 ans")).toEqual({ min: 3, max: 12 });
    expect(ageRange("jusqu'à 8 ans")).toEqual({ max: 8 });
  });

  it("leave out an adult's age, a festival's history and an age a price is given for", () => {
    expect(ageIn("Soirée dès 18 ans")).toBeUndefined();
    expect(ageIn("Rencontre pour les 20-25 ans")).toBeUndefined();
    expect(ageIn("Plus de 10 ans que le festival existe")).toBeUndefined();
    expect(ageIn("Concert. Gratuit jusqu'à 12 ans")).toBeUndefined();
    expect(ageIn("Tarif réduit 3-12 ans")).toBeUndefined();
  });

  it("say the event is for children, an age said beyond the first sentence too", () => {
    expect(extrait("Atelier Mahjong. Ouvert aux enfants dès 10 ans.")).toEqual({ description: "Atelier Mahjong.", themes: ["enfants"], age: "dès 10 ans" });
  });
});

describe("the agenda's children's theme", () => {
  it("is not what is for parents or what collects toys", () => {
    expect(themesIn("Village solidarité famille et jeunesse")).not.toContain("enfants");
    expect(themesIn("Atelier pour les parents : le cerveau de l'enfant")).not.toContain("enfants");
    expect(themesIn("Collecte de jouets pour les enfants")).not.toContain("enfants");
    expect(themesIn("Spectacle à voir en famille")).toContain("enfants");
    expect(themesIn("Atelier pour enfants")).toContain("enfants");
  });
});

describe("the places to go with children", () => {
  it("are of the 24 communes, of the page's kinds, each with a place on the island", () => {
    expect(enfants.LIEUX.length).toBeGreaterThan(400);
    const kinds = new Set(enfants.TYPES.map((t) => t.type));
    for (const l of enfants.LIEUX) {
      expect(INSEE[l.commune], l.commune).toBeDefined();
      expect(kinds.has(l.type)).toBe(true);
      expect(l.lon > 55.2 && l.lon < 55.85 && l.lat > -21.4 && l.lat < -20.85, enfants.nameOf(l)).toBe(true);
    }
    expect(new Set(enfants.LIEUX.map((l) => l.commune)).size).toBe(24);
    // The students' libraries and the schools' pools are not places for children.
    expect(enfants.LIEUX.some((l) => (l.type === "mediatheque" && /universitaire/i.test(l.nom)) || (l.type === "piscine" && /coll[èe]ge|inspe/i.test(l.nom)))).toBe(false);
  });

  it("give the map's ages as a fact, else an indication by kind, marked as ours", () => {
    const given = enfants.LIEUX.find((l) => l.age?.min === 3 && l.age.max === 14)!;
    expect(enfants.ageOf(given)).toEqual({ texte: `3–14${NBSP}ans`, fait: true, bands: ["3-6", "6-12", "12-17"] });
    const playground = enfants.LIEUX.find((l) => l.type === "aire_de_jeux" && !l.age)!;
    expect(enfants.ageOf(playground)).toEqual({ texte: `3–12${NBSP}ans · indicatif`, fait: false, bands: ["3-6", "6-12"] });
    const skate = enfants.LIEUX.find((l) => l.type === "sport")!;
    expect(enfants.ageOf(skate).texte).toBe(`6–17${NBSP}ans · indicatif`);
    const pool = enfants.LIEUX.find((l) => l.type === "piscine")!;
    expect(enfants.ageOf(pool)).toMatchObject({ texte: "Tous âges · indicatif", fait: false, bands: ["0-3", "3-6", "6-12", "12-17"] });
    expect(enfants.agesSaid({ min: 0.5, max: 6 })).toBe(`6${NBSP}mois – 6${NBSP}ans`);
    expect(enfants.agesSaid({ max: 8 })).toBe(`jusqu'à 8${NBSP}ans`);
    expect(enfants.agesSaid({ min: 1 })).toBe(`dès 1${NBSP}an`);
  });

  it("put an age in each band it overlaps, and an event without one in none of its own", () => {
    expect(enfants.bandsOf({ min: 0.5, max: 6 })).toEqual(["0-3", "3-6"]);
    expect(enfants.bandsOf({ min: 10 })).toEqual(["6-12", "12-17"]);
    expect(enfants.eventAge("dès 10 ans")).toEqual({ texte: "dès 10 ans", fait: true, bands: ["6-12", "12-17"] });
    expect(enfants.eventAge(undefined)).toMatchObject({ texte: "Âge non précisé", fait: false });
  });
});

describe("annuaire_services_publics, asked about children", () => {
  it("is asked for children and for the kinds of places, not for a town hall", () => {
    for (const q of ["enfants", "aire de jeux", "piscine", "médiathèque", "skatepark", "zoo"]) expect(CHILDREN.test(q), q).toBe(true);
    for (const q of ["mairie", "CAF", "pharmacie"]) expect(CHILDREN.test(q), q).toBe(false);
    expect(kindAsked("aire de jeux")).toBe("aire_de_jeux");
    expect(kindAsked("enfants")).toBeUndefined();
  });

  it("lists a commune's places by kind, with their ages and where the list falls short", () => {
    const b = body(enfantsAnswer("enfants", "Saint-Leu", NOW));
    expect(b.resume).toMatch(/^\d+ lieux pour les enfants à Saint-Leu d'après les cartes ouvertes : aires de jeux \d+/);
    expect(b.lieux.every((l: { commune: string }) => l.commune === "Saint-Leu")).toBe(true);
    expect(b.lieux.find((l: { type: string }) => l.type === "Aires de jeux")).toMatchObject({ age_d_apres_la_source: false });
    expect(b.page).toBe(`${O}/enfants#c-saint-leu`);
    expect(b.avertissements.join(" ")).toMatch(/monenfant\.fr/);
    expect(b.avertissements.join(" ")).toMatch(/evenements, quoi = « enfants »/);
    expect(b.sources.map((s: { source: string }) => s.source).join(" ")).toMatch(/OpenStreetMap/);
  });

  it("answers a kind asked alone, the nearest when the commune has none", () => {
    const b = body(enfantsAnswer("ludothèque", "Saint-Denis", NOW));
    expect(b.resume).toMatch(/^Aucun lieu de ce type à Saint-Denis dans les sources\. Les plus proches : Case à jeux, à Entre-Deux, à \d+/);
    expect(b.lieux[0].distance_km).toBeGreaterThan(0);
    const all = body(enfantsAnswer("piscine", undefined, NOW));
    expect(all.resume).toMatch(/^Piscines dans les sources : \d+, dans \d+ communes\. Donner une commune/);
    expect(body(enfantsAnswer("enfants", "Nulle-Part", NOW)).erreur).toMatch(/introuvable/);
  });
});

describe("the children's page", () => {
  const row = (titre: string, date: string, age?: string) =>
    ({ titre, quand: "samedi 24/10 de 10:00 à 11:00", date, commune: "Saint-Leu", lieu: "Médiathèque", genres: ["enfants"], lien: "https://example.re/", publie_par: "Saint-Leu", ...(age ? { age } : {}) }) as any;
  const data = { value: { ce_week_end: [row("Heure du conte", "2026-10-24T10:00", "À partir de 6 mois à 6 ans")], evenements: [row("Heure du conte", "2026-10-24T10:00", "À partir de 6 mois à 6 ans"), row("Marionnettes", "2026-10-28T15:00")] }, fetchedAt: NOW } as any;
  const html = enfantsPage(O, data, NOW);

  it("says marketing's words, with French spacing", () => {
    expect(html).toContain(`<title>${TITLE}</title>`);
    expect(html).toContain("Avec les enfants à La Réunion <span class=\"n974\">974</span>");
    expect(html).toContain(esc(LEAD));
    expect(LEAD).toContain(`skateparks${NBSP}: les lieux`);
    expect(LEAD).toContain(`De 0 à 17${NBSP}ans`);
    expect(flat(html)).toContain("Ce que vous ne trouverez pas ici.</b> Les accueils de loisirs (centres aérés)");
    expect(html).toContain('<a href="https://monenfant.fr" rel="noopener">monenfant.fr</a>');
    expect(flat(html)).toContain(esc("Lieux : © les contributeurs d'OpenStreetMap (ODbL) ; recensement des équipements sportifs (Data ES, ministère des Sports)"));
    expect(flat(html)).toContain(esc("Les âges en gras viennent de l'organisateur ou de la carte."));
    // Never all the places, never open without the source's hours.
    expect(html).not.toMatch(/tous les lieux|toutes les activités/i);
  });

  it("lists the weekend's activities first, the organiser's age in bold, else « Âge non précisé »", () => {
    const act = html.slice(html.indexOf('id="h-act"'), html.indexOf('id="h-lieux"'));
    expect(act.indexOf("Ce week-end")).toBeLessThan(act.indexOf("Dans les deux semaines"));
    expect(act).toContain('<span class="age">À partir de 6 mois à 6 ans</span>');
    expect(act).toContain('data-b="0-3 3-6" data-t="agenda"');
    expect(act).toContain('<span class="age i">Âge non précisé</span>');
    // An event of the weekend is not listed again below.
    expect(act.match(/Heure du conte/g)).toHaveLength(1);
  });

  it("filters by marketing's bands and kinds, in their order", () => {
    const form = html.slice(html.indexOf('<form id="kf"'), html.indexOf("</form>", html.indexOf('<form id="kf"')));
    const options = [...form.matchAll(/<option value="[^"]*">([^<]+)<\/option>/g)].map((m) => m[1]);
    expect(options.slice(0, 5)).toEqual(["Tous", "Tout-petits, 0–3 ans", "3–6 ans", "6–12 ans", "Ados, 12–17 ans"]);
    expect(options.slice(5, 9)).toEqual(["Tous", "Activités et spectacles", "Aires de jeux", "Parcs et jardins"]);
    expect(options.at(-1)).toBe("Ludothèques");
  });

  it("takes each commune of the map to its places, folded, each id once", () => {
    const links = mapLinks(html);
    expect(links).toHaveLength(24);
    expect(deadAnchors(html)).toEqual([]);
    expect(doubleIds(html)).toEqual([]);
    expect(html).toContain('<li class="card tgt" id="c-saint-leu" data-k><details><summary><h3>Saint-Leu');
    expect(html).toMatch(/<span class="age i n">3–12 ans · indicatif<\/span>/);
  });

  it("keeps its places when the agenda is not there", () => {
    const empty = enfantsPage(O, null, NOW);
    expect(empty).toContain("agenda des enfants se charge");
    expect(empty).toContain('id="c-saint-leu"');
  });
});
