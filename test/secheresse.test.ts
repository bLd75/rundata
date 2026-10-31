import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parse } from "../src/providers/vigieau.js";
import { restrictionsEau } from "../src/tools/secheresse.js";
import { buildSecheresse } from "../src/web/data.js";
import { nobreak, secheresseLive, secheressePage } from "../src/web/domains.js";
import { deadAnchors, doubleIds, mapLinks } from "./cartes.js";

// VigiEau on 24/10/2026: the drought order of 10/10/2026, Saint-Joseph in crisis.
const raw = readFileSync(new URL("./fixtures/vigieau/zones_974.json", import.meta.url), "utf8");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore());

describe("restrictions d'eau", () => {
  beforeEach(() => vi.stubGlobal("fetch", async () => new Response(raw, { headers: { "content-type": "application/json" } })));
  afterEach(() => vi.unstubAllGlobals());

  it("reads three zones per commune, by its INSEE code", () => {
    const zones = parse(JSON.parse(raw));
    expect(zones).toHaveLength(72);
    expect(zones.find((z) => z.insee === "97412" && z.ressource === "AEP")).toMatchObject({ niveau: "crise", depuis: "2026-10-10" });
    expect(zones.every((z) => z.usages.every((u) => !/[​-‍]/.test(u.nom)))).toBe(true);
  });

  it("sums up the island", async () => {
    const b = body(await restrictionsEau(cache(), undefined));
    expect(b.resume).toBe("Sécheresse à La Réunion (arrêté en vigueur depuis le 10/10/2026). Eau du robinet : crise à Saint-Joseph\u00a0; alerte renforcée dans 5 communes\u00a0; alerte dans 14 communes\u00a0; vigilance aux Trois-Bassins, à Saint-Leu, à Saint-Louis et à Sainte-Rose.");
    expect(b.communes[0]).toEqual({ commune: "Saint-Joseph", eau_du_robinet: "crise", rivieres_et_sources: "alerte renforcée", nappes: "crise" });
    expect(b.communes).toHaveLength(24);
  });

  it("leads from each commune of the map to its row of the table", async () => {
    const page = secheressePage("https://rundata.re", { value: await buildSecheresse(cache()), fetchedAt: new Date(), stale: false });
    expect(mapLinks(page)).toHaveLength(24);
    expect(mapLinks(page).find((l) => l.href === "#c-saint-joseph")?.label).toBe("Saint-Joseph : eau du robinet : crise, voir le détail");
    expect(deadAnchors(page)).toEqual([]);
    expect(doubleIds(page)).toEqual([]);
  });

  it("draws its legend as the charter of the maps wants: each colour as a square then its word, never a coloured word, then the order's date", async () => {
    const page = secheressePage("https://rundata.re", { value: await buildSecheresse(cache()), fetchedAt: new Date(), stale: false });
    expect(page).toContain('<span><svg viewBox="-37 -37 74 74" aria-hidden="true"><rect x="-30" y="-30" width="60" height="60" rx="8" fill="#862e9c"/></svg>crise</span>');
    expect(page).toContain('<span class="mls">Eau du robinet, d&#39;après l&#39;arrêté préfectoral en vigueur depuis le\u00a010/10/2026.</span>');
    expect(page).not.toContain('<span style="color:');
  });

  it("says what a private person may not do in a commune", async () => {
    const b = body(await restrictionsEau(cache(), "Saint-Joseph"));
    expect(b.resume).toBe("Restrictions d'eau à Saint-Joseph : crise pour l'eau du robinet\u00a0; crise pour les nappes souterraines, alerte renforcée pour les rivières et sources.");
    const usages = b.restrictions_eau_du_robinet.map((r: { usage: string }) => r.usage);
    expect(usages).toContain("Arrosage des pelouses");
    expect(usages).not.toContain("Arrosage des golfs");
    expect(b.restrictions_eau_du_robinet.find((r: { usage: string }) => r.usage === "Arrosage des jardins potagers").restriction).toBe("Interdiction entre 6 h et 20 h");
    expect(b.arrete).toMatch(/^https:\/\/regleau\..*\.pdf$/);
  });

  it("gives a farmer's rules when asked", async () => {
    const b = body(await restrictionsEau(cache(), "Saint-Joseph", "exploitation"));
    expect(b.restrictions_eau_du_robinet.map((r: { usage: string }) => r.usage)).toContain("Prélèvement d’eau pour l’irrigation par aspersion des cultures (hors périmètres irrigués)");
  });

describe("the drought tile of the home page", () => {
  const tile = (levels: [string, string | null][]) =>
    secheresseLive({ value: { communes: levels.map(([commune, eau_du_robinet]) => ({ commune, eau_du_robinet })) } as any, fetchedAt: new Date(), stale: false })!;

  it("says the worst level and where it applies: one commune, several, a name in « Le » or « Les »", async () => {
    expect(tile([["Saint-Joseph", "crise"], ["Saint-Pierre", "alerte renforcée"], ["Cilaos", "alerte"]])).toEqual({ valeur: `crise ${nobreak("à Saint-Joseph")}`, detail: "3 communes sur 24 en alerte ou plus pour l'eau du robinet" });
    expect(tile([["Saint-Joseph", "crise"], ["Saint-Philippe", "crise"], ["Cilaos", "vigilance"]]).valeur).toBe("crise dans 2 communes");
    expect(tile([["Le Tampon", "alerte renforcée"], ["Cilaos", "alerte"]]).valeur).toBe("alerte renforcée au Tampon");
    expect(tile([["Les Avirons", "alerte"], ["Cilaos", "vigilance"]]).valeur).toBe("alerte aux Avirons");
    expect(tile([["Le Port", "crise"]]).valeur).toBe("crise au Port");
    // From the copy of the decree: Saint-Joseph alone in crisis.
    expect(secheresseLive({ value: await buildSecheresse(cache()), fetchedAt: new Date(), stale: false })!.valeur).toBe(`crise à <span style="white-space:nowrap">Saint-Joseph</span>`);
  });

  it("keeps its words when no commune is above vigilance, or there is no restriction", () => {
    expect(tile([["Cilaos", "vigilance"], ["Saint-Leu", "vigilance"]]).valeur).toBe("jusqu'à vigilance");
    expect(tile([["Cilaos", null]]).valeur).toBe("vigilance");
    expect(tile([])).toEqual({ valeur: "aucune restriction", detail: "d'après VigiEau" });
  });
});
});
