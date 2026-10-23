import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as transit from "../src/providers/transit.js";
import { findStops, parseQuery, transports } from "../src/tools/transports.js";

// Rows of the D1 database for the stations of Saint-Pierre, the cable car at Bancoul and Hell-Bourg, from the
// networks' GTFS of 23/10/2026 (scripts/build-transit.py).
// By feed, as scripts/build-transit.py writes them to the database.
const rows = JSON.parse(readFileSync(new URL("./fixtures/transit/rows.json", import.meta.url), "utf8")) as Record<
  string,
  { passes: { id: number }[]; patterns: { id: number }[] }
>;
const fake: transit.TransitDb = {
  all: async <T>(sql: string, keys: unknown) =>
    (JSON.parse(String(keys)) as [string, number][]).flatMap(([feed, id]) =>
      (/FROM passes/.test(sql) ? rows[feed]?.passes : rows[feed]?.patterns)?.filter((r) => r.id === id).map((r) => ({ feed, ...r })) ?? [],
    ) as T[],
};
// Friday 23/10/2026, 7h30 in La Réunion.
const NOW = new Date("2026-10-23T03:30:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

beforeEach(() => transit.configure(fake));
afterEach(() => transit.configure(undefined));

describe("finding the stop", () => {
  it("reads a network, a commune and the words left", () => {
    expect(parseQuery("prochain car jaune à St-Leu")).toEqual({ reseau: "carjaune", commune: "Saint-Leu", words: [] });
    expect(parseQuery("gare routière de Sainte-Marie")).toMatchObject({ commune: "Sainte-Marie", words: ["gare"] });
  });

  it("finds a bus station under each network's name for it", () => {
    const { groups } = findStops("gare routière Saint-Pierre");
    expect(groups.map((g) => `${g.reseau}:${g.nom}`).sort()).toEqual([
      "alterneo:Gare De Saint Pierre",
      "carjaune:Gare de St-Pierre",
      "carsud:Gare Routière De St Pierre",
    ]);
  });

  it("takes a bus station's bays as one stop", () => {
    const { groups } = findStops("gare routière du Tampon, CarSud");
    expect(groups).toHaveLength(1);
    expect(groups[0].nom).toBe("Gare Routière Du Tampon");
    expect(groups[0].ids.length).toBeGreaterThan(10);
  });

  it("gives the stops nearest a place that is not a stop", () => {
    const { groups, near } = findStops("prochain car jaune à Saint-Leu");
    expect(groups.every((g) => g.reseau === "carjaune")).toBe(true);
    expect(near[0].m).toBeLessThan(2000);
  });

  it("does not take « car jaune » for the stop « Fleurs Jaunes »", () => {
    expect(findStops("car jaune Saint-Leu").groups.some((g) => /jaune/i.test(g.nom))).toBe(false);
  });
});

describe("transports", () => {
  it("lists the next departures of every network at the station, line by line", async () => {
    const r = body(await transports("gare routière Saint-Pierre", undefined, NOW));
    expect(r.resume).toMatch(/^Prochains départs à Gare de St-Pierre \(Saint-Pierre, Car Jaune\)/);
    expect(r.departs.length).toBeGreaterThan(5);
    expect(r.departs[0].dans_min).toBeLessThanOrEqual(r.departs[1].dans_min);
    expect(new Set(r.departs.map((d: { reseau: string }) => d.reseau)).size).toBeGreaterThan(1);
    expect(r.horaires).toMatch(/^théoriques/);
    expect(r.sources[0].licence).toBe("Licence Ouverte Etalab 2.0");
  });

  it("keeps one line only when asked, and never a code as direction", async () => {
    const r = body(await transports("gare routière Saint-Pierre", "S2", NOW));
    expect(r.departs.every((d: { ligne: string }) => d.ligne === "S2")).toBe(true);
    const all = body(await transports("gare routière Saint-Pierre", undefined, NOW));
    expect(all.departs.some((d: { direction: string }) => /^\d+$/.test(d.direction))).toBe(false);
  });

  it("runs the cable car every minute from its frequencies, each departure once", async () => {
    const r = body(await transports("téléphérique Bancoul", undefined, NOW));
    const mer = r.departs.filter((d: { direction: string }) => d.direction === "MER");
    expect(mer.map((d: { heure: string }) => d.heure)).toEqual(["7h29", "7h30", "7h31"]);
  });

  it("looks further ahead in a cirque where buses are rare", async () => {
    const r = body(await transports("Hell-Bourg", undefined, NOW));
    expect(r.arrets[0].commune).toBe("Salazie");
    expect(r.departs.length).toBeGreaterThan(2);
  });

  it("gives the next morning's buses after the last one of the evening", async () => {
    // Friday 23/10/2026, 18h30: no more buses at Hell-Bourg until Saturday.
    const r = body(await transports("Hell-Bourg", undefined, new Date("2026-10-23T14:30:00Z")));
    expect(r.departs[0].heure).toBe("demain 5h51");
    expect(r.departs[0].dans_min).toBeGreaterThan(11 * 60);
    expect(r.resume).toMatch(/vers GARE SAINT ANDRE demain à 5h51 \(dans 11 h \d\d\)/);
  });

  it("says when it cannot answer outside the Worker", async () => {
    transit.configure(undefined);
    const r = await transports("gare routière Saint-Pierre", undefined, NOW);
    expect(r.isError).toBe(true);
  });
});
