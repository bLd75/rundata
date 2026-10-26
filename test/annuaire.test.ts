import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { office } from "../src/providers/annuaire.js";
import { annuaireTool, hoursText, named, openNow } from "../src/tools/annuaire.js";
import { withVide } from "../src/vide.js";

// A search for « mairie » in the 974 entries of service-public.fr's directory, 23/10/2026.
const offices = JSON.parse(readFileSync(new URL("./fixtures/annuaire_mairie.json", import.meta.url), "utf8")).results.map(office);
const saintPaul = offices.find((o: { nom: string }) => o.nom === "Mairie - Saint-Paul")!;
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe("public services directory", () => {
  it("keeps names holding the words asked, not words inside other words", () => {
    const fake = (nom: string) => ({ ...saintPaul, nom });
    const list = [fake("Brigade de gendarmerie - La-Plaine-des-Cafres"), fake("Caisse d'allocations familiales (Caf) de La Réunion - accueil Sud")];
    expect(named(list, "CAF").map((o) => o.nom)).toEqual(["Caisse d'allocations familiales (Caf) de La Réunion - accueil Sud"]);
    expect(named([fake("Mairie - Saint-Paul")], "mairies")).toHaveLength(1);
  });

  it("reads address, position, hours and phone", () => {
    expect(saintPaul.adresse).toBe("Place du Général-de-Gaulle, 97460 Saint-Paul");
    expect(saintPaul.lat).toBeCloseTo(-21.014, 2);
    expect(hoursText(saintPaul)).toBe("lundi au jeudi 8h-16h\u00a0; vendredi 8h-15h");
    expect(saintPaul.telephone).toBe("02 62 45 43 45");
  });

  it("knows when it is open, in Réunion time", () => {
    expect(openNow(saintPaul, new Date("2026-10-22T06:00:00Z"))).toBe(true); // jeudi 10:00
    expect(openNow(saintPaul, new Date("2026-10-23T11:30:00Z"))).toBe(false); // vendredi 15:30
    expect(openNow(saintPaul, new Date("2026-10-24T06:00:00Z"))).toBe(false); // samedi
  });

  it("answers with the place's own town hall", async () => {
    const now = new Date("2026-10-22T06:00:00Z");
    const store = new MemoryStore();
    void store.put("annuaire:97415:mairie", { value: offices.filter((o: { insee: string }) => o.insee === "97415"), fetchedAt: now.getTime() });
    const r = body(await annuaireTool(new Cache(store, () => now.getTime()), "mairie", "Saint-Gilles-les-Bains", now));
    expect(r.resume).toMatch(/^Mairie - Saint-Paul, Place du Général-de-Gaulle, 97460 Saint-Paul \(à [\d,]+ km de Saint-Gilles/);
    expect(r.resume).toContain("Ouvert en ce moment");
    expect(r.page).toBe("https://rundata.re/communes/saint-paul");
  });

  it("gives a defibrillator asked of it the page of the devices, and no page without a place", async () => {
    const now = new Date("2026-10-22T06:00:00Z");
    const store = new MemoryStore();
    void store.put("annuaire:974:défibrillateur", { value: [], fetchedAt: now.getTime() });
    void store.put("annuaire:974:mairie", { value: offices, fetchedAt: now.getTime() });
    const cache = new Cache(store, () => now.getTime());
    expect(body(await annuaireTool(cache, "défibrillateur", undefined, now)).page).toBe("https://rundata.re/defibrillateurs");
    expect(body(await annuaireTool(cache, "mairie", undefined, now)).page).toBeUndefined();
  });

  it("counts a word that finds no service as a question left without an answer, and only that", async () => {
    const now = new Date("2026-10-22T06:00:00Z");
    const store = new MemoryStore();
    void store.put("annuaire:974:observatoire", { value: [], fetchedAt: now.getTime() });
    void store.put("annuaire:974:mairie", { value: offices, fetchedAt: now.getTime() });
    const cache = new Cache(store, () => now.getTime());
    const none = await withVide("annuaire_services_publics", () => annuaireTool(cache, "observatoire", undefined, now));
    expect(body(none.value).resume).toBe("Aucun service public trouvé à La Réunion pour « observatoire ».");
    expect(none.vide).toBe(true);
    expect((await withVide("annuaire_services_publics", () => annuaireTool(cache, "mairie", undefined, now))).vide).toBe(false);
  });
});
