import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { latestAct, planOf, SOURCES } from "../src/providers/terrain.js";
import { SOURCES as TRACES } from "../src/providers/traces.js";
import { ficheLieu, market, riskLine, sameStreet } from "../src/tools/terrain.js";

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
  it("names the IGN's altitudes as the trails do: one definition, the same text everywhere", () => {
    expect(SOURCES.alti).toBe(TRACES.ign);
    expect(SOURCES.alti).toMatchObject({ id: "ign_altimetrie", nom: "Altitudes du sol (RGE ALTI, service d'altimétrie de la Géoplateforme)", attribution: "IGN, RGE ALTI" });
  });

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

  it("knows the street asked from another, by its name", () => {
    // Shortened, without accents, without the commune, with the quarter the address base adds, one letter off.
    for (const [asked, found] of [
      ["rue Auguste Techer, Saint-Pierre", "Rue Auguste Techer"],
      ["7 rue de la Buse, Saint-Paul", "Rue de la Buse"],
      ["rue Juliette Dodu", "Rue Juliette Dodu"],
      ["rue juliette dodu saint denis", "Rue Juliette Dodu"],
      ["rue Leconte de Lisle, Saint-Denis", "Rue Charles Marie Leconte de Lisle"],
      ["rue Lecomte de Lisle", "Rue Leconte de Lisle"],
      ["12 rue Beaudelaire, Saint-Pierre", "Rue Beaudelaire Ravine des Cabris"],
      ["rue Auguste Techer Ravine des Cabris", "Rue Auguste Techer"],
      ["av de la victoire, St-Denis", "Avenue de la Victoire"],
      ["rue du general de gaulle", "Rue du Général de Gaulle"],
    ]) expect(sameStreet(asked, found), `${asked} → ${found}`).toBe(true);
    for (const [asked, found] of [
      ["rue Auguste Escher, Ravine des Cabris", "Rue Beaudelaire Ravine des Cabris"],
      ["allée des Daturas, Ravine des Cabris", "Rue Beaudelaire Ravine des Cabris"],
      ["allée des Daturas", "Impasse des Daturas"],
      ["rue Auguste Escher", "Rue Auguste Techer"],
    ]) expect(sameStreet(asked, found), `${asked} → ${found}`).toBe(false);
  });

  it("says when the address base finds another street, gives nothing of it, and names the streets close by", async () => {
    // Real answers of 25/10/2026 (avis #12): the base's best match is another street of Ravine des Cabris.
    files = { citycode: "voies-escher.json", geocodage: "geocode-escher.json" };
    const r = await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "rue Auguste Escher, Ravine des Cabris", NOW);
    expect(r.isError).toBe(true);
    const b = body(r);
    expect(b.erreur).toBe("Voie introuvable dans la Base adresse nationale\u00a0: «\u00a0rue Auguste Escher, Ravine des Cabris\u00a0». Sa réponse la plus approchante, «\u00a0Rue Beaudelaire Ravine des Cabris\u00a0» (Saint-Pierre), est une autre voie\u00a0: pas de cadastre, de prix, d'urbanisme ni de risques pour une voie autre que celle demandée.");
    expect(b.voies_proches[0]).toBe("Rue Auguste Techer, Saint-Pierre");
    expect(b.conseil).toBe("Voies au nom proche à Saint-Pierre, d'après la Base adresse nationale\u00a0: Rue Auguste Techer, Rue Auguste Babet, Rue Auguste Langlois, Rue Auguste Toussaint, Rue Auguste Lacaussade. Demander à l'utilisateur laquelle est la bonne, puis redemander avec ce nom et la commune\u00a0; ne pas en choisir une à sa place.");
    // Neither the parcel, nor the zone, nor the sales of the other street; one more call to the address base.
    expect(urls.every((u) => u.includes("geocodage"))).toBe(true);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toMatch(/citycode=97416&type=street/);

    files = { citycode: "voies-daturas.json", geocodage: "geocode-daturas.json" };
    const d = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "allée des Daturas, Ravine des Cabris", NOW));
    expect(d.voies_proches).toEqual(["Impasse des Daturas, Saint-Pierre"]);
    expect(d.conseil).toBe("Voie au nom proche à Saint-Pierre, d'après la Base adresse nationale\u00a0: Impasse des Daturas. Demander à l'utilisateur si c'est la bonne, puis redemander avec ce nom et la commune\u00a0; ne pas la choisir à sa place.");
    // Without a street close by.
    files = { citycode: "voies-aucune.json", geocodage: "geocode-daturas.json" };
    const none = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "allée des Daturas, Ravine des Cabris", NOW));
    expect(none.voies_proches).toBeUndefined();
    expect(none.conseil).toBe("Aucune voie au nom proche à Saint-Pierre dans la Base adresse nationale. Demander à l'utilisateur de vérifier le nom de la voie, puis redemander avec la commune, ou avec un lieu-dit.");
    expect([d.cadastre, d.urbanisme, d.marche_immobilier, d.risques]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("still reads the street asked, written right", async () => {
    files = { ...files, geocodage: "geocode-techer.json" };
    const r = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "rue Auguste Techer, Saint-Pierre", NOW));
    expect(r.resume).toMatch(/^Rue Auguste Techer 97432 Saint-Pierre \(milieu de la rue\) ; /);
    expect(urls.filter((u) => u.includes("geocodage"))).toHaveLength(1);
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

  it("tries Géorisques again when a call fails, as about one in two does from a Worker", async () => {
    let fails = 2;
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes("catnat") && fails-- > 0 ? new Response("", { status: 520 }) : inner(url)));
    const r = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "7 rue de la Buse, Saint-Paul", NOW));
    expect(r.risques.catastrophes_naturelles.arretes_dans_la_commune).toBeGreaterThan(5);
  });
});
