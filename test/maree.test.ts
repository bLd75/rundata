import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parse, read } from "../src/providers/maregraphes.js";
import { gaugeRow, gauges, maree } from "../src/tools/maree.js";
import { seaPage } from "../src/web/pages.js";

// Fifteen hours of both SHOM tide gauges, 23/10/2026 from 08:40 to 23:40 UTC (12:40 to 03:40 in La Réunion).
const series = (id: string) => parse(JSON.parse(readFileSync(new URL(`./fixtures/shom_${id}.json`, import.meta.url), "utf8")));
const NOW = new Date("2026-10-23T23:43:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
function cache(gauges: Record<string, ReturnType<typeof series>> = { "110": series("110"), "832": series("832") }) {
  const store = new MemoryStore();
  for (const [id, value] of Object.entries(gauges)) void store.put(`maree:${id}`, { value, fetchedAt: NOW.getTime() });
  return new Cache(store, () => NOW.getTime());
}

describe("tide gauges", () => {
  it("reads the level, the trend and the last turning points", () => {
    const r = read(series("110"))!;
    expect(r.tendance).toBe("descendante");
    expect(r.h).toBeGreaterThan(0.4);
    expect(r.h).toBeLessThan(0.6);
    const [low, high] = r.extremes.slice(-2);
    expect(low).toMatchObject({ type: "basse_mer", h: 0.39 });
    expect(high).toMatchObject({ type: "pleine_mer", h: 0.86 });
    expect(new Date(high.t).toISOString().slice(11, 13)).toBe("20");
  });

  it("does not call a high water still going on a turning point", () => {
    const upToHigh = series("110").filter((p) => p.t <= Date.parse("2026-10-23T20:30:00Z"));
    expect(read(upToHigh)!.extremes.map((e) => e.type)).toEqual(["basse_mer"]);
  });

  it("answers for a place from the nearest gauge, in La Réunion's time", async () => {
    const r = body(await maree(cache(), "Saint-Paul", NOW));
    expect(r.resume).toMatch(/^Marée au marégraphe le plus proche de Saint-Paul, Pointe des Galets \(Le Port, à \d+ km\) : 0,\d+ m, marée descendante ; dernière pleine mer vers 00:0\d \(0,86 m\) ; dernière basse mer vers 17:4\d \(0,39 m\)\.$/);
    expect(r.maregraphes[0].reference).toMatch(/zéro hydrographique/);
    expect(r.donnees).toMatch(/jamais une prévision/);
  });

  it("gives both gauges without a place, and says when one has gone quiet", async () => {
    const quiet = series("832").filter((p) => p.t <= Date.parse("2026-10-23T22:30:00Z"));
    const r = body(await maree(cache({ "110": series("110"), "832": quiet }), undefined, NOW));
    expect(r.maregraphes).toHaveLength(2);
    expect(r.maregraphes[1].avertissement).toMatch(/n'a rien envoyé depuis/);
    expect(r.sources[0].attribution).toMatch(/REFMAR/);
  });

  it("shows both gauges on the sea page", async () => {
    const maree = (await gauges(cache(), NOW)).map((g) => gaugeRow(g, NOW));
    const html = seaPage("https://rundata.re", { value: { plages: [], maree, sources: [] }, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain('<h2 id="h-maree">La marée en ce moment</h2>');
    expect(html).toMatch(/<li><span>Pointe des Galets \(Le Port\)<\/span><b>0,\d+\u202fm<\/b><span>marée descendante, mesurée à 03:4\d<\/span><span>pleine mer vers 00:0\d \(0,86 m\)<\/span>/);
  });
});
