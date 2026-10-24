import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Cache } from "../src/cache.js";
import * as carburants from "../src/providers/carburants.js";
import { annuaireTool } from "../src/tools/annuaire.js";
import { FUEL } from "../src/tools/carburants.js";
import { handle } from "../src/app.js";
import { carburantsPage, descriptionOf, TITLE } from "../src/web/carburants.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const LIEN = "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Prix-des-carburants-en-octobre";
const NOW = new Date("2026-10-24T08:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

afterEach(() => carburants.configure(undefined));

describe("the prefect's fuel prices", () => {
  it("are read from the release's table, whatever the way its columns are dated", () => {
    const oct = carburants.parseRelease(fixture("carburants_octobre.html"), LIEN, NOW)!;
    expect(oct.depuis).toBe("2026-10-01");
    expect(oct.precedent_depuis).toBe("2026-09-01");
    expect(oct.produits.slice(0, 2)).toEqual([
      { produit: "Supercarburant", unite: "€/litre", prix_eur: 2, precedent_eur: 1.83, note: undefined },
      { produit: "Gazole", unite: "€/litre", prix_eur: 1.8, precedent_eur: 1.68, note: undefined },
    ]);
    expect(oct.produits.find((p) => p.produit === "Gaz")).toMatchObject({ unite: "€/bouteille de 12,5 kg", prix_eur: 20.81, note: "18 € avec aides locales" });
    expect(oct.titre).toMatch(/^Évolution des prix des carburants en octobre/);
    // August's release dates its columns « 1-juil.-26 » and « 1-août-26 ».
    const aout = carburants.parseRelease(fixture("carburants_aout.html"), LIEN, NOW)!;
    expect(aout.depuis).toBe("2026-08-01");
    expect(aout.produits[0]).toMatchObject({ produit: "Supercarburant", prix_eur: 1.78, precedent_eur: 1.82 });
    expect(aout.produits.find((p) => p.produit === "Gaz")?.note).toBe("18 € avec aides de la Région");
    // A page without the table is not taken for one.
    expect(carburants.parseRelease("<h1>Prix des carburants</h1><p>Voir le tableau.</p>", LIEN)).toBeUndefined();
  });

  it("are found in the list of press releases, newest first", () => {
    const list = `<a class="fr-card__link" href="/Actualites/Communiques-de-presse/Prix-des-carburants-en-octobre">x</a>
      <a href="/Actualites/Communiques-de-presse/Secheresse">y</a><a href="/Actualites/Communiques-de-presse/Prix-des-carburants-au-1er-septembre-2026">z</a>`;
    expect(carburants.releases(list)).toEqual([LIEN, "https://www.reunion.gouv.fr/Actualites/Communiques-de-presse/Prix-des-carburants-au-1er-septembre-2026"]);
    expect(carburants.headerDay("01/10/2026")).toBe("2026-10-01");
    expect(carburants.headerDay("1-déc.-26")).toBe("2026-12-01");
  });

  it("are what the public services tool answers about fuel, from the stored copy", async () => {
    const prix = carburants.parseRelease(fixture("carburants_octobre.html"), LIEN, NOW)!;
    carburants.configure(async () => prix);
    const r = body(await annuaireTool(new Cache(), "prix de l'essence", undefined, NOW));
    expect(r.resume).toBe("Prix maximums à La Réunion depuis le 1er octobre 2026 (arrêté du préfet) : supercarburant 2,00 €/litre (+0,17 €) ; gazole 1,80 €/litre (+0,12 €) ; gaz 20,81 € la bouteille de 12,5 kg (+0,21 €), 18 € avec aides locales. Les mêmes plafonds dans toute l'île : une station peut vendre moins cher, pas plus.");
    expect(r.prix_maximums).toHaveLength(7);
    expect(r.communique.lien).toBe(LIEN);
    expect(r.avertissements).toEqual([]);
    expect(r.sources[0].licence).toMatch(/Licence Ouverte/);
    // In November, before the new order is read: said to be October's.
    const later = body(await annuaireTool(new Cache(), "gazole", undefined, new Date("2026-11-03T08:00:00Z")));
    expect(later.avertissements[0]).toBe("Les prix de novembre 2026 ne sont pas encore lus : ce sont ceux d'octobre 2026, qui ont pu changer le 1er du mois.");
  });

  it("are asked in plain words, and only then", () => {
    for (const q of ["carburant", "prix de l'essence", "gazole", "sans plomb", "SP95", "bouteille de gaz", "prix à la pompe", "station-service"]) expect(FUEL.test(q), q).toBe(true);
    for (const q of ["mairie", "CAF", "préfecture", "impôts", "France Travail", "tribunal", "CPAM", "sous-préfecture de Saint-Pierre"]) expect(FUEL.test(q), q).toBe(false);
  });

  it("have their page, titled with the month, its description with the figures it has", async () => {
    const prix = carburants.parseRelease(fixture("carburants_octobre.html"), LIEN, NOW)!;
    const at = { value: prix, fetchedAt: NOW, stale: false };
    const page = carburantsPage("https://rundata.re", at, NOW);
    expect(TITLE.length).toBeLessThanOrEqual(60);
    expect(page).toContain(`<title>${TITLE}</title>`);
    expect(page).toContain("<h1>Prix des carburants à La Réunion, octobre 2026</h1>");
    // Marketing's sentence, its end dropped when it would not fit in what search engines show.
    expect(descriptionOf(prix)).toBe("Prix maximum en octobre 2026 à La Réunion (974) : sans plomb 2,00 €/L (+0,17 €), gazole 1,80 €/L (+0,12 €), bouteille de gaz 20,81 €. Fixés par le préfet.");
    for (const depuis of ["2026-09-01", "2026-02-01", "2026-12-01"]) expect(descriptionOf({ ...prix, depuis }).length).toBeLessThanOrEqual(160);
    // A figure the order does not give is left out, not printed empty.
    expect(descriptionOf({ ...prix, produits: prix.produits.filter((x) => x.produit !== "Gazole") })).toBe("Prix maximum en octobre 2026 à La Réunion (974) : sans plomb 2,00 €/L (+0,17 €), bouteille de gaz 20,81 €. Fixés par le préfet, partout sur l'île.");
    expect(page).toContain("<td><b>1,26 €</b></td>");
    expect(page).toContain('content="https://rundata.re/og/carburants.');
    expect(page).not.toContain("pas encore publiés");
    // On the 2nd of November, before the new order: October's, said to be in force since the 1st of October.
    const early = carburantsPage("https://rundata.re", at, new Date("2026-11-02T06:00:00Z"));
    expect(early).toContain("<h1>Prix des carburants à La Réunion, octobre 2026</h1>");
    expect(early).toContain("Les prix de novembre 2026 ne sont pas encore publiés ou pas encore lus : voici ceux en vigueur depuis le 1er octobre 2026.");
  });

  it("are served at /carburants and dated in the sitemap by the prefect's order", async () => {
    const prix = carburants.parseRelease(fixture("carburants_octobre.html"), LIEN, NOW)!;
    carburants.configure(async () => prix);
    const cache = new Cache();
    const r = await handle(new Request("https://rundata.re/carburants", { headers: { accept: "text/html" } }), cache);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("supercarburant 2,00 €/litre (+0,17 €)");
    const map = await (await handle(new Request("https://rundata.re/sitemap.xml"), cache)).text();
    expect(map).toContain("<loc>https://rundata.re/carburants</loc><lastmod>2026-10-01</lastmod>");
  });
});
