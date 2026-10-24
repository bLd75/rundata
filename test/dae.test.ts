import { describe, expect, it } from "vitest";
import { DAES } from "../src/providers/dae.js";
import { access, defibrillateurs } from "../src/tools/dae.js";
import { buildDae } from "../src/web/data.js";
import { daePage } from "../src/web/domains.js";
import { deadAnchors, doubleIds, mapLinks } from "./cartes.js";

const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe("défibrillateurs", () => {
  it("bundles the island's devices, each in one of the 24 communes", () => {
    expect(DAES.length).toBeGreaterThan(1000);
    expect(new Set(DAES.map((d) => d.commune)).size).toBe(24);
    expect(DAES.every((d) => !/\s-\s[A-Z0-9]*\d{5,}/.test(d.nom))).toBe(true);
  });

  it("leads from each commune's marker to its card", async () => {
    const page = daePage("https://rundata.re", { value: await buildDae(), fetchedAt: new Date(), stale: false });
    expect(mapLinks(page)).toHaveLength(24);
    expect(mapLinks(page).find((l) => l.href === "#c-cilaos")?.label).toMatch(/^Cilaos : \d+ défibrillateurs, voir le détail$/);
    expect(deadAnchors(page)).toEqual([]);
    expect(doubleIds(page)).toEqual([]);
  });

  it("says how a device can be reached", () => {
    expect(access({ nom: "", adresse: "", commune: "", lon: 0, lat: 0, exterieur: true, acces_libre: true })).toBe("à l'extérieur, accessible à toute heure");
    expect(access({ nom: "", adresse: "", commune: "", lon: 0, lat: 0, exterieur: false, acces_libre: false, horaires: "24 h/24, 7 j/7" })).toBe("accessible 24 h/24");
    expect(access({ nom: "", adresse: "", commune: "", lon: 0, lat: 0, exterieur: false, acces_libre: true })).toBe("en accès libre aux heures d'ouverture du lieu");
  });

  it("gives the nearest ones, nearest first, after the emergency numbers", () => {
    const b = body(defibrillateurs("Cilaos"));
    expect(b.resume).toMatch(/^Arrêt cardiaque : appeler le 15 ou le 112\. Défibrillateur le plus proche \(Cilaos\) : /);
    const d = b.defibrillateurs.map((x: { distance_m: number }) => x.distance_m);
    expect(d).toEqual([...d].sort((x, y) => x - y));
    expect(b.defibrillateurs[0].carte).toMatch(/^https:\/\/www\.openstreetmap\.org\//);
    expect(b.urgence).toMatch(/massage cardiaque/);
  });
});
