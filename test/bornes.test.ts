import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { configure, IDS, parseLive, refresh, refreshDue, STATIONS, timeOf, type Live } from "../src/providers/irve.js";
import { bornesRecharge } from "../src/tools/bornes.js";
import { bornesPage } from "../src/web/domains.js";
import { buildBornes } from "../src/web/data.js";
import { DESCRIPTION_MAX } from "../src/web/pages.js";
import { deadAnchors, doubleIds, mapLinks } from "./cartes.js";

// The 407 rows of La Réunion in the national live file of 24/10/2026 at 00:37 UTC, and four rows of mainland France.
const CSV = readFileSync(new URL("./fixtures/irve_dynamique.csv", import.meta.url), "utf8");
const NOW = new Date("2026-10-24T00:40:00Z");
const LIVE = parseLive(CSV, IDS, new Date("2026-10-24T00:37:00Z"));
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

function cache(live: Live | null) {
  configure(async () => live);
  return new Cache(new MemoryStore(), () => NOW.getTime());
}

afterEach(() => (configure(undefined), vi.unstubAllGlobals()));

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

  it("writes La Réunion's part every 15 minutes, at 5, 20, 35 and 50 past the hour, never a part that lost its points", async () => {
    const due = Array.from({ length: 12 }, (_, i) => i * 5).filter((m) => refreshDue(new Date(Date.UTC(2026, 9, 26, 8, m, 2))));
    expect(due).toEqual([5, 20, 35, 50]);
    let written: Live | undefined;
    const write = async (live: Live) => void (written = live);
    vi.stubGlobal("fetch", async () => new Response(CSV));
    expect(await refresh(write, NOW)).toBe(407);
    expect(written).toEqual({ lu: NOW.toISOString(), points: LIVE.points });
    written = undefined;
    vi.stubGlobal("fetch", async () => new Response(CSV.split("\n").slice(0, 100).join("\n")));
    await expect(refresh(write, NOW)).rejects.toThrow(new RegExp(`seulement \\d+ points de La Réunion sur ${IDS.size}`));
    expect(written).toBeUndefined();
  });

  it("knows every station's commune and each point's power", () => {
    expect(STATIONS).toHaveLength(136);
    expect(STATIONS.every((s) => s.commune && s.points.length && s.points.every((p) => p.kw > 0))).toBe(true);
  });

  it("sums up the island, fast charging apart", async () => {
    const r = body(await bornesRecharge(cache(LIVE), undefined, false, NOW));
    expect(r.resume).toMatch(/^Bornes de recharge publiques à La Réunion : 136 stations, 411 points de charge\u00a0; en ce moment 268 libres sur 411/);
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
    expect(page).toMatch(/<details><summary><h3>Sainte-Marie\u00a0<span class="note">·\u00a045\u00a0libres sur\u00a0103, 18\u00a0stations<\/span><\/h3><\/summary>/);
    // Each commune's marker leads to its card.
    expect(mapLinks(page).find((l) => l.label.startsWith("Sainte-Marie :"))).toEqual({ kind: "mk", href: "#c-sainte-marie", label: "Sainte-Marie : 45 points de charge libres sur 103, voir le détail" });
    expect(deadAnchors(page)).toEqual([]);
    expect(doubleIds(page)).toEqual([]);
    const description = page.match(/<meta name="description" content="([^"]+)"/)?.[1] ?? "";
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});
