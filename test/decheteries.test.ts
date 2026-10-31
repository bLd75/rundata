import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../src/cache.js";
import * as tco from "../src/providers/tco.js";
import { annuaireTool } from "../src/tools/annuaire.js";
import { WASTE } from "../src/tools/decheteries.js";
import { communePage } from "../src/web/commune.js";
import { decheteriesPage, descriptionOf, TITLE } from "../src/web/decheteries.js";
import { pageOf } from "../src/web/places.js";
import { SITES, sitesNow, TCO_COMMUNES, wasteAsked } from "../src/vie/decheteries.js";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/tco_meteo.json", import.meta.url), "utf8"));
// Saturday 24 October 2026, 17:30 at La Réunion: the fixture's updates were made between 15:02 and 17:00.
const NOW = new Date("2026-10-24T13:30:00Z");
const NEXT_MORNING = new Date("2026-10-25T06:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const etats = tco.parse(FIXTURE);
const copy = { value: { etats, sources: [] }, fetchedAt: NOW, stale: false };

beforeEach(() => vi.stubGlobal("fetch", async (url: string) => (String(url).includes("data.tco.re") ? Response.json(FIXTURE) : new Response("", { status: 404 }))));
afterEach(() => vi.unstubAllGlobals());

describe("the déchèteries of the West", () => {
  it("are the TCO's thirteen, in its five communes, each matched with its live state", () => {
    expect(SITES).toHaveLength(13);
    expect(TCO_COMMUNES.sort()).toEqual(["La Possession", "Le Port", "Les Trois-Bassins", "Saint-Leu", "Saint-Paul"]);
    expect(etats).toHaveLength(13);
    const dosDane = etats.find((e) => e.lien.endsWith("decheterie-de-dos-dane"))!;
    expect(dosDane.maj).toBe("2026-10-24T11:02:00.000Z");
    expect(dosDane.accepte).toMatchObject({ dechets_verts: true, encombrants: false });
    expect(sitesNow(etats, NOW).every((s) => s.mis_a_jour)).toBe(true);
  });

  it("say the state only while it is recent: older than 6 hours, or of another day, it is to be checked", () => {
    const now = sitesNow(etats, NOW);
    expect(now.find((s) => s.nom === "Déchèterie de Dos d'Âne")).toMatchObject({ a_jour: true, mis_a_jour: "24/10 15:02" });
    expect(now.find((s) => s.nom === "Déchèterie de Dos d'Âne")!.refuse).toContain("encombrants");
    const late = sitesNow(etats, new Date("2026-10-24T17:30:00Z"));
    expect(late.find((s) => s.nom === "Déchèterie de Dos d'Âne")!.a_jour).toBe(false);
    expect(sitesNow(etats, NEXT_MORNING).some((s) => s.a_jour)).toBe(false);
  });

  it("answer which nearby sites take the waste asked, and where to look outside the TCO", async () => {
    const r = body(await annuaireTool(new Cache(), "déchets verts", "Saint-Gilles-les-Bains", NOW));
    expect(r.resume).toMatch(/^Déchets verts acceptés en ce moment : /);
    expect(r.decheteries[0].etat).toBe("à jour");
    expect(r.avertissements.join(" ")).toMatch(/plus de 6 h est à vérifier sur place/);
    expect(r.avertissements).toContain("Horaires par déchèterie sur sa page du TCO, qui les dit ouvertes 7 jours sur 7.");
    // The next morning, before the staff's first update: nothing said to be the state now.
    const next = body(await annuaireTool(new Cache(), "encombrants", "Le Port", NEXT_MORNING));
    expect(next.resume).toMatch(/À vérifier sur place \(mise à jour il y a plus de 6 h\)/);
    expect(next.decheteries[0].accepte).toBeUndefined();
    const out = body(await annuaireTool(new Cache(), "déchèterie", "Saint-Pierre", NOW));
    expect(out.resume).toBe("Seul le TCO (Ouest) publie ces données. Pour les autres communes, voir la CINOR, la CIREST, la CIVIS ou la CASUD. Saint-Pierre est dans la CIVIS : https://www.civis.re/");
    for (const q of ["déchèterie", "déchetterie", "encombrants", "déchets verts", "gravats", "benne"]) expect(WASTE.test(q), q).toBe(true);
    for (const q of ["mairie", "CAF", "pharmacie", "marché"]) expect(WASTE.test(q), q).toBe(false);
    expect(wasteAsked("où jeter un vieux frigo")).toBe("refrigerateurs_congelateurs");
    expect(wasteAsked("tonte de pelouse et branches")).toBe("dechets_verts");
  });

  it("have their page, a block per commune, its description with the time of the latest update", () => {
    const page = decheteriesPage("https://rundata.re", copy, NOW);
    expect(TITLE.length).toBeLessThanOrEqual(60);
    expect(page).toContain(`<title>${TITLE}</title>`);
    expect(page).toContain("<h1>Déchèteries de l&#39;Ouest : les bennes en direct</h1>");
    for (const id of ["saint-paul", "le-port", "la-possession", "les-trois-bassins", "saint-leu"]) expect(page).toContain(`<section id="${id}"`);
    expect(descriptionOf(sitesNow(etats, NOW))).toBe("Déchèteries de l'Ouest (974) à 17:00 : où déposer déchets verts, encombrants, gravats. Le Port, La Possession, Saint-Paul, Trois-Bassins, Saint-Leu.");
    expect(descriptionOf(sitesNow(etats, NEXT_MORNING))).toBe("Déchèteries de l'Ouest (974) : où déposer déchets verts, encombrants, gravats. Le Port, La Possession, Saint-Paul, Trois-Bassins, Saint-Leu.");
    expect(decheteriesPage("https://rundata.re", copy, NEXT_MORNING)).toContain("Mise à jour il y a plus de 6 h : à vérifier sur place.");
    expect(page).toContain('<a href="https://www.civis.re/" rel="noopener">la CIVIS</a> ou <a href="https://www.casud.re/" rel="noopener">la CASUD</a>');
  });

  it("have a tile on the West's commune pages only", () => {
    const paul = communePage("https://rundata.re", pageOf("saint-paul")!, { place: null, dechets: copy }, NOW);
    expect(paul).toMatch(/<h3><a href="\/decheteries#saint-paul">Déchèteries<\/a><\/h3><p class="tv">5 déchèteries<\/p><p class="td">d'après les agents : déchets verts acceptés dans \d sur 5, encombrants dans \d sur 5<\/p>/);
    expect(communePage("https://rundata.re", pageOf("saint-pierre")!, { place: null }, NOW)).not.toContain("Déchèteries</a></h3>");
  });
});
