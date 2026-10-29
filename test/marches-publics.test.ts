import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { counted } from "../src/budget.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { communeAdresse } from "../src/places/codes-postaux.js";
import * as boamp from "../src/providers/marches-publics.js";
import { REGISTRY } from "../src/registre.js";
import { buildMarches, marchesPage } from "../src/web/marches-publics.js";

// Ten notices of the BOAMP's list for La Réunion read on 29/10/2026 at 14:51, and their full texts read at 13:49, cut
// to their places (no name of a person in them).
const fixture = (f: string) => readFileSync(new URL(`./fixtures/marches-publics/${f}`, import.meta.url), "utf8");
const LISTE = fixture("liste.json");
const TEXTES = fixture("textes.json");
const texte = (id: string) => (JSON.parse(TEXTES) as { idweb: string; donnees: string }[]).find((t) => t.idweb === id)!.donnees;
// 14:35 and 14:40 in La Réunion: the list's pass, then the texts'.
const LISTE_AT = new Date("2026-10-29T10:35:00Z");
const TEXTES_AT = new Date("2026-10-29T10:40:00Z");
const O = "https://rundata.re";

afterEach(() => {
  boamp.configure(undefined);
  vi.unstubAllGlobals();
});

/** The BOAMP's API: the list, or the full texts; what was asked. */
function api() {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const u = new URL(url);
    asked.push(`${u.searchParams.get("select")} | ${u.searchParams.get("where")}`);
    return new Response(u.searchParams.get("select") === "idweb,donnees" ? TEXTES : LISTE);
  });
  return asked;
}

async function rempli(): Promise<boamp.Copie> {
  let c: boamp.Copie | null = null;
  const write = async (x: boamp.Copie) => void (c = x);
  await boamp.collect(c, write, LISTE_AT);
  await boamp.collect(c, write, TEXTES_AT);
  return c!;
}

describe("the public procurement notices of the BOAMP", () => {
  it("finds an address's commune from its postcode and town, the island's CEDEX with a town of the island, never out of the island", () => {
    expect(communeAdresse("97490", "Ste clotilde")).toBe("Saint-Denis");
    expect(communeAdresse("97418", "Plaine Des Cafres")).toBe("Le Tampon");
    // CEDEX of the island: 974xx, 977xx, 978xx, with a town named exactly.
    expect(communeAdresse("97829", "Le Port Cedex")).toBe("Le Port");
    expect(communeAdresse("97801", "SAINT DENIS")).toBe("Saint-Denis");
    expect(communeAdresse("97801", "Saint Denis Messag Cedex 9")).toBeUndefined();
    // La Trinité, Martinique: a quarter of Saint-Denis by its name only.
    expect(communeAdresse("97220", "LA TRINITE")).toBeUndefined();
    // A postcode and a town of two communes.
    expect(communeAdresse("97400", "Saint-Paul")).toBeUndefined();
  });

  it("tells the island's notices from those published here for Mayotte, the Antilles or the whole country, and their communes", () => {
    const r = (id: string, deps: string[]) => boamp.rattache(deps, boamp.lieux(texte(id)));
    // European notice: its place of work, Saint-Joseph.
    expect(r("26-104904", ["974"])).toEqual({ reunion: true, commune: "Saint-Joseph" });
    // The BOAMP's own schema: « Saint-Joseph (Ile de la Réunion) ».
    expect(r("26-105149", ["974"])).toEqual({ reunion: true, commune: "Saint-Joseph" });
    // « Ile de la Réunion » for its place: its buyer's commune, Sainte-Clotilde in Saint-Denis.
    expect(r("26-105156", ["974"])).toEqual({ reunion: true, communeAcheteur: "Saint-Denis" });
    // A CEDEX of Saint-Paul for its place of work.
    expect(r("26-103764", ["974"])).toEqual({ reunion: true, commune: "Saint-Paul" });
    // The TAAF for the Îles Éparses, published for La Réunion alone: its buyer at Saint-Denis.
    expect(r("26-99414", ["974"])).toEqual({ reunion: true, communeAcheteur: "Saint-Denis" });
    // Martinique and Mayotte, published at La Réunion too.
    expect(r("26-101683", ["75", "971", "972", "973", "974"])).toEqual({ reunion: false });
    expect(r("26-101552", ["976", "974"])).toEqual({ reunion: false });
  });

  it("reads the list at 35 past, the new notices' texts at 40 past, one request each, and writes only what changed", async () => {
    const asked = api();
    const writes: boamp.Copie[] = [];
    const write = async (c: boamp.Copie) => void writes.push(c);
    const { value, used } = await counted(100, () => boamp.collect(null, write, LISTE_AT));
    expect(value).toBe("0 avis, 10 nouveaux, 0 hors de l'île : écrits");
    expect(used).toBe(1);
    // Never the holder of an award, who may be a person.
    expect(asked[0]).not.toContain("titulaire");
    expect(asked[0]).toContain(`code_departement="974" and (datelimitereponse>=now() or (nature="ANNULATION" and dateparution>=date'2025-10-28'))`);
    expect(writes[0].attente).toHaveLength(10);

    const second = await counted(100, () => boamp.collect(writes[0], write, TEXTES_AT));
    expect(second.value).toBe("8 avis, 10 textes lus, 2 hors de l'île : écrits");
    expect(second.used).toBe(1);
    // One pass, besides the copy read and written: what the registry says at most.
    for (const id of ["marches-publics:liste", "marches-publics:textes"]) expect(REGISTRY.find((e) => e.id === id)!.run.subrequests - 2).toBe(1);
    const c = writes[1];
    expect(c.attente).toBeUndefined();
    expect(c.ecartes).toEqual(["26-101552", "26-101683"]);
    expect(c.avis.find((a) => a.id === "26-104904")).toEqual({
      id: "26-104904",
      objet: "Maintenance des systèmes de climatisation des bâtiments – année 2027 (Marché n° 26AO017)",
      acheteur: "Commune de SaintJoseph",
      types: ["services"],
      parution: "2026-10-29",
      limite: "2026-12-01",
      lien: "https://www.boamp.fr/pages/avis/?q=idweb:26-104904",
      commune: "Saint-Joseph",
    });
    // The correction of 26-95112 takes its place on the page, with its new closing day; the notice it corrects is kept,
    // not to be read again at the next hour.
    expect(c.avis.find((a) => a.id === "26-103764")).toMatchObject({ corrige: ["26-95112"], limite: "2026-11-17" });
    expect(boamp.affiches(c.avis).map((a) => a.id)).not.toContain("26-95112");
    expect(boamp.affiches(c.avis)).toHaveLength(7);

    // The next hour, the same list: one read, nothing written, nothing to read at 40 past.
    asked.length = 0;
    const later = new Date(LISTE_AT.getTime() + 3600_000);
    expect(await boamp.collect(c, write, later)).toBe("8 avis, 0 nouveaux, 2 hors de l'île : inchangés, non réécrits");
    expect(await boamp.collect(c, write, new Date(TEXTES_AT.getTime() + 3600_000))).toBe("aucun avis nouveau à lire");
    expect(asked).toHaveLength(1);
    expect(writes).toHaveLength(2);

    expect([34, 35, 39, 40, 44, 45].map((m) => boamp.refreshDue(new Date(Date.UTC(2026, 9, 29, 10, m))))).toEqual([false, true, true, true, true, false]);
  });

  it("leaves out a notice cancelled, by a notice of cancellation or by the notice that cancels and replaces it", async () => {
    api();
    const c = await rempli();
    const lignes = JSON.parse(LISTE) as Record<string, unknown>[];
    // A notice of cancellation as the BOAMP gives them (26-91344 of 22/09/2026, without closing date), here for the
    // notice that 26-103764 corrects: the correction leaves with it.
    lignes.push({ idweb: "26-91344", objet: "Objet du marché annulé", nomacheteur: "Acheteur", dateparution: "2026-10-29", datelimitereponse: null, type_marche: null, code_departement: ["974"], nature: "ANNULATION", etat: "INITIAL", annonce_lie: ["26-95112"], url_avis: "https://www.boamp.fr/pages/avis/?q=idweb:26-91344" });
    // A notice that cancels and replaces another (as 26-104938 did 26-92319 on 29/10/2026): it stays, the other leaves.
    const relance = lignes.find((l) => l.idweb === "26-104939")!;
    Object.assign(relance, { etat: "ANNULATION", annonce_lie: ["26-99414"] });
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => (asked.push(u), new Response(JSON.stringify(lignes))));
    const writes: boamp.Copie[] = [];
    const later = new Date(LISTE_AT.getTime() + 3600_000);
    expect(await boamp.collect(c, async (x) => void writes.push(x), later)).toBe("5 avis, 0 nouveaux, 2 hors de l'île : écrits");
    const shown = boamp.affiches(writes[0].avis).map((a) => a.id);
    expect(shown).toEqual(["26-105156", "26-105149", "26-104939", "26-104904", "26-101303"]);
    expect(writes[0].avis.find((a) => a.id === "26-104939")!.corrige).toEqual(["26-99414"]);
    // Nothing to read at 40 past: the notices cancelled are not read.
    expect(await boamp.collect(writes[0], async (x) => void writes.push(x), new Date(TEXTES_AT.getTime() + 3600_000))).toBe("aucun avis nouveau à lire");
    expect(asked).toHaveLength(1);
  });

  it("keeps a notice until its closing day included, at La Réunion", () => {
    const a = { limite: "2026-11-17" } as boamp.Avis;
    expect(boamp.ouvert(a, new Date("2026-11-17T19:59:00Z"))).toBe(true);
    expect(boamp.ouvert(a, new Date("2026-11-17T20:00:00Z"))).toBe(false);
  });

  it("keeps the copy when the list cannot be read, with when it first failed, written once", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    const before: boamp.Copie = { lu: "2026-10-29T09:35:00Z", avis: [], ecartes: [] };
    const writes: boamp.Copie[] = [];
    const write = async (c: boamp.Copie) => void writes.push(c);
    await expect(boamp.collect(before, write, LISTE_AT)).rejects.toThrow("HTTP 503");
    expect(writes).toEqual([{ ...before, echec: LISTE_AT.toISOString() }]);
    await expect(boamp.collect(writes[0], write, LISTE_AT)).rejects.toThrow("HTTP 503");
    expect(writes).toHaveLength(1);
  });
});

describe("the page /marches-publics", () => {
  it("lists the island's notices with their buyer, type, commune and closing day, to filter by commune", async () => {
    api();
    const c = await rempli();
    vi.unstubAllGlobals();
    boamp.configure(async () => c);
    const now = new Date("2026-10-29T11:00:00Z");
    const d = await buildMarches(new Cache(new MemoryStore(), () => now.getTime()), now);
    expect(d.nombre).toBe(7);
    const p = marchesPage(O, { value: d, fetchedAt: TEXTES_AT, stale: false }, now);
    expect(p).toContain("<title>Marchés publics Réunion : avis de marché et appels d&#39;offres en cours · 974</title>");
    expect(p).toContain("7 avis de marché ouverts aux réponses sur le BOAMP, dernière lecture");
    expect(p).toContain("Commune de SaintJoseph · services · à Saint-Joseph");
    expect(p).toContain("Syndicat Mixte Parc Routier de la Réunion · fournitures · acheteur à Saint-Denis");
    expect(p).toContain("jusqu&#39;au 01/12</span>");
    expect(p).not.toContain("RECTORAT DE MAYOTTE");
    expect(p).not.toContain("Ville de la Trinité");
    expect(p).toContain('<option>Le Port</option><option>Saint-Denis</option><option>Saint-Joseph</option><option>Saint-Paul</option>');
    expect(p).toContain("https://www.boamp.fr/pages/avis/?q=idweb:26-103764");
    expect(p).not.toContain("idweb:26-95112");
  });

  it("says the year of a closing day of another year, and what it says without a copy", async () => {
    const now = new Date("2026-10-29T08:45:00Z");
    const a: boamp.Avis = { id: "x", objet: "Objet", acheteur: "Région Réunion", types: ["travaux"], parution: "2026-10-29", limite: "2027-01-08", lien: "https://www.boamp.fr/pages/avis/?q=idweb:x" };
    const p = marchesPage(O, { value: { nombre: 1, avis: [a], sources: [] }, fetchedAt: now, stale: false }, now);
    expect(p).toContain("jusqu&#39;au 08/01/2027");
    expect(p).toContain("1 avis de marché ouvert aux réponses");
    // The store empty: the next read, 35 past.
    const d = await buildMarches(new Cache(new MemoryStore(), () => now.getTime()), now);
    expect(d.prochaine).toBe("2026-10-29T09:35:00.000Z");
    boamp.configure(async () => null);
    const empty = await buildMarches(new Cache(new MemoryStore(), () => now.getTime()), now);
    expect(marchesPage(O, { value: empty, fetchedAt: now, stale: false }, now)).toContain("Les avis ne sont pas encore lus : prochaine lecture prévue à 13:35.");
    expect(marchesPage(O, null, now)).toContain("Les avis se chargent : rechargez la page dans quelques secondes.");
  });
});
