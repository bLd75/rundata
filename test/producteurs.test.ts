import { describe, expect, it } from "vitest";
import { AGENDAS } from "../src/providers/agenda.js";
import { commune, compte, FAMILLES, FICHES, producteursDe } from "../src/producteurs.js";
import { toutesLesSources } from "../src/server.js";

// Every source, those of a base or a key the tests lack included.
const sources = toutesLesSources(true);
// Their producers counted live from the source's last copy (chiffres.ts), or unknown to the code (producteurs.ts).
const SANS_PRODUCTEUR_ICI = ["gpu_zone_urba", "sportsregions"];

describe("the producers and licences of the sources (producteurs.ts)", () => {
  it("have an entry for every source read, and none for a source no longer read", () => {
    expect(sources.filter((s) => !FICHES[s.id]).map((s) => s.id)).toEqual([]);
    expect(Object.keys(FICHES).filter((id) => !sources.some((s) => s.id === id))).toEqual([]);
  });

  it("give every counted source a producer, but those counted live or unknown here", () => {
    const sans = sources.filter((s) => !FICHES[s.id].horsCompte && !producteursDe(s).length).map((s) => s.id);
    expect(sans.sort()).toEqual([...SANS_PRODUCTEUR_ICI].sort());
  });

  it("take the mairies' and the salles' producers from the agendas that read them", () => {
    for (const [id, f] of Object.entries(FICHES).filter(([, f]) => f.agendas)) {
      const s = sources.find((x) => x.id === id)!;
      expect(producteursDe(s).length, id).toBe(new Set(AGENDAS.filter((a) => a.source.id === id).map((a) => a.site_commune ? a.commune : a.nom)).size);
      expect(producteursDe(s).length, id).toBeGreaterThan(0);
    }
    expect(commune("Le Port")).toBe("Commune du Port");
    expect(commune("Les Trois-Bassins")).toBe("Commune des Trois-Bassins");
    expect(commune("Saint-Leu")).toBe("Commune de Saint-Leu");
  });

  it("name each producer once, alone, by its canonical name", () => {
    const all = sources.flatMap((s) => producteursDe(s));
    // One body per name: never a list, a relay or a mairie's own wording.
    expect(all.filter((p) => /[,;]|diffusé|republié|d'après|^(?:Ville|Mairie) /i.test(p))).toEqual([]);
    // The same body never under two spellings.
    const key = (p: string) => p.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
    const spellings = new Map<string, Set<string>>();
    for (const p of all) spellings.set(key(p), (spellings.get(key(p)) ?? new Set()).add(p));
    expect([...spellings.values()].filter((v) => v.size > 1).map((v) => [...v])).toEqual([]);
  });

  it("count the sources, their producers and their open licences, the clubs' proposals and linked platforms left out", () => {
    const c = compte(sources);
    expect(c.sources).toBe(sources.length - 2);
    expect(c.producteurs).toContain("Commune de Sainte-Marie");
    expect(c.producteurs).toContain("CIREST");
    expect(c.producteurs).not.toContain("Open-Meteo");
    const open = (Object.keys(FAMILLES) as (keyof typeof FAMILLES)[]).filter((f) => FAMILLES[f].ouverte);
    expect(c.ouvertes).toBe(open.reduce((n, f) => n + (c.licences[f] ?? 0), 0));
    expect(Object.values(c.licences).reduce((a, b) => a + b, 0)).toBe(c.sources);
  });
});
