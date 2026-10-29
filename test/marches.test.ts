import { describe, expect, it } from "vitest";
import { INSEE } from "../src/places/insee.js";
import { MARKET, marchesAnswer } from "../src/tools/marches.js";
import { hoursOn, MARCHES, type Marche } from "../src/vie/marches.js";

const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe("the markets of OpenStreetMap", () => {
  it("are bundled, each in a commune, their days in words when OpenStreetMap gives them", () => {
    expect(MARCHES().length).toBeGreaterThan(15);
    for (const m of MARCHES()) expect(Object.keys(INSEE), m.nom).toContain(m.commune);
    expect(MARCHES().find((m) => m.nom === "Marché forain de Saint-Paul")).toMatchObject({ commune: "Saint-Paul", horaires: "le vendredi de 8\u00a0h à 18\u00a0h\u00a0; le samedi de 8\u00a0h à 12\u00a0h" });
    expect(MARCHES().some((m) => /brocante/i.test(m.nom))).toBe(false);
  });

  it("give the commune's markets, or the nearest, and say the list is not complete", () => {
    const r = body(marchesAnswer("Saint-Paul"));
    expect(r.resume).toMatch(/^Marchés à Saint-Paul d'après OpenStreetMap : .*Marché forain de Saint-Paul \(le vendredi de 8\u00a0h à 18\u00a0h\u00a0; le samedi de 8\u00a0h à 12\u00a0h\)/);
    expect(r.avertissements[0]).toMatch(/tous les marchés n'y sont pas/);
    expect(r.sources[0].licence).toBe("ODbL 1.0");
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

describe("a market's day", () => {
  const m = (horaires_osm: string | null) => ({ horaires_osm }) as Marche;
  // Friday 23, Saturday 24 and Sunday 25 October 2026, in the morning at La Réunion.
  const FRI = new Date("2026-10-23T04:00:00Z");
  const SAT = new Date("2026-10-24T04:00:00Z");
  const SUN = new Date("2026-10-25T04:00:00Z");

  it("reads its OpenStreetMap days and hours for the day asked, in La Réunion's time", () => {
    expect(hoursOn(m("Fr 08:00-18:00;Sa 08:00-12:00"), FRI)).toBe("de 8\u00a0h à 18\u00a0h");
    expect(hoursOn(m("Fr 08:00-18:00;Sa 08:00-12:00"), SAT)).toBe("de 8\u00a0h à 12\u00a0h");
    expect(hoursOn(m("Fr 08:00-18:00;Sa 08:00-12:00"), SUN)).toBeUndefined();
    expect(hoursOn(m("Mo-Sa 06:00-18:30; Su 06:00-12:00"), SAT)).toBe("de 06:00 à 18:30");
    expect(hoursOn(m("We 06:00-13:00; Su 06:00-13:00"), SUN)).toBe("de 6\u00a0h à 13\u00a0h");
    expect(hoursOn(m("We,Sa 05:00-08:00,16:00-19:00"), SAT)).toBe("de 5\u00a0h à 8\u00a0h et de 16\u00a0h à 19\u00a0h");
    // Saturday 23:30 UTC is already Sunday at La Réunion.
    expect(hoursOn(m("Su 06:00-12:00"), new Date("2026-10-24T23:30:00Z"))).toBe("de 6\u00a0h à 12\u00a0h");
    expect(hoursOn(m(null), SAT)).toBeUndefined();
  });
});
