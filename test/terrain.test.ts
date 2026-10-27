import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { codeVoie, latestAct, planOf, SOURCES, streetSales, VEFA as VEFA_NATURE } from "../src/providers/terrain.js";
import { SOURCES as TRACES } from "../src/providers/traces.js";
import { communeOf, ficheLieu, market, riskLine, sameStreet, streetLine, streetMarket } from "../src/tools/terrain.js";

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
    // DVF géolocalisées: one file a year, made up in its layout (geo-dvf.csv), for 2024 only.
    if (u.includes("geo-dvf")) return u.includes("/2024/") ? new Response(raw("geo-dvf.csv")) : new Response("", { status: 404 });
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

  it("gives medians only, houses and flats with their outbuildings, exchanges left out", () => {
    const sales = JSON.parse(raw("dvf.json")).features.map(({ properties: p }: { properties: Record<string, string> }) => ({
      annee: Number(p.anneemut), type: p.libtypbien, code: p.codtypbien, valeur: Number(p.valeurfonc),
      surface_bati: Number(p.sbati), surface_terrain: Number(p.sterr), lots: Number(p.nblocmut),
      nature: p.libnatmut,
    }));
    const m = market(sales);
    // 115 sales read, one of them an exchange.
    expect(m.toutes_ventes).toBe(114);
    expect(m.maisons).toMatchObject({ ventes: 16, prix_m2_median: "5\u202f130\u00a0€/m²" });
    // Sold with a parking or a cellar, and off plan: 63 flats, where the parcel's lot alone kept 3.
    expect(m.appartements).toMatchObject({ ventes: 63, prix_m2_median: "5\u202f120\u00a0€/m²" });
    // 30 of them sold off plan: the median of the 33 others beside, 1 300 €/m² lower. No house sold off plan.
    expect(m.appartements).toMatchObject({ dont_vefa: 30, ventes_hors_vefa: 33, prix_m2_median_hors_vefa: "3\u202f810\u00a0€/m²" });
    expect(m.maisons).not.toHaveProperty("dont_vefa");
    expect(JSON.stringify(m)).not.toMatch(/BO|0552|rue/i);
  });

  it("counts each sale on the street once, by the land registry's street code", () => {
    expect(codeVoie("97416_1281")).toBe("1281");
    expect(codeVoie("97415_0260_00007")).toBe("0260");
    // A street the address base names on its own: DVF does not know it.
    expect(codeVoie("97415_xutypl")).toBeUndefined();
    const sales = streetSales(raw("geo-dvf.csv"), "0260");
    // A house on two lines (two kinds of land) is one sale; an exchange is none; a house sold with a field on another
    // street is one sale, at its one price.
    expect(sales.map((x) => x.type).sort()).toEqual(["appartement", "appartement", "maison", "maison", "maison", "maison", "maison", "maison", "maison", "terrain"]);
    expect(sales.filter((x) => x.valeur === 420_000)).toEqual([{ annee: 2024, type: "maison", valeur: 420_000, surface_bati: 130, surface_terrain: 3500, vefa: false }]);
    expect(sales.find((x) => x.valeur === 200_000)).toMatchObject({ surface_bati: 100, surface_terrain: 600 });
  });

  it("counts a sale DVF records twice once, on the same parcels and lots at the same value", () => {
    const head = raw("geo-dvf.csv").split("\n")[0];
    const cols = head.split(",");
    // One line of a made-up street, with the shape of a new building's sales: a flat and its outbuildings, each a lot.
    const line = (id: string, date: string, nature: string, valeur: number, lot: string, type: string, bati = "") => {
      const c: Record<string, string> = {
        id_mutation: id, date_mutation: date, numero_disposition: "000001", nature_mutation: nature, valeur_fonciere: String(valeur),
        adresse_numero: "47", adresse_nom_voie: "RUE DES TAMARINS", adresse_code_voie: "0999", code_commune: "97411", id_parcelle: "97411000ZZ0001",
        lot1_numero: lot, code_type_local: type, type_local: type === "2" ? "Appartement" : "Dépendance", surface_reelle_bati: bati,
      };
      return cols.map((k) => c[k] ?? "").join(",");
    };
    const VEFA = "Vente en l'état futur d'achèvement";
    const flat = (id: string, date: string, nature: string, valeur: number, lots: string[], bati: number) =>
      [line(id, date, nature, valeur, lots[0], "2", String(bati)), ...lots.slice(1).map((l) => line(id, date, nature, valeur, l, "3"))];
    const csv = [head,
      ...flat("2021-A1", "2021-04-09", VEFA, 537_300, ["112", "125", "126"], 87),
      ...flat("2021-A2", "2021-04-16", VEFA, 329_621, ["113", "134"], 46),
      ...flat("2021-A3", "2021-06-17", VEFA, 339_621, ["114", "138"], 49),
      ...flat("2021-A4", "2021-02-11", VEFA, 458_205, ["159", "139"], 70),
      ...flat("2021-A5", "2021-07-08", VEFA, 336_616, ["108", "146"], 57),
      ...flat("2021-B1", "2021-10-18", "Vente", 320_000, ["109", "133"], 49),
      // The same flat, outbuildings and price, recorded twice in two months: one sale.
      ...flat("2021-B2", "2021-08-04", "Vente", 788_000, ["162", "147", "148"], 104),
      ...flat("2021-B3", "2021-10-18", "Vente", 788_000, ["148", "162", "147"], 104),
    ].join("\n");
    const sales = streetSales(csv, "0999");
    // Off plan or not, one median of the flats: 7 sales, the one recorded twice counted once (8 gave 6 740 €/m²).
    expect(sales.map((s) => s.type)).toEqual(Array(7).fill("appartement"));
    expect(sales.filter((s) => s.vefa)).toHaveLength(5);
    const v = streetMarket("Rue des Tamarins", 2021, sales);
    // 5 of them off plan: said, but 2 others are too few for a median of their own.
    expect(v.appartements).toEqual({ ventes: 7, prix_median: "340\u202f000\u00a0€", prix_m2_median: "6\u202f550\u00a0€/m²", dont_vefa: 5, ventes_hors_vefa: 2 });
    expect(streetLine(v)).toBe("sur la voie (Rue des Tamarins) depuis 2021 : appartements 6\u202f550\u00a0€/m² en médiane (7 ventes dont 5 de neuf sur plan)");
    // Another price for the same lots is another sale.
    expect(streetSales(csv.replace(/2021-B3,(.*?),788000/g, "2021-B3,$1,790000"), "0999")).toHaveLength(8);
  });

  it("gives the street's medians from 3 sales of a kind, as the area's, its count alone below", () => {
    const house = (valeur: number) => ({ annee: 2022, type: "maison" as const, valeur, surface_bati: 100, surface_terrain: 500 });
    expect(streetMarket("Chemin Rangama", 2021, [house(250_000), house(300_000)])).toEqual({
      voie: "Chemin Rangama", depuis: 2021, ventes: 2, note: "2 ventes enregistrées dans DVF sur la voie depuis 2021, trop peu pour une médiane",
    });
    expect(streetMarket("Chemin Rangama", 2021, [house(250_000)]).note).toBe("1 vente enregistrée dans DVF sur la voie depuis 2021, trop peu pour une médiane");
    expect(streetMarket("Chemin Rangama", 2021, []).note).toBe("aucune vente enregistrée dans DVF sur la voie depuis 2021");
    const three = streetMarket("Rue de la Buse", 2021, [250_000, 300_000, 320_000].map(house));
    expect(three.maisons).toEqual({ ventes: 3, prix_median: "300\u202f000\u00a0€", prix_m2_median: "3\u202f000\u00a0€/m²" });
    expect(three.appartements).toEqual({ ventes: 0 });
    // Three sales in all, of three kinds: the count, no median of one sale.
    const mixed = streetMarket("Rue de la Buse", 2021, [house(250_000), { ...house(200_000), type: "appartement" }, { annee: 2022, type: "terrain", valeur: 90_000, surface_bati: 0, surface_terrain: 600 }]);
    expect([mixed.maisons, mixed.appartements, mixed.terrains_nus]).toEqual([{ ventes: 1 }, { ventes: 1 }, { ventes: 1 }]);
  });

  it("counts the sales off plan apart, the median of the others only from 3 of each", () => {
    const flat = (valeur: number, vefa: boolean) => ({ annee: 2023, type: "appartement" as const, valeur, surface_bati: 50, surface_terrain: 0, vefa });
    const others = [150_000, 160_000, 170_000].map((x) => flat(x, false));
    const offPlan = [300_000, 320_000, 340_000].map((x) => flat(x, true));
    const mixed = streetMarket("Rue des Tamarins", 2021, [...others, ...offPlan]);
    expect(mixed.appartements).toEqual({ ventes: 6, prix_median: "235\u202f000\u00a0€", prix_m2_median: "4\u202f700\u00a0€/m²", dont_vefa: 3, ventes_hors_vefa: 3, prix_m2_median_hors_vefa: "3\u202f200\u00a0€/m²" });
    expect(streetLine(mixed)).toBe("sur la voie (Rue des Tamarins) depuis 2021 : appartements 4\u202f700\u00a0€/m² en médiane (6 ventes dont 3 de neuf sur plan, 3\u202f200\u00a0€/m² sans elles)");
    expect(streetLine(streetMarket("Rue des Tamarins", 2021, offPlan))).toBe("sur la voie (Rue des Tamarins) depuis 2021 : appartements 6\u202f400\u00a0€/m² en médiane (3 ventes, toutes de neuf sur plan)");
    // None off plan: nothing more said.
    expect(streetMarket("Rue des Tamarins", 2021, others).appartements).toEqual({ ventes: 3, prix_median: "160\u202f000\u00a0€", prix_m2_median: "3\u202f200\u00a0€/m²" });
  });

  it("never gives the median of the others with one or two sales off plan: one sale's price would follow by difference", () => {
    const flat = (valeur: number, vefa: boolean) => ({ annee: 2023, type: "appartement" as const, valeur, surface_bati: 50, surface_terrain: 0, vefa });
    const others = [150_000, 160_000, 170_000, 180_000].map((x) => flat(x, false));
    for (const offPlan of [[flat(330_000, true)], [flat(320_000, true), flat(340_000, true)]]) {
      const v = streetMarket("Rue des Tamarins", 2021, [...others, ...offPlan]);
      expect(v.appartements).toMatchObject({ dont_vefa: offPlan.length, ventes_hors_vefa: 4 });
      expect(JSON.stringify(v)).not.toContain("prix_m2_median_hors_vefa");
      expect(streetLine(v)).toMatch(new RegExp(`\\(${4 + offPlan.length} ventes dont ${offPlan.length} de neuf sur plan\\)$`));
      expect(streetLine(v)).not.toContain("sans elles");
    }
    // The same rule around: 2 flats off plan among 5, the count alone.
    const sale = (valeur: number, nature: string) => ({ annee: 2023, type: "Un appartement", code: "121", valeur, surface_bati: 50, surface_terrain: 0, lots: 1, nature });
    const m = market([...[150_000, 160_000, 170_000].map((x) => sale(x, "Vente")), sale(320_000, VEFA_NATURE), sale(340_000, VEFA_NATURE)]);
    expect(m.appartements).toMatchObject({ ventes: 5, dont_vefa: 2, ventes_hors_vefa: 3 });
    expect(m.appartements).not.toHaveProperty("prix_m2_median_hors_vefa");
  });

  it("says a street's few sales as a count, attributed to DVF, before the area's figures", async () => {
    files = { ...files, geocodage: "geocode-temple.json" };
    const r = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "rue du Temple, Saint-Pierre", NOW));
    expect(r.resume).toContain("\u00a0; sur la voie (Rue du Temple), 2 ventes enregistrées dans DVF depuis 2021, trop peu pour une médiane\u00a0; dans le secteur alentour (environ 600 m sur 600 m), maisons vendues depuis 2021 : ");
    expect(r.marche_immobilier.sur_la_voie).toEqual({ voie: "Rue du Temple", depuis: 2021, ventes: 2, note: "2 ventes enregistrées dans DVF sur la voie depuis 2021, trop peu pour une médiane" });
    expect(urls.filter((u) => u.includes("geo-dvf"))[0]).toBe("https://files.data.gouv.fr/geo-dvf/latest/csv/2021/communes/974/97416.csv");
  });

  it("reads an address: parcel, PLU zone, altitude, market", async () => {
    const r = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "7 rue de la Buse, Saint-Paul", NOW));
    expect(r.resume).toMatch(/^7 Rue de la Buse 97460 Saint-Paul \(adresse exacte\)\u00a0; altitude 5\u00a0m\u00a0; parcelle cadastrale BO 0552 \(2\u202f416\u00a0m²\)\u00a0; zone U1c du PLU, zone urbaine/);
    // The thousands and the unit held to the number (marketing's kit, « Nombres »); the parcel's number untouched.
    expect(r.marche_immobilier.maisons.prix_m2_median).toMatch(/^\d{1,3}\u202f\d{3}\u00a0€\/m²$/);
    expect(r.marche_immobilier.maisons.prix_median).toMatch(/^\d{1,3}(\u202f\d{3})+\u00a0€$/);
    expect(r.urbanisme.approuve_le).toBe("27/09/2012");
    expect(urls[0]).toContain("geocodage");
    // The street's own sales first, then the area's, named before its figures.
    expect(r.resume).toContain("\u00a0; sur la voie (Rue de la Buse) depuis 2021 : maisons 2\u202f500\u00a0€/m² en médiane (7 ventes)\u00a0; dans le secteur alentour (environ 600 m sur 600 m), maisons vendues depuis 2021 : ");
    expect(r.marche_immobilier.sur_la_voie).toMatchObject({ voie: "Rue de la Buse", depuis: 2021, ventes: 10, maisons: { ventes: 7, prix_m2_median: "2\u202f500\u00a0€/m²" }, appartements: { ventes: 2 } });
    expect(r.resume).toContain(" : 5\u202f130\u00a0€/m² en médiane (16 ventes)\u00a0; appartements : 5\u202f120\u00a0€/m² (63 ventes dont 30 de neuf sur plan, 3\u202f810\u00a0€/m² sans elles)\u00a0; ");
    expect(r.marche_immobilier.note).toBe("Médianes des ventes enregistrées (DVF), maisons et appartements vendus seuls. Aucune vente individuelle n'est donnée.");
    // Then the commune's rents asked in ads, from the bundled map of rents.
    expect(r.resume).toContain("\u00a0; loyer d'annonce d'un appartement type à Saint-Paul\u00a0: 18,86\u00a0€/m² charges comprises, d'après les annonces du 3e trimestre 2025 (Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin)\u00a0; 95,1\u00a0% des logements");
    expect(r.loyers_d_annonce).toMatchObject({ commune: "Saint-Paul", millesime: 2025, maison: { loyer_m2_charges_comprises: "15,57\u00a0€/m²" } });
    expect(r.sources.map((x: { attribution: string }) => x.attribution)).toContain("Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin");
    // Then the commune's fibre, from the bundled statistics of the Arcep.
    expect(r.resume).toContain("\u00a0; 95,1\u00a0% des logements et locaux professionnels de Saint-Paul sont éligibles à la fibre au 30/06/2026, ce qui ne veut pas dire raccordés (Arcep).");
    expect(r.internet_dans_la_commune).toMatchObject({ commune: "Saint-Paul", eligibles_a_la_fibre: "95,1\u00a0%" });
    expect(r.sources.map((x: { source: string }) => x.source)).toContain("Ma connexion internet (statistiques d'éligibilité par commune)");
    // One file a year of the commune, from 2021; none of a sale, its parcel or its price alone in the answer.
    expect(urls.filter((u) => u.includes("geo-dvf"))).toEqual([2021, 2022, 2023, 2024, 2025, 2026].map((y) => `https://files.data.gouv.fr/geo-dvf/latest/csv/${y}/communes/974/97415.csv`));
    expect(JSON.stringify(r.marche_immobilier)).not.toMatch(/BO00|420 000|T7/);
    expect(r.sources.map((x: { source: string }) => x.source)).toContain("Demandes de valeurs foncières géolocalisées (DVF, Etalab)");
  });

  it("knows the street asked from another, by its name", () => {
    // Shortened, without accents, without the commune, with the quarter the address base adds, one letter off.
    for (const [asked, found] of [
      ["rue Étienne Regnault, Saint-Paul", "Rue Étienne Regnault"],
      ["7 rue de la Buse, Saint-Paul", "Rue de la Buse"],
      ["rue Juliette Dodu", "Rue Juliette Dodu"],
      ["rue juliette dodu saint denis", "Rue Juliette Dodu"],
      ["rue Leconte de Lisle, Saint-Denis", "Rue Charles Marie Leconte de Lisle"],
      ["rue Lecomte de Lisle", "Rue Leconte de Lisle"],
      ["12 rue Roland Garros, Saint-Paul", "Rue Roland Garros (Bois de Nèfles)"],
      ["rue Roland Garros Bois de Nefles", "Rue Roland Garros"],
      ["av de la victoire, St-Denis", "Avenue de la Victoire"],
      ["rue du general de gaulle", "Rue du Général de Gaulle"],
      // Streets of the address base, asked the way people shorten them.
      ["ch paille en queue, Salazie", "Chemin Paille En Queue"],
      ["impasse arhel, La Plaine-des-Palmistes", "Impasse Joseph Alexis Arhel"],
      ["chemin andre baret", "Chemin Andre Barret"],
      ["all bois de lait", "Allée Bois de Lait"],
      ["rue phlibert", "Rue Philibert"],
    ]) expect(sameStreet(asked, found), `${asked} → ${found}`).toBe(true);
    for (const [asked, found] of [
      ["rue Roland Gaspard, Bois de Nèfles", "Rue Roland Garros (Bois de Nèfles)"],
      ["allée des Rochers, Bois de Nèfles", "Rue Roland Garros (Bois de Nèfles)"],
      ["allée des Rochers", "Impasse des Rochers (Bois de Nèfles)"],
      ["rue Roland Gaspard", "Rue Roland Garros"],
    ]) expect(sameStreet(asked, found), `${asked} → ${found}`).toBe(false);
  });

  it("says when the address base finds another street, gives nothing of it, and names the streets close by", async () => {
    // Real answers of 25/10/2026: the base's best match is another street of the quarter named.
    files = { "type=street": "voies-gaspard.json", geocodage: "geocode-gaspard.json" };
    const r = await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "rue Roland Gaspard, Bois de Nèfles", NOW);
    expect(r.isError).toBe(true);
    const b = body(r);
    expect(b.erreur).toBe("Voie introuvable dans la Base adresse nationale\u00a0: «\u00a0rue Roland Gaspard, Bois de Nèfles\u00a0». Sa réponse la plus approchante, «\u00a0Rue Roland Garros (Bois de Nèfles)\u00a0» (Saint-Paul), est une autre voie\u00a0: pas de cadastre, de prix, d'urbanisme ni de risques pour une voie autre que celle demandée.");
    // The same name in other quarters of the commune, without the one already found.
    expect(b.voies_proches).toEqual(["Rue Roland Garros (St Paul Centre), Saint-Paul", "Rue Roland Garros (St Gilles les Bains), Saint-Paul"]);
    expect(b.conseil).toBe("Voies au nom proche à Saint-Paul, d'après la Base adresse nationale\u00a0: Rue Roland Garros (St Paul Centre), Rue Roland Garros (St Gilles les Bains). Demander à l'utilisateur laquelle est la bonne, puis redemander avec ce nom et la commune\u00a0; ne pas en choisir une à sa place.");
    // Neither the parcel, nor the zone, nor the sales of the other street; one more call to the address base.
    expect(urls.every((u) => u.includes("geocodage"))).toBe(true);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toMatch(/citycode=97415&type=street/);

    // An alley asked, only an impasse of that name in the quarter: another street, and one close by elsewhere.
    files = { "type=street": "voies-rochers.json", geocodage: "geocode-rochers.json" };
    const d = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "allée des Rochers, Bois de Nèfles", NOW));
    expect(d.voies_proches).toEqual(["Impasse des Rochers (Grande Fontaine), Saint-Paul"]);
    expect(d.conseil).toBe("Voie au nom proche à Saint-Paul, d'après la Base adresse nationale\u00a0: Impasse des Rochers (Grande Fontaine). Demander à l'utilisateur si c'est la bonne, puis redemander avec ce nom et la commune\u00a0; ne pas la choisir à sa place.");
    // Without a street close by.
    files = { "type=street": "voies-aucune.json", geocodage: "geocode-rochers.json" };
    const none = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "allée des Rochers, Bois de Nèfles", NOW));
    expect(none.voies_proches).toBeUndefined();
    expect(none.conseil).toBe("Aucune voie au nom proche à Saint-Paul dans la Base adresse nationale. Demander à l'utilisateur de vérifier le nom de la voie, puis redemander avec la commune, ou avec un lieu-dit.");
    expect([d.cadastre, d.urbanisme, d.marche_immobilier, d.risques]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("still reads the street asked, written right", async () => {
    files = { ...files, geocodage: "geocode-regnault.json" };
    const r = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "rue Étienne Regnault, Saint-Paul", NOW));
    expect(r.resume).toMatch(/^Rue Étienne Regnault \(St Paul Centre\) 97460 Saint-Paul \(milieu de la rue\)\u00a0; /);
    expect(urls.filter((u) => u.includes("geocodage"))).toHaveLength(1);
  });

  it("looks for the street in the commune named after the comma, and only there", async () => {
    expect(["rue Roland Garros, Saint-Paul", "rue Roland Garros, Bois de Nèfles", "12 rue de Saint-Denis, 97460 St Paul"].map(communeOf)).toEqual(["97415", "97415", "97415"]);
    // No commune named: no filter, not even the airport's commune that the gazetteer finds in the name.
    expect(["rue Roland Garros", "rue Roland Garros, près de l'école"].map(communeOf)).toEqual([undefined, undefined]);
    // Real answer of 25/10/2026 for Saint-Paul only; without the filter, the base put the street of Saint-Leu first.
    files = { ...files, geocodage: "geocode-garros.json" };
    const r = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "rue Roland Garros, Saint-Paul", NOW));
    expect(urls[0]).toMatch(/&citycode=97415$/);
    expect(r.resume).toMatch(/^Rue Roland Garros \(St Paul Centre\) 97460 Saint-Paul \(milieu de la rue\)\u00a0; /);
    urls.length = 0;
    await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "rue Roland Garros", NOW);
    expect(urls[0]).not.toContain("citycode");
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

  it("waits 12 s at most for the urban plan's zone and plans, as API Carto gives up by itself after about 11 s", async () => {
    // The delay each read was given, by its address: the timeout is set just before its fetch leaves.
    const delays = new Map<string, number>();
    let last = 0;
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => ((last = ms), timeout(ms)));
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string) => (delays.set(String(url).split("?")[0], last), inner(url)));
    try {
      await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "7 rue de la Buse, Saint-Paul", NOW);
    } finally {
      spy.mockRestore();
    }
    expect(delays.get("https://apicarto.ign.fr/api/gpu/zone-urba")).toBe(12_000);
    expect(delays.get("https://apicarto.ign.fr/api/gpu/assiette-sup-s")).toBe(12_000);
    expect(delays.get("https://apicarto.ign.fr/api/cadastre/parcelle")).toBe(25_000);
  });

  it("tries Géorisques again when a call fails, as about one in two does from a Worker", async () => {
    let fails = 2;
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes("catnat") && fails-- > 0 ? new Response("", { status: 520 }) : inner(url)));
    const r = body(await ficheLieu(new Cache(new MemoryStore(), () => NOW.getTime()), "7 rue de la Buse, Saint-Paul", NOW));
    expect(r.risques.catastrophes_naturelles.arretes_dans_la_commune).toBeGreaterThan(5);
  });
});
