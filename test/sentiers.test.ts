import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parseRoads, parseTrails } from "../src/providers/sentiers.js";
import { sentiersRandonnee, trailsNamed } from "../src/tools/sentiers.js";

// The ONF's map of the trails on 24/10/2026, last edited on 20/10: 56 trails closed out of 389.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/onf/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());

describe("sentiers de randonnée", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string) => {
      const file = url.includes("/5/query") ? "sentiers.json" : url.includes("/4/query") ? "routes.json" : "couche.json";
      return new Response(fixture(file), { headers: { "content-type": "application/json" } });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads each trail's state, cause and line", () => {
    const trails = parseTrails(JSON.parse(fixture("sentiers.json")).features);
    expect(trails).toHaveLength(389);
    expect(trails.filter((t) => t.statut === "fermé")).toHaveLength(56);
    expect(trails.find((t) => t.nom === "Sentier de la Roche Pendue")).toMatchObject({ statut: "fermé", cause: "Eboulements et arbres en travers", info: "Réouverture 2026" });
    expect(trails.every((t) => !t.nom.endsWith("(hors gestion ONF)"))).toBe(true);
    const roads = parseRoads(JSON.parse(fixture("routes.json")).features);
    expect(roads.filter((r) => r.circulation === "Circulation interdite")).toHaveLength(4);
    expect(roads.some((r) => r.circulation === "Circulation autorisé")).toBe(false);
  });

  it("lists the closed trails of the island by commune", async () => {
    const b = body(await sentiersRandonnee(cache(), undefined, NOW));
    expect(b.resume).toBe("56 sentiers fermés sur 389 suivis par l'ONF à La Réunion, et 4 routes forestières interdites à la circulation.");
    expect(b.carte_mise_a_jour).toBe("20/10/2026 (ONF)");
    expect(b.fermes_par_commune[0]).toMatchObject({ commune: "Sainte-Rose" });
    expect(b.fermes_par_commune.reduce((n: number, c: { sentiers_fermes: unknown[] }) => n + c.sentiers_fermes.length, 0)).toBe(56);
  });

  it("answers for a trail by its name", async () => {
    const b = body(await sentiersRandonnee(cache(), "le sentier de la Roche Pendue est ouvert ?", NOW));
    expect(b.resume).toMatch(/^Sentier de la Roche Pendue : FERMÉ \(Eboulements et arbres en travers\)\./);
    expect(trailsNamed(parseTrails(JSON.parse(fixture("sentiers.json")).features), "Roche Plate")).toHaveLength(6);
  });

  it("takes a cirque as a whole, not the places named after it", async () => {
    const b = body(await sentiersRandonnee(cache(), "sentiers fermés à Mafate", NOW));
    expect(b.resume).toBe("Dans le cirque de Mafate : 5 sentiers fermés, 84 ouverts, 9 hors gestion ONF (état non connu).");
    expect(b.sentiers_nommes).toBeUndefined();
    expect(b.autour.sentiers_fermes.map((t: { sentier: string }) => t.sentier)).toContain("Piste DFCI de la Glacière");
  });

  it("looks around a place, with the trails named after it", async () => {
    const b = body(await sentiersRandonnee(cache(), "Bélouve", NOW));
    expect(b.resume).toMatch(/^4 sentiers portent ce nom : 1 fermé \(Sentier de la Tamarinaie de Bélouve\)\. À moins de 4 km de Bélouve : \d+ sentiers fermés/);
    expect(b.autour.sentiers_fermes[0].distance_km).toBeTypeOf("number");
  });
});
