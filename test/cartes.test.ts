import { describe, expect, it } from "vitest";
import { COMMON } from "../src/tools/eau.js";
import type { EauAnswer, HistoriqueAnswer, SeaData } from "../src/web/data.js";
import { eauPage, historiquePage } from "../src/web/domains.js";
import { seaPage } from "../src/web/pages.js";
import { deadAnchors, doubleIds, mapLinks } from "./cartes.js";

const NOW = new Date("2026-10-24T06:00:00Z");
const cached = <T>(value: T) => ({ value, fetchedAt: NOW, stale: false });

describe("the maps of the pages read from a bundle or a database", () => {
  it("lead each bathing site to its line on /eau", () => {
    const site = (s: string, commune: string, lon: number, lat: number, q: string) => ({
      site: s, commune, lon, lat, qualite_dernier_prelevement: q, dernier_prelevement: "20/10/2026", derniers_prelevements: [], mauvais_sur_12_mois: 0,
    });
    const value = {
      baignades: [site("Plage de l'Hermitage", "Saint-Paul", 55.22, -21.08, "bonne"), site("Bassin Manapany", "Saint-Joseph", 55.6, -21.37, "moyenne")],
      communes: [],
      lu: NOW.toISOString(),
      a_savoir: COMMON,
      sources: [],
    } as unknown as EauAnswer;
    const page = eauPage("https://rundata.re", cached(value), NOW);
    expect(mapLinks(page).map((l) => l.href)).toEqual(["#b-plage-de-l-hermitage", "#b-bassin-manapany"]);
    expect(mapLinks(page)[1].label).toBe("Bassin Manapany : qualité moyenne au dernier prélèvement, voir le détail");
    expect(deadAnchors(page)).toEqual([]);
    expect(doubleIds(page)).toEqual([]);
  });

  it("lead each station of the rain map to its row on /historique", () => {
    const station = (s: string, lon: number, lat: number, rapport: string) => ({
      zone: "Nord", station: s, altitude_m: 10, lon, lat, pluie: { total_mm: 20, jours_de_pluie: 3, normale_mm: 60, rapport_a_la_normale: rapport },
    });
    const value: HistoriqueAnswer = {
      resume: "",
      periode: { du: "24/09/2026", au: "23/10/2026", jours: 30 },
      stations: [station("Saint-Denis-Gillot", 55.52, -20.89, "33 %"), station("Plaine des Cafres", 55.57, -21.21, "120 %")],
      a_savoir: [],
      sources: [],
    };
    const page = historiquePage("https://rundata.re", cached(value), NOW);
    expect(mapLinks(page).map((l) => l.href)).toEqual(["#s-saint-denis-gillot", "#s-plaine-des-cafres"]);
    expect(mapLinks(page)[0].label).toBe("Saint-Denis-Gillot : 33\u00a0% de la pluie normale en 30\u00a0jours, voir le détail");
    expect(deadAnchors(page)).toEqual([]);
    expect(doubleIds(page)).toEqual([]);
  });

  it("lead each beach of the sea map to its line on /mer", () => {
    const value: SeaData = {
      plages: [
        { nom: "Plage de Boucan Canot", commune: "Saint-Paul", lon: 55.22, lat: -21.03, valeur: 25.4, jour: "2026-10-22", distance_km: 3 },
        { nom: "Plage de Grande Anse", commune: "Petite-Île", lon: 55.55, lat: -21.37, valeur: 24.1, jour: "2026-10-22", distance_km: 4 },
      ],
      sources: [],
    } as SeaData;
    const page = seaPage("https://rundata.re", cached(value), NOW);
    expect(mapLinks(page).map((l) => l.href)).toEqual(["#p-plage-de-boucan-canot", "#p-plage-de-grande-anse"]);
    expect(mapLinks(page)[0].label).toMatch(/ : eau à 25 °C, voir le détail$/);
    expect(deadAnchors(page)).toEqual([]);
    expect(doubleIds(page)).toEqual([]);
  });

  it("keep two close markers' hit areas apart, so that a tap between them goes to the nearer", () => {
    const value = cached({
      plages: [
        { nom: "Plage A", commune: "Saint-Paul", lon: 55.22, lat: -21.03, valeur: 25, jour: "2026-10-22", distance_km: 3 },
        { nom: "Plage B", commune: "Saint-Paul", lon: 55.287, lat: -21.03, valeur: 25, jour: "2026-10-22", distance_km: 3 },
        { nom: "Plage C", commune: "Saint-Joseph", lon: 55.6, lat: -21.37, valeur: 24, jour: "2026-10-22", distance_km: 3 },
      ],
      sources: [],
    } as SeaData);
    const hits = [...seaPage("https://rundata.re", value, NOW).matchAll(/<circle class="hit" cx="(\d+)" cy="(\d+)" r="(\d+)"/g)].map((m) => m.slice(1).map(Number));
    const [a, b, c] = hits;
    // A and B about 100 units apart: each at most half the way, so they never overlap; C, alone, the full size.
    expect(a[2]).toBeLessThan(66);
    expect(a[2] + b[2]).toBeLessThanOrEqual(Math.hypot(a[0] - b[0], a[1] - b[1]));
    expect(c[2]).toBe(66);
  });

  it("draw two close beaches' discs apart, never one over the other (Boucan-Canot and L'Hermitage, both 26°, the review of 31/10)", () => {
    const value = cached({
      plages: [
        { nom: "Plage de Boucan Canot", commune: "Saint-Paul", lon: 55.224, lat: -21.028, valeur: 25.6, jour: "2026-10-29", distance_km: 3 },
        { nom: "Plage de l'Hermitage", commune: "Saint-Paul", lon: 55.222, lat: -21.077, valeur: 25.7, jour: "2026-10-29", distance_km: 3 },
      ],
      sources: [],
    } as SeaData);
    const discs = [...seaPage("https://rundata.re", value, NOW).matchAll(/<circle class="sh" cx="([\d.]+)" cy="([\d.]+)" r="(\d+)"/g)].map((m) => m.slice(1).map(Number));
    expect(discs).toHaveLength(2);
    const [a, b] = discs;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(a[2] + b[2]);
  });
});
