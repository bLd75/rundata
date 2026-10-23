import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { latestAct, planOf } from "../src/providers/terrain.js";
import { ficheLieu, market, riskLine } from "../src/tools/terrain.js";

// Real answers of 23/10/2026 for 7 rue de la Buse, Saint-Paul: parcel BO 552, zone U1c, 115 sales since 2021.
const raw = (f: string) => readFileSync(new URL(`./fixtures/terrain/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-23T05:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const urls: string[] = [];
// Fixtures per URL kind; a test may swap one (sup-ppr.json, mvt-proche.json: a point of Saint-Denis in its PPR).
let files: Record<string, string> = {};

beforeEach(() => {
  urls.length = 0;
  files = { "assiette-sup": "sup.json", catnat: "catnat.json", "api/v1/mvt": "mvt.json" };
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    const u = String(url);
    const extra = Object.entries(files).find(([k]) => u.includes(k));
    const f = extra ? extra[1] : u.includes("geocodage") ? "geocode.json" : u.includes("cadastre") ? "parcelle.json" : u.includes("zone-urba") ? "zone.json" : u.includes("altimetrie") ? "alti.json" : u.includes("dvf") ? "dvf.json" : null;
    if (!f) throw new Error(`unexpected ${u}`);
    return new Response(raw(f));
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("fiche terrain", () => {
  it("gives medians only, houses and flats sold alone", () => {
    const sales = JSON.parse(raw("dvf.json")).features.map(({ properties: p }: { properties: Record<string, string> }) => ({
      annee: Number(p.anneemut), type: p.libtypbien, code: p.codtypbien, valeur: Number(p.valeurfonc),
      surface_bati: Number(p.sbati), surface_terrain: Number(p.sterr), lots: Number(p.nblocmut),
    }));
    const m = market(sales);
    expect(m.toutes_ventes).toBe(115);
    expect(m.maisons.ventes).toBeGreaterThan(3);
    expect(JSON.stringify(m)).not.toMatch(/BO|0552|rue/i);
  });

  it("reads an address: parcel, PLU zone, altitude, market", async () => {
    const r = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "7 rue de la Buse, Saint-Paul", NOW));
    expect(r.resume).toMatch(/^7 Rue de la Buse 97460 Saint-Paul \(adresse exacte\) ; altitude 5 m ; parcelle cadastrale BO 0552 \(2416 m²\) ; zone U1c du PLU, zone urbaine/);
    expect(r.urbanisme.approuve_le).toBe("27/09/2012");
    expect(urls[0]).toContain("geocodage");
  });

  it("takes a known place from the gazetteer without geocoding", async () => {
    await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "Cilaos", NOW);
    expect(urls.some((u) => u.includes("geocodage"))).toBe(false);
  });

  it("adds the risks: no plan at this address, CatNat of the commune, nothing slid around", async () => {
    const r = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "7 rue de la Buse, Saint-Paul", NOW));
    expect(r.resume).toContain("hors des zones réglementées des plans de prévention des risques");
    expect(r.risques.plans_de_prevention).toMatch(/aucune zone réglementée/);
    expect(r.risques.catastrophes_naturelles.arretes_dans_la_commune).toBeGreaterThan(5);
    expect(r.risques.catastrophes_naturelles.derniers[0].du).toBe("13/01/2024");
    expect(r.risques.mouvements_de_terrain_recenses.nombre).toBe(0);
    expect(r.risques.radon).toMatch(/catégorie 1/);
    expect(urls.some((u) => u.includes("code_insee=97415"))).toBe(true);
  });

  it("says when the point is in a PPR's regulated zone, with the plan and its landslides", async () => {
    files["assiette-sup"] = "sup-ppr.json";
    files["api/v1/mvt"] = "mvt-proche.json";
    const r = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "-20.90132, 55.44154", NOW));
    expect(r.resume).toContain("dans une zone réglementée (rouge ou bleue) du plan de prévention des risques naturels (inondation, mouvements de terrain)");
    expect(r.risques.plans_de_prevention[0]).toMatchObject({ approuve_ou_revise_le: "17/10/2012", servitudes_publiees: expect.stringContaining("/document/by-id/") });
    // The commune comes from the parcel (fixture: Saint-Paul's), as coordinates name none.
    expect(r.risques.catastrophes_naturelles.arretes_dans_la_commune).toBeGreaterThan(5);
    expect(r.lieu.label).toBe("point -20.9013, 55.4415");
    expect(r.risques.mouvements_de_terrain_recenses.nombre).toBe(2);
    expect(r.risques.mouvements_de_terrain_recenses.plus_proches[0].distance_m).toBeLessThan(500);
  });

  it("reads plan names and act dates", () => {
    expect(latestAct("PM1_PPR_i_SAINTE_ROSE_20190620_act.pdf|PM1_PPR_i_mvt_SAINTE_ROSE_20221929_act.pdf|PM1_PPR_i_SAINTE_ROSE_20110125_act.pdf")).toBe("2019-06-20");
    expect(planOf({ suptype: "pm1", nomass: "PM1_PPR_i_mvt_alea_cotier_LE_PORT_gen2_ass", typeass: "Enveloppe des zonages réglementaires", fichier: "" })?.risques).toEqual(["inondation", "mouvements de terrain", "aléa côtier"]);
    expect(planOf({ suptype: "pm1", nomass: "PM1_PPR_l_SAINT_LEU_gen2_ass", typeass: "Enveloppe des zonages réglementaires", fichier: "" })?.risques).toEqual(["recul du trait de côte et submersion marine"]);
    expect(planOf({ suptype: "pm1", nomass: "PM1_PPR_i_MVT_SAINTE_MARIE_gen2_ass", typeass: "", fichier: "" })?.risques).toEqual(["inondation", "mouvements de terrain"]);
    expect(planOf({ suptype: "pm3", nomass: "PM3_407_Depot_hydrocarbures_liquides_SRPP_gen_ass", typeass: "", fichier: "" })?.nom).toBe("Depot hydrocarbures liquides SRPP");
    expect(planOf({ suptype: "ac1", nomass: "x", typeass: "", fichier: "" })).toBeNull();
    expect(riskLine([])).toMatch(/^hors des zones/);
  });
});
