import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { configure, IDS, parseLive, STATIONS, timeOf, type Live } from "../src/providers/irve.js";
import { bornesRecharge } from "../src/tools/bornes.js";
import { bornesPage } from "../src/web/domains.js";
import { buildBornes } from "../src/web/data.js";
import { DESCRIPTION_MAX } from "../src/web/pages.js";

// The 407 rows of La Réunion in the national live file of 24/10/2026 at 00:37 UTC, and four rows of mainland France.
const CSV = readFileSync(new URL("./fixtures/irve_dynamique.csv", import.meta.url), "utf8");
const NOW = new Date("2026-10-24T00:40:00Z");
const LIVE = parseLive(CSV, IDS, new Date("2026-10-24T00:37:00Z"));
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

function cache(live: Live | null) {
  configure(async () => live);
  return new Cache(new MemoryStore(), () => NOW.getTime());
}

afterEach(() => configure(undefined));

describe("bornes de recharge", () => {
  it("keeps La Réunion's points only, their times in UTC", () => {
    expect(Object.keys(LIVE.points)).toHaveLength(407);
    expect(Object.keys(LIVE.points).every((id) => IDS.has(id))).toBe(true);
    // Freshmile writes Paris time without its offset: UTC+2 until the last Sunday of October, then UTC+1.
    expect(timeOf("2026-10-24 02:12:04")).toBe("2026-10-24T00:12:04.000Z");
    expect(timeOf("2026-12-24 02:12:04")).toBe("2026-12-24T01:12:04.000Z");
    expect(timeOf("2026-10-23 06:18:11.896000+00:00")).toBe("2026-10-23T06:18:11.896Z");
    expect(Object.values(LIVE.points).every(([, , at]) => at < NOW.toISOString())).toBe(true);
  });

  it("knows every station's commune and each point's power", () => {
    expect(STATIONS).toHaveLength(136);
    expect(STATIONS.every((s) => s.commune && s.points.length && s.points.every((p) => p.kw > 0))).toBe(true);
  });

  it("sums up the island, fast charging apart", async () => {
    const r = body(await bornesRecharge(cache(LIVE), undefined, false, NOW));
    expect(r.resume).toMatch(/^Bornes de recharge publiques à La Réunion : 136 stations, 411 points de charge ; en ce moment 268 libres sur 411/);
    expect(r.communes[0]).toEqual({ commune: "Sainte-Marie", stations: 18, points: 103, libres: 45 });
    expect(r.recharge_rapide.every((s: { puissance_max_kw: number }) => s.puissance_max_kw >= 50)).toBe(true);
  });

  it("gives the nearest stations to a place, and every point's state", async () => {
    const r = body(await bornesRecharge(cache(LIVE), "Saint-Gilles-les-Bains", false, NOW));
    expect(r.resume).toMatch(/^Borne de recharge la plus proche de Saint-Gilles-les-Bains : .+, à 1,6 km, \d+ libres? sur \d+/);
    expect(r.stations[0].points[0]).toMatchObject({ puissance_kw: 80, prises: ["Combo CCS"], etat: "libre" });
    const town = body(await bornesRecharge(cache(LIVE), "Le Tampon", false, NOW));
    expect(town.resume).toMatch(/^9 stations de recharge au Tampon : 18 libres sur 19/);
  });

  it("still lists the stations when the live state is missing", async () => {
    const r = body(await bornesRecharge(cache(null), "Cilaos", false, NOW));
    expect(r.resume).toMatch(/^1 station de recharge à Cilaos\.$/);
    expect(r.donnees).toMatch(/indisponible/);
    expect(r.stations[0].points[0].etat).toBeUndefined();
    await expect(buildBornes(cache(null), NOW)).rejects.toThrow();
  });

  it("serves a page with the free points of each commune", async () => {
    const data = await buildBornes(cache(LIVE), NOW);
    const page = bornesPage("https://rundata.re", { value: data, fetchedAt: NOW, stale: false }, NOW);
    expect(page).toContain('<span class="big">268</span>');
    expect(page).toContain("Recharge rapide");
    expect(page).toMatch(/<h3>Sainte-Marie <span class="note">45 libres sur 103, 18 stations<\/span><\/h3>/);
    const description = page.match(/<meta name="description" content="([^"]+)"/)?.[1] ?? "";
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});
