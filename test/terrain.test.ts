import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { ficheLieu, market } from "../src/tools/terrain.js";

// Real answers of 23/10/2026 for 7 rue de la Buse, Saint-Paul: parcel BO 552, zone U1c, 115 sales since 2021.
const raw = (f: string) => readFileSync(new URL(`./fixtures/terrain/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-23T05:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const urls: string[] = [];

beforeEach(() => {
  urls.length = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    const u = String(url);
    const f = u.includes("geocodage") ? "geocode.json" : u.includes("cadastre") ? "parcelle.json" : u.includes("zone-urba") ? "zone.json" : u.includes("altimetrie") ? "alti.json" : u.includes("dvf") ? "dvf.json" : null;
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
});
