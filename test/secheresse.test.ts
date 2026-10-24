import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parse } from "../src/providers/vigieau.js";
import { restrictionsEau } from "../src/tools/secheresse.js";

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
    expect(b.resume).toBe("Sécheresse à La Réunion (arrêté en vigueur depuis le 10/10/2026). Eau du robinet : crise à Saint-Joseph ; alerte renforcée dans 5 communes ; alerte dans 14 communes ; vigilance aux Trois-Bassins, à Saint-Leu, à Saint-Louis et à Sainte-Rose.");
    expect(b.communes[0]).toEqual({ commune: "Saint-Joseph", eau_du_robinet: "crise", rivieres_et_sources: "alerte renforcée", nappes: "crise" });
    expect(b.communes).toHaveLength(24);
  });

  it("says what a private person may not do in a commune", async () => {
    const b = body(await restrictionsEau(cache(), "Saint-Joseph"));
    expect(b.resume).toBe("Restrictions d'eau à Saint-Joseph : crise pour l'eau du robinet ; crise pour les nappes souterraines, alerte renforcée pour les rivières et sources.");
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
});
