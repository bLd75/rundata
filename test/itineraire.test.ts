import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as transit from "../src/providers/transit.js";
import { CHANGE_S, chosen, endOf, journeys, type Journey, ROWS_MAX, ZONE_MAX } from "../src/tools/itineraire.js";
import { answer, askedOf, itinerairePage, journeyForm } from "../src/web/itineraire.js";

// Rows of the D1 database read by the searches below, from the networks' GTFS of 31/10/2026 (scripts/build-transit.py).
const rows = JSON.parse(readFileSync(new URL("./fixtures/transit/itineraire.json", import.meta.url), "utf8")) as Record<string, Record<string, { id: number }[]>>;
let reads = 0;
const fake: transit.TransitDb = {
  all: async <T>(sql: string, keys: unknown) => {
    reads++;
    const table = /FROM passes/.test(sql) ? "passes" : /FROM pattern_stops/.test(sql) ? "pattern_stops" : "patterns";
    return (JSON.parse(String(keys)) as [string, number][]).flatMap(([feed, id]) => rows[feed]?.[table]?.filter((r) => r.id === id).map((r) => ({ feed, ...r })) ?? []) as T[];
  },
};
beforeEach(() => {
  reads = 0;
  transit.configure(fake);
});
afterEach(() => transit.configure(undefined));

const hm = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
const said = (j: Journey) => `${hm(j.depart)} ${j.legs.map((l) => `${l.ligne} ${transit.stop(l.de).nom} ${hm(l.depart)}-${transit.stop(l.a).nom} ${hm(l.arrivee)}`).join(" / ")} ${hm(j.arrivee)}`;
// Saturday 31/10/2026, 14:00 in La Réunion.
const NOW = new Date("2026-10-31T10:00:00Z");

describe("the start and the end of a journey", () => {
  it("takes a commune alone for its main stops, at most 80", () => {
    const e = endOf("Petite-Île")!;
    expect(e).toMatchObject({ sorte: "commune", nom: "Petite-Île" });
    expect(e.stops.size).toBeLessThanOrEqual(ZONE_MAX);
    expect([...e.stops.keys()].map((id) => transit.stop(id).nom)).toContain("Croisée Petite-Île");
  });

  it("finds the airport's stops of both networks that serve it", () => {
    const e = endOf("aéroport Roland-Garros")!;
    expect(e.sorte).toBe("arret");
    expect(new Set([...e.stops.keys()].map((id) => transit.stop(id).reseau))).toEqual(new Set(["carjaune", "citalis"]));
  });

  it("takes a place for the stops around it, with the walk, when a stop's name has only some of its words", () => {
    const e = endOf("plage de l'Hermitage")!;
    expect(e.sorte).toBe("lieu");
    expect(Math.max(...e.stops.values())).toBeGreaterThan(0);
  });

  it("finds nothing for words that are neither a stop nor a place", () => {
    expect(endOf("xyzzy plugh")).toBeUndefined();
  });
});

describe("the journeys", () => {
  it("go from Petite-Île to the airport on Monday 2/11 before 18:00 with one change at Saint-Pierre (a Facebook group's question)", async () => {
    const r = await journeys(endOf("Petite-Île")!, endOf("aéroport Roland-Garros")!, 20261102, 18 * 3600, true);
    expect(r.trajets.length).toBeGreaterThan(0);
    expect(r.trajets.every((j) => j.arrivee <= 18 * 3600 && j.legs.length === 2)).toBe(true);
    expect(r.trajets.map(said)).toContain("12:15 S3 Croisée Petite-Île 12:15-Gare de St-Pierre 12:41 / T Gare de St-Pierre 13:00-Aéroport Roland Garros 15:16 15:16");
    // The change: the bus station's two bays, a walk under 400 m, with the time to change.
    const j = r.trajets.find((x) => x.legs[1].ligne === "T")!;
    expect(j.legs[1].depart - j.legs[0].arrivee).toBeGreaterThanOrEqual((j.marche_changement ?? 0) + CHANGE_S);
    expect(j.legs.every((l) => l.trajet?.startsWith("/bus/trajet/carjaune/"))).toBe(true);
  });

  it("read the database three times, under the cap", async () => {
    const r = await journeys(endOf("Petite-Île")!, endOf("aéroport Roland-Garros")!, 20261102, 18 * 3600, true);
    expect(r.lectures.requetes).toBe(3);
    expect(reads).toBe(3);
    expect(r.lectures.lignes).toBeLessThanOrEqual(ROWS_MAX);
  });

  it("go up to Mont-Vert-les-Hauts on a Sunday to arrive before 14:00 (the 12:30 bus, line 5)", async () => {
    const r = await journeys(endOf("Pôle d'échange Marché couvert, Saint-Pierre")!, endOf("Chemin des Bambous")!, 20261101, 14 * 3600, true);
    expect(r.trajets.map(said)).toContain("12:30 5 Pôle D'Echange Marché Couvert 12:30-Chemin Des Bambous 13:01 13:01");
  });

  it("are none after the last bus of the day, never the next morning's bus as if it were that day's", async () => {
    const r = await journeys(endOf("Chemin des Bambous")!, endOf("Pôle d'échange Marché couvert, Saint-Pierre")!, 20261101, 15 * 3600 + 40 * 60, false);
    expect(r.trajets).toEqual([]);
    // The whole day was looked through, to 03:00 the next morning.
    expect(r.fenetre.a).toBe(27 * 3600);
  });
});

describe("keeping the journeys worth taking", () => {
  const j = (depart: number, arrivee: number, legs = 1) => ({ legs: Array.from({ length: legs }, (_, k) => ({ ligne: `L${k}`, depart: depart + k, arrivee })), marche_depart: 0, marche_arrivee: 0, depart, arrivee }) as Journey;
  it("drops one that leaves sooner and arrives later than another, or as soon with more changes", () => {
    const kept = chosen([j(100, 900), j(200, 800), j(200, 800, 2), j(300, 1000)], 0, 1000, false);
    expect(kept.map((x) => [x.depart, x.arrivee, x.legs.length])).toEqual([[200, 800, 1], [300, 1000, 1]]);
  });
  it("keeps the last 5 to leave and arrive before the time, the last first", () => {
    const kept = chosen(Array.from({ length: 8 }, (_, i) => j(i * 100, i * 100 + 50)), 0, 700, true);
    expect(kept.map((x) => x.depart)).toEqual([600, 500, 400, 300, 200]);
  });
});

describe("the page", () => {
  it("has a form that needs no script, filled with what was asked", () => {
    const f = journeyForm({ de: "Petite-Île", a: "aéroport", jour: "2026-11-02", heure: "18:00", arrivee: true });
    expect(f).toContain('method="get"');
    expect(f).toContain('value="Petite-Île"');
    expect(f).toMatch(/value="arrivee" checked/);
    expect(f).not.toContain("<script");
  });

  it("reads what the address asks, and nothing without a start and an end", () => {
    expect(askedOf(new URLSearchParams("de=Petite-%C3%8Ele&a=a%C3%A9roport&sens=arrivee&jour=2026-11-02&heure=18%3A00"))).toEqual({ de: "Petite-Île", a: "aéroport", jour: "2026-11-02", heure: "18:00", arrivee: true });
    expect(askedOf(new URLSearchParams("de=Petite-%C3%8Ele"))).toBeUndefined();
    // A day or a time that is not one: now.
    expect(askedOf(new URLSearchParams("de=a&a=b&jour=demain&heure=25%3A00"))).toMatchObject({ jour: "", heure: "" });
  });

  it("lists the journeys, says they are timetables, and that a commune stands for its main stops", async () => {
    const r = await answer({ de: "Petite-Île", a: "aéroport Roland-Garros", jour: "2026-11-02", heure: "18:00", arrivee: true }, NOW);
    expect(r.quand).toBe("lundi 2 novembre, pour arriver avant 18 h");
    const page = itinerairePage("https://rundata.re", r).replaceAll("&#39;", "'");
    expect(page).toContain("Résultats pour les principaux arrêts de Petite-Île : précisez l'arrêt pour un quartier.");
    expect(page).toContain("Horaires prévus par les réseaux, pas la position des bus en direct");
    expect(page).toContain("De Petite-Île (principaux arrêts) à l'arrêt Aéroport Roland-Garros, lundi 2 novembre, pour arriver avant 18\u00a0h.");
    // The bus to take first: the one leaving last.
    expect(page.indexOf("14:22 → 17:39")).toBeLessThan(page.indexOf("12:15 → 15:16"));
    expect(page).toContain("1 correspondance");
    expect(page).toContain('<meta name="robots" content="noindex">');
  });

  it("says there is no more bus that day after the last one", async () => {
    const r = await answer({ de: "Chemin des Bambous", a: "Pôle d'échange Marché couvert, Saint-Pierre", jour: "2026-11-01", heure: "15:40", arrivee: false }, NOW);
    expect(itinerairePage("https://rundata.re", r).replaceAll("&#39;", "'")).toContain("Plus aucun trajet direct ni avec une seule correspondance ce jour-là après 15:40, d'après les horaires prévus.");
  });

  it("says which end it did not find", async () => {
    const r = await answer({ de: "xyzzy plugh", a: "aéroport", jour: "", heure: "", arrivee: false }, NOW);
    expect(itinerairePage("https://rundata.re", r)).toContain("Départ non trouvé : « xyzzy plugh ».");
    expect(reads).toBe(0);
  });
});
