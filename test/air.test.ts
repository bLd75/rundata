import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import * as atmo from "../src/providers/atmo.js";
import { parse } from "../src/providers/atmo.js";
import { qualiteAir } from "../src/tools/air.js";
import { airPage } from "../src/web/domains.js";
import { sourceRevision } from "../src/web/revisions.js";
import { esc } from "../src/web/map.js";

// The ATMO index of the 24 communes for 22 and 23/10/2026: "moyen" everywhere, set by ozone.
const list = parse(JSON.parse(readFileSync(new URL("./fixtures/atmo_974.json", import.meta.url), "utf8")));
const NOW = new Date("2026-10-23T05:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
function cache(value = list) {
  const store = new MemoryStore();
  void store.put("atmo:974", { value, fetchedAt: NOW.getTime() });
  return new Cache(store, () => NOW.getTime());
}

describe("air quality", () => {
  it("reads the 24 communes for two days", () => {
    expect(list).toHaveLength(48);
    expect(new Set(list.map((x) => x.insee)).size).toBe(24);
  });

  it("names each commune as the site does, by its INSEE code: the layer's « Petite-Ile » with its accent", async () => {
    const names = [...new Set(list.map((x) => x.commune))];
    expect(names).toContain("Petite-Île");
    expect(names).toContain("L'Étang-Salé");
    expect(names).toContain("La Plaine-des-Palmistes");
    expect(names.filter((n) => /Petite-Ile|Etang|Plaine-Des/.test(n))).toEqual([]);
    expect(body(await qualiteAir(cache(), "Petite-Île", NOW)).resume).toMatch(/^Qualité de l'air prévue aujourd'hui à Petite-Île : /);
    // A code not in the table keeps the layer's name.
    expect(parse({ features: [{ properties: { code_zone: "97499", lib_zone: "Ailleurs", date_ech: "2026-10-23", code_qual: 2, date_maj: "" } }] })[0].commune).toBe("Ailleurs");
  });

  it("answers for a place's commune, accents and articles aside", async () => {
    const r = body(await qualiteAir(cache(), "plage de l'Étang-Salé", NOW));
    expect(r.resume).toMatch(/^Qualité de l'air prévue aujourd'hui à L'Étang-Salé : moyen \(2\/6\), surtout ozone/);
    expect(r.indices).toHaveLength(1);
  });

  it("sums up the island", async () => {
    const r = body(await qualiteAir(cache(), undefined, NOW));
    expect(r.resume).toBe("Qualité de l'air prévue aujourd'hui à La Réunion : au pire moyen (2/6) dans toutes les communes.");
    expect(r.communes).toHaveLength(24);
  });
});

// The fixture predates date_dif: the diffusion of 22/10 at 10:45 (06:45 UTC) is set here, as the layer gave it on 28/10.
const diffused = (at: string) => list.map((x) => ({ ...x, diffuse_le: at }));
const YESTERDAY = "2026-10-22T06:45:48Z";

describe("air quality: what the index is and where it comes from", () => {
  it("reads when Atmo Réunion diffused the index (date_dif), and a level 0 or 7 in the guide's words", () => {
    const [x] = parse({ features: [{ properties: { code_zone: "97411", lib_zone: "Saint-Denis", date_ech: "2026-10-29", code_qual: 2, date_dif: YESTERDAY } }] });
    expect(x.diffuse_le).toBe(YESTERDAY);
    expect(parse({ features: [{ properties: { code_zone: "97411", lib_zone: "Saint-Denis", date_ech: "2026-10-29", code_qual: 2 } }] })[0]).not.toHaveProperty("diffuse_le");
    expect([atmo.level(0), atmo.level(2), atmo.level(7)]).toEqual(["indisponible", "moyen", "événement"]);
    // An entry read before date_dif is not kept across the deploy (cache.ts, `outdated`).
    expect(sourceRevision("atmo:974")).toBe(1);
  });

  it("says it is a forecast, diffused the day before, apart from when rundata.re read it", async () => {
    const r = body(await qualiteAir(cache(diffused(YESTERDAY)), "Saint-Denis", NOW));
    expect(r.nature).toBe("PRÉVISION du jour par commune, calculée par Atmo Réunion : pas une mesure.");
    expect(r.diffusion).toBe("Prévision diffusée par Atmo Réunion la veille, le 22/10 à 10:45.");
    expect(r.lu_par_rundata).toBe("23/10 09:00");
    // Diffused the same day: no « la veille ».
    expect(body(await qualiteAir(cache(diffused("2026-10-23T04:30:00Z")), undefined, NOW)).diffusion).toBe("Prévision diffusée par Atmo Réunion le 23/10 à 08:30.");
    expect(body(await qualiteAir(cache(), undefined, NOW))).not.toHaveProperty("diffusion");
  });

  it("names the producer, the layer it is spread by, its licence, and how it is made with the guide's link", async () => {
    const r = body(await qualiteAir(cache(), undefined, NOW));
    expect(r.provenance).toEqual({
      producteur: "Atmo Réunion, observatoire agréé de la qualité de l'air",
      diffuseur: "Atmo France, couche WFS ind_atmo_2021",
      licence: "ODbL 1.0",
      licence_lien: "https://opendatacommons.org/licenses/odbl/1-0/",
      fiche: "https://www.data.gouv.fr/datasets/indice-de-la-qualite-de-lair-quotidien-par-commune-indice-atmo",
      site: "https://www.atmo-reunion.net",
    });
    expect(r.comment_c_est_fait.lien).toBe(atmo.GUIDE);
    expect(r.comment_c_est_fait.etapes[0]).toMatch(/^C'est une prévision : /);
  });

  it("gives each commune's sub-index of every pollutant, not only the worst", async () => {
    const r = body(await qualiteAir(cache(), undefined, NOW));
    expect(r.communes[0].sous_indices).toEqual({ "particules PM10": 1, "particules fines PM2,5": 1, ozone: 2, "dioxyde d'azote": 1, "dioxyde de soufre": 1 });
  });

  it("shows on /air the forecast by its value, its diffusion, our reading, the source and the method", async () => {
    const answer = body(await qualiteAir(cache(diffused(YESTERDAY)), undefined, NOW));
    const page = airPage("https://rundata.re", { value: answer, fetchedAt: NOW, stale: false }, NOW);
    const status = page.slice(page.indexOf('<div class="status">'), page.indexOf("</div>", page.indexOf('<div class="status">')));
    expect(status).toContain("Une prévision d'Atmo Réunion pour la journée, pas une mesure. Prévision diffusée par Atmo Réunion la veille, le 22/10 à 10:45. Lue par rundata.re à 09:00.");
    expect(page).toContain("Prévision du jour</p>");
    expect(page).toContain(`${'<span class="aq aq2">moyen</span>'} prévu dans 24 communes`);
    expect(page).not.toContain("Mis à jour à");
    const source = page.slice(page.indexOf('id="h-source-air"'), page.indexOf("</section>", page.indexOf('id="h-source-air"')));
    expect(source).toContain('<a href="https://www.atmo-reunion.net" rel="noopener">Atmo Réunion</a>');
    expect(source).toContain(`<a href="${atmo.DIFFUSION}" rel="noopener">`);
    expect(source).toContain(`<a href="${atmo.ODBL}" rel="noopener">ODbL 1.0</a>`);
    expect(source).toContain(`<a href="${esc(atmo.GUIDE)}" rel="noopener">guide de calcul de l'indice ATMO</a>`);
    expect(source).toContain("Prévision diffusée par Atmo Réunion la veille, le 22/10 à 10:45. Lue par rundata.re à 09:00.</p>");
    for (const step of atmo.METHODE) expect(source).toContain(esc(step));
    // The sub-indices, a row per commune.
    expect(page.match(/<td data-label="ozone"><span class="aq aq2">moyen<\/span><\/td>/g)).toHaveLength(24);
  });
});
