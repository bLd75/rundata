import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parse, read } from "../src/providers/maregraphes.js";
import { gaugeRow, gauges, maree } from "../src/tools/maree.js";
import { communePage } from "../src/web/commune.js";
import { placePage, seaPage } from "../src/web/pages.js";
import { PAGES } from "../src/web/places.js";

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
    expect(r.resume).toMatch(/^Marée au marégraphe le plus proche de Saint-Paul, Pointe des Galets \(Le Port, à \d+ km\) : 0,\d+ m, marée descendante\u00a0; dernière pleine mer vers 00:0\d \(0,86 m\)\u00a0; dernière basse mer vers 17:4\d \(0,39 m\)\u00a0; prochaines marées, /);
    expect(r.maregraphes[0].reference).toMatch(/zéro hydrographique/);
    expect(r.donnees).toMatch(/pas la prédiction officielle du SHOM/);
  });

  it("computes the next tides, labelled, to five minutes, with the gauge's precision", async () => {
    const r = body(await maree(cache(), "Saint-Paul", NOW));
    // These words are required: never remove them (the SHOM's predictions are not open, this is not them).
    expect(r.resume).toContain("calcul de rundata d'après les mesures, pas la prédiction officielle du SHOM, à environ 15 min près : basse mer vers 06:00 (0,");
    const next = r.maregraphes[0].prochaines_marees;
    expect(next.nature).toBe("calcul");
    expect(next.avertissement).toBe("calcul de rundata d'après les mesures, pas la prédiction officielle du SHOM\u00a0; heures à environ 15 min près, hauteurs à environ 5 cm près.");
    expect(next.controle).toMatch(/^vérifié sur 3 mois de mesures hors calcul : écart médian \d+ min, \d+ cm$/);
    expect(next.recalage).toMatch(/^hauteurs recalées de [+-]\d+ cm sur le niveau mesuré des 6 dernières heures$/);
    // Two days of tides (« la marée basse demain »), high and low in turn, and where the computation stops.
    const types = next.liste.map((e: { type: string }) => e.type);
    expect(types.length).toBeGreaterThanOrEqual(7);
    expect(types).toEqual(types.map((_: string, i: number) => (i % 2 ? "pleine mer" : "basse mer")));
    expect(next.horizon).toMatch(/^calculé jusqu'au 26\/10 03:4\d heure de La Réunion\u00a0; au-delà, les prédictions officielles du SHOM : https:\/\/maree\.shom\.fr$/);
    // Never a time to the minute.
    for (const e of next.liste) expect(e.heure).toMatch(/vers \d\d:[0-5][05]$/);
    // The summary read alone: today's and tomorrow's tides, and where the computation stops, with the SHOM beyond.
    const listed = r.resume.split(" près : ")[1].split("\u00a0; ")[0].split(/, (?=pleine|basse)/);
    expect(listed.length).toBe(next.liste.filter((e: { heure: string }) => !/^(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) /.test(e.heure)).length);
    expect(listed.length).toBeGreaterThanOrEqual(6);
    expect(listed.at(-1)).toMatch(/^(?:basse|pleine) mer demain vers \d\d:[0-5][05] \(0,\d+ m/);
    expect(r.resume).toMatch(new RegExp(`\u00a0; ${next.liste.length} marées calculées jusqu'au 26/10 03:4\\d \\(prochaines_marees\\), au-delà les prédictions officielles du SHOM \\(https://maree\\.shom\\.fr\\)\\.$`));
    // Sainte-Marie has its own precision.
    expect(r.maregraphes[1].prochaines_marees.avertissement).toContain("heures à environ 20 min près");
    expect(r.sources[0].attribution).toBe("REFMAR. http://dx.doi.org/10.17183/REFMAR#RONIM");
  });

  it("still gives the computed tides when the gauges are silent, uncorrected", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("no network in tests"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = body(await maree(cache({}), "Saint-Paul", NOW));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    expect(r.resume).toMatch(/marégraphe muet pour le moment\u00a0; prochaines marées, calcul de rundata d'après les mesures, pas la prédiction officielle du SHOM/);
    expect(r.maregraphes[0].prochaines_marees.recalage).toBeUndefined();
  });

  it("gives both gauges without a place, and says when one has gone quiet", async () => {
    const quiet = series("832").filter((p) => p.t <= Date.parse("2026-10-23T22:30:00Z"));
    const r = body(await maree(cache({ "110": series("110"), "832": quiet }), undefined, NOW));
    expect(r.maregraphes).toHaveLength(2);
    // The whole island: the next two of each gauge, and the horizon.
    expect(r.resume.match(/marées calculées jusqu'au 26\/10 03:4\d \(prochaines_marees\)/g)).toHaveLength(2);
    expect(r.resume.split(". ")[0].split(" près : ")[1].split("\u00a0; ")[0].split(/, (?=pleine|basse)/)).toHaveLength(2);
    expect(r.maregraphes[1].avertissement).toMatch(/n'a rien envoyé depuis/);
    expect(r.sources[0].attribution).toMatch(/REFMAR/);
  });

  it("shows both gauges on the sea page", async () => {
    const maree = (await gauges(cache(), NOW)).map((g) => gaugeRow(g, NOW));
    const html = seaPage("https://rundata.re", { value: { plages: [], maree, sources: [] }, fetchedAt: NOW, stale: false }, NOW);
    expect(html).toContain('<h2 id="h-maree">La marée en ce moment</h2>');
    expect(html).toMatch(/<li><span>Pointe des Galets \(Le Port\)<\/span><b>0,\d+\u202fm<\/b><span>marée descendante, mesurée à 03:4\d<\/span><span>pleine mer vers 00:0\d \(0,86 m\)<\/span>/);
    // The next tides, computed at the view, labelled, with each gauge's precision and the citation.
    expect(html).toContain("<h3>Les prochaines marées : un calcul, pas la prédiction du SHOM</h3>");
    expect(html).toMatch(/<li><span>Pointe des Galets \(Le Port\)<\/span><b>basse mer vers 06:00<\/b>/);
    expect(html).toContain("Calcul de rundata d&#39;après les mesures, pas la prédiction officielle du SHOM : analyse harmonique");
    expect(html).toContain("heures à environ 15 min près au Port, 20 min près à Sainte-Marie, hauteurs à environ 5 cm près ; pas de coefficient.");
    expect(html).toContain("REFMAR. http://dx.doi.org/10.17183/REFMAR#RONIM");
  });

  it("gives the next tide on a coastal place's page and on its commune's tile, labelled", async () => {
    const place = PAGES.find((x) => x.slug === "saint-leu")!;
    const data = { value: { mer: { resume: "Eau de mer…", sources: [] } }, fetchedAt: NOW, stale: false };
    const html = placePage("https://rundata.re", place, data as never, NOW);
    expect(html).toMatch(/<p>Marée à Pointe des Galets \(Le Port\), calcul de rundata d&#39;après les mesures, pas la prédiction officielle du SHOM, à environ 15 min près : basse mer vers 06:00 \(0,\d+[ \u202f]m\)/);
    const tile = communePage("https://rundata.re", place, { mer: { value: { plages: [{ nom: "Saint-Leu", commune: "Saint-Leu", lon: 55.28, lat: -21.17, valeur: 25, jour: "2026-10-22" }], sources: [] }, fetchedAt: NOW, stale: false } } as never, NOW);
    expect(tile).toContain(" · basse mer vers 06:00 (marée calculée, pas le SHOM)");
  });
});
