import { describe, expect, it } from "vitest";
import { INSEE } from "../src/places/insee.js";
import { MARKET, marchesAnswer } from "../src/tools/marches.js";
import { MARCHES } from "../src/vie/marches.js";

const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe("the markets of OpenStreetMap", () => {
  it("are bundled, each in a commune, their days in words when OpenStreetMap gives them", () => {
    expect(MARCHES().length).toBeGreaterThan(15);
    for (const m of MARCHES()) expect(Object.keys(INSEE), m.nom).toContain(m.commune);
    expect(MARCHES().find((m) => m.nom === "Marché forain de Saint-Paul")).toMatchObject({ commune: "Saint-Paul", horaires: "le vendredi de 8 h à 18 h ; le samedi de 8 h à 12 h" });
    expect(MARCHES().some((m) => /brocante/i.test(m.nom))).toBe(false);
  });

  it("give the commune's markets, or the nearest, and say the list is not complete", () => {
    const r = body(marchesAnswer("Saint-Paul"));
    expect(r.resume).toMatch(/^Marchés à Saint-Paul d'après OpenStreetMap : .*Marché forain de Saint-Paul \(le vendredi de 8 h à 18 h ; le samedi de 8 h à 12 h\)/);
    expect(r.avertissements[0]).toMatch(/tous les marchés n'y sont pas/);
    expect(r.sources[0].licence).toBe("ODbL");
    // A commune with none mapped: the nearest, with their distance.
    const without = Object.keys(INSEE).find((c) => !MARCHES().some((m) => m.commune === c))!;
    const w = body(marchesAnswer(without));
    expect(w.resume).toMatch(/^Aucun marché .* dans OpenStreetMap\. Les plus proches : /);
    expect(w.marches).toHaveLength(3);
    // The whole island, by commune.
    expect(Object.keys(body(marchesAnswer(undefined)).par_commune).length).toBeGreaterThan(5);
  });

  it("are asked as markets, not supermarkets", () => {
    for (const q of ["marché", "marchés forains", "marché couvert", "halle"]) expect(MARKET.test(q), q).toBe(true);
    for (const q of ["supermarché", "hypermarché", "mairie", "CAF"]) expect(MARKET.test(q), q).toBe(false);
  });
});
