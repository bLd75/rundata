import { describe, expect, it } from "vitest";
import { INSEE } from "../src/places/insee.js";
import { MARKET, marchesAnswer } from "../src/tools/marches.js";
import { apart, dayOfName, heldOn, hoursOn, jours, lienMairie, MARCHES, type Marche, nearest, permanent, sansJours } from "../src/vie/marches.js";

const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe("the markets of OpenStreetMap", () => {
  it("are bundled, each in a commune, their days in words when OpenStreetMap gives them", () => {
    expect(MARCHES().length).toBeGreaterThan(15);
    for (const m of MARCHES()) expect(Object.keys(INSEE), m.nom).toContain(m.commune);
    // Its town hall's hours prevail over OpenStreetMap's (« Fr 08:00-18:00;Sa 08:00-12:00 »), its position stays OpenStreetMap's.
    expect(MARCHES().find((m) => m.nom === "Marché forain de Saint-Paul")).toMatchObject({ commune: "Saint-Paul", horaires: "le vendredi de 7\u00a0h à 16\u00a0h\u00a0; le samedi de 7\u00a0h à 12\u00a0h", adresse: "Quai Gilbert", lien: "https://www.mairie-saintpaul.re/marches-forains/", lon: expect.any(Number) });
    expect(MARCHES().some((m) => /brocante/i.test(m.nom))).toBe(false);
  });

  it("give the commune's markets, or the nearest, and say the list is not complete", () => {
    const r = body(marchesAnswer("Saint-Paul"));
    expect(r.resume).toMatch(/^Marchés à Saint-Paul : .*Marché forain de Saint-Paul \(le vendredi de 7\u00a0h à 16\u00a0h\u00a0; le samedi de 7\u00a0h à 12\u00a0h\)/);
    expect(r.avertissements[0]).toMatch(/tous les marchés n'y sont pas/);
    expect(r.sources.map((s: { licence: string }) => s.licence)).toEqual(["ODbL 1.0", "Non précisée : cité avec son nom et son lien"]);
    // A commune with none mapped: the nearest, with their distance.
    const without = Object.keys(INSEE).find((c) => !MARCHES().some((m) => m.commune === c))!;
    const w = body(marchesAnswer(without));
    expect(w.resume).toMatch(/^Aucun marché trouvé .* dans OpenStreetMap ni sur les sites de mairie lus\. Les plus proches : /);
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
    // One market, one way (kit.md, 30/10/2026): its Sunday with minutes too, as its week in the tool.
    expect(hoursOn(m("Mo-Sa 06:00-18:30; Su 06:00-12:00"), SUN)).toBe("de 06:00 à 12:00");
    expect(MARCHES().find((x) => x.nom === "Le Petit Marché")?.horaires).toBe("du lundi au samedi de 06:00 à 18:30\u00a0; le dimanche de 06:00 à 12:00");
    expect(hoursOn(m("We 06:00-13:00; Su 06:00-13:00"), SUN)).toBe("de 6\u00a0h à 13\u00a0h");
    expect(hoursOn(m("We,Sa 05:00-08:00,16:00-19:00"), SAT)).toBe("de 5\u00a0h à 8\u00a0h et de 16\u00a0h à 19\u00a0h");
    // Saturday 23:30 UTC is already Sunday at La Réunion.
    expect(hoursOn(m("Su 06:00-12:00"), new Date("2026-10-24T23:30:00Z"))).toBe("de 6\u00a0h à 12\u00a0h");
    expect(hoursOn(m(null), SAT)).toBeUndefined();
  });
});

describe("the markets of the town halls", () => {
  const SAT = new Date("2026-10-24T04:00:00Z");
  const WED = new Date("2026-10-28T04:00:00Z");

  it("take only the town halls whose site allows it, or says nothing against it, each with its page", () => {
    const by = new Set(MARCHES().map((m) => new URL(m.lien).hostname));
    for (const h of by) expect(["www.openstreetmap.org", "www.mairie-saintpaul.re", "www.saintleu.re", "www.ville-saintemarie.re", "saintlouis.re"], h).toContain(h);
    // A market only a town hall gives: its commune from the page, no position, never among the nearest.
    const zac = MARCHES().find((m) => m.nom === "Marché forain de la ZAC Avenir")!;
    expect(zac).toMatchObject({ commune: "Saint-Louis", horaires: "le mercredi de 6\u00a0h à 13\u00a0h" });
    expect(zac.lon).toBeUndefined();
    expect(nearest(55.41, -21.27, 50).some((m) => m.nom === zac.nom)).toBe(false);
    expect(zac.source).toMatchObject({ date: "2020-05-14", licence: expect.stringMatching(/^Reprise permise à fin d'information/) });
    // The others' page, where nothing is taken from them: Le Tampon's home page only.
    expect(lienMairie("Le Tampon")).toBe("https://letampon.fr/");
    expect(lienMairie("Saint-Paul")).toBeUndefined();
  });

  it("read the day a market's OpenStreetMap name or note gives, when it has no hours", () => {
    expect(dayOfName({ nom: "Marché Forain de Saint-Pierre (Samedi Matin)", note: null })).toEqual({ jour: 6, quand: "le matin" });
    expect(dayOfName({ nom: "Marché", note: "uniquememnt le samedi entre 5h et 12h" })).toEqual({ jour: 6, quand: "de 5\u00a0h à 12\u00a0h" });
    expect(dayOfName({ nom: "Marché le Mercredi", note: null })).toEqual({ jour: 3 });
    expect(dayOfName({ nom: "Marché couvert", note: null })).toBeUndefined();
    expect(dayOfName({ nom: "Marché du samedi et du dimanche", note: null })).toBeUndefined();
    expect(jours({ nom: "Marché Forain de Saint-Pierre (Samedi Matin)", note: null, horaires: null })).toBe("le samedi matin");
  });

  it("keep a market open all week apart, never as the market of the day, and never drop one without days", () => {
    expect(permanent({ horaires_osm: "Mo-Sa 07:00-17:00" })).toBe(true);
    expect(permanent({ horaires_osm: "Tu-Sa 09:00-18:00;Su 09:00-13:00" })).toBe(true);
    expect(permanent({ horaires_osm: "Fr 07:00-16:00;Sa 07:00-12:00" })).toBe(false);
    expect(permanent({ horaires_osm: "Sa-Mo 06:00-12:00" })).toBe(false);
    expect(heldOn("Saint-Pierre", SAT).map((m) => [m.nom, m.horaires_aujourd_hui])).toEqual([["Marché Forain de Saint-Pierre (Samedi Matin)", "le matin"]]);
    expect(heldOn("Saint-Pierre", WED)).toEqual([]);
    expect(apart("Saint-Pierre", WED).map((m) => m.nom)).toEqual(["Marché couvert de Saint-Pierre"]);
    expect(apart("Saint-Pierre", new Date("2026-10-25T04:00:00Z"))[0].horaires_aujourd_hui).toBe("fermé aujourd'hui");
    expect(heldOn("Saint-Leu", SAT).map((m) => m.nom)).toEqual(["Marché forain de Saint-Leu"]);
    expect(apart("Saint-Leu", SAT).map((m) => m.nom)).toEqual(["Marché artisanal de Saint-Leu"]);
    expect(sansJours("Le Tampon").map((m) => m.nom)).toContain("Marché Couvert du Tampon");
    for (const m of MARCHES()) expect([heldOn(m.commune, SAT), apart(m.commune, SAT), sansJours(m.commune)].flat().map((x) => x.nom).concat(jours(m) ? [m.nom] : []), m.nom).toContain(m.nom);
  });
});
