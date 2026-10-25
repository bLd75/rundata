import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as transit from "../src/providers/transit.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { departures, findStops, pageRow, tripRun } from "../src/tools/transports.js";
import { tripGonePage, tripPage } from "../src/web/trajet.js";

// The rows of the database for Saint-Pierre's bus station, as in test/transports.test.ts (GTFS of 23/10/2026).
const rows = JSON.parse(readFileSync(new URL("./fixtures/transit/rows.json", import.meta.url), "utf8")) as Record<
  string,
  { passes?: { id: number }[]; patterns?: { id: number }[]; pattern_stops?: { id: number }[] }
>;
const fake: transit.TransitDb = {
  all: async <T>(sql: string, keys: unknown) =>
    (JSON.parse(String(keys)) as [string, number][]).flatMap(([feed, id]) =>
      (/FROM passes/.test(sql) ? rows[feed]?.passes : /FROM pattern_stops/.test(sql) ? rows[feed]?.pattern_stops : rows[feed]?.patterns)
        ?.filter((r) => r.id === id).map((r) => ({ feed, ...r })) ?? [],
    ) as T[],
};
// Friday 23/10/2026, 7h30 in La Réunion.
const NOW = new Date("2026-10-23T03:30:00Z");
const ORIGIN = "https://rundata.re";
const CJ = transit.NETWORKS.carjaune;

beforeEach(() => transit.configure(fake));
afterEach(() => transit.configure(undefined));

/** A Car Jaune departure from Saint-Pierre's bus station whose pattern has its stops in the fixture. */
async function departure() {
  const list = await departures(findStops("gare routière Saint-Pierre").groups, NOW);
  const withStops = new Set(rows[CJ.stops_feed!].pattern_stops!.map((r) => CJ.first_pattern + r.id));
  return list.find((d) => d.reseau === "carjaune" && withStops.has(d.pattern))!;
}

describe("the link of a departure", () => {
  it("names its pattern and its stop within the network, and the day of its service", async () => {
    const d = await departure();
    expect(d.jour).toBe(20261023);
    const local = d.stop - CJ.first_stop;
    expect(pageRow(d).trajet).toBe(`/bus/trajet/carjaune/${d.pattern - CJ.first_pattern}/${encodeURIComponent(d.trip)}?jour=20261023&arret=${local}#arret-${local}`);
  });
});

describe("a trip", () => {
  it("gives its stops in order with their times, from its start on the day of its service", async () => {
    const d = await departure();
    const t = (await tripRun("carjaune", d.pattern - CJ.first_pattern, d.trip, 20261023, NOW))!;
    expect(t.ligne).toBe(pageRow(d).ligne);
    expect(t.arrets!.length).toBeGreaterThan(2);
    const at = t.arrets!.find((s) => s.id === d.stop)!;
    // The time at the stop clicked on is the departure's.
    expect(at.at).toBe(NOW.getTime() + d.in * 1000);
    expect(t.arrets!.map((s) => s.at)).toEqual([...t.arrets!.map((s) => s.at)].sort((a, b) => a - b));
    expect(t.depart).toBe(t.arrets![0].at);
    expect(t.direct).toBeUndefined();
  });

  it("is not found for a trip, a pattern or a network it does not have, nor on a day it does not run", async () => {
    const d = await departure();
    const local = d.pattern - CJ.first_pattern;
    expect(await tripRun("carjaune", local, "pas-un-trip", 20261023, NOW)).toBeUndefined();
    expect(await tripRun("nulle-part", local, d.trip, 20261023, NOW)).toBeUndefined();
    expect(await tripRun("carjaune", 999_999, d.trip, 20261023, NOW)).toBeUndefined();
    // Another network's pattern, by its number in Car Jaune's.
    expect(await tripRun("carjaune", transit.NETWORKS.citalis.first_pattern - CJ.first_pattern, d.trip, 20261023, NOW)).toBeUndefined();
    const runs = (ymd: number, wd: number) => transit.servicesOf(d.pattern).some((s) => transit.serviceRuns("carjaune", s, ymd, wd));
    // A day of the week its service does not run, in the next weeks.
    const off = Array.from({ length: 7 }, (_, i) => [20261024 + i, (4 + 1 + i) % 7] as const).find(([ymd, wd]) => ymd <= 20261031 && !runs(ymd, wd));
    if (off) expect(await tripRun("carjaune", local, d.trip, off[0], NOW)).toBeUndefined();
  });

  it("without a day, takes yesterday's run while it is on the road after midnight, else today's", async () => {
    const local = 0;
    const id = CJ.first_pattern + local;
    // A service of Car Jaune running on Friday 23/10.
    const service = Array.from({ length: 500 }, (_, i) => i).find((s) => transit.serviceRuns("carjaune", s, 20261023, 4))!;
    // A night trip: from 23h50 to 0h30, on Friday's service.
    const night: transit.TransitDb = {
      all: async <T>(sql: string) =>
        (/FROM pattern_stops/.test(sql)
          ? [{ feed: CJ.stops_feed, id: local, sens: 0, stops: JSON.stringify([[0, 0], [1, 1200], [2, 2400]]) }]
          : [{ feed: CJ.feed, id: local, route: transit.ENDS[id][0] - CJ.first_route, headsign: "Saint-Denis", trips: JSON.stringify([[service, 23 * 3600 + 50 * 60, "nuit"]]) }]) as T[],
    };
    transit.configure(night);
    const friday = (await tripRun("carjaune", local, "nuit", 20261023, NOW))!;
    expect(friday).toBeDefined();
    // Saturday 0h10: Friday's run is on the road, its last stop after midnight.
    const after = new Date("2026-10-23T20:10:00Z");
    const t = (await tripRun("carjaune", local, "nuit", undefined, after))!;
    expect(t.jour).toBe(20261023);
    const html = tripPage(ORIGIN, "/bus/trajet/carjaune/0/nuit", t, undefined, after);
    // Seen at 0h10, its stops are said without « demain »; its start is the day before's.
    expect(html).toContain(">0h30<");
    expect(html).not.toContain("demain 0h30");
    expect(html).toContain("départ de");
    expect(html).toContain("à 23h50, vendredi 23 octobre");
    // Seen on Friday at 23h00, the stop after midnight is tomorrow's.
    const before = new Date("2026-10-23T19:00:00Z");
    expect(tripPage(ORIGIN, "/bus/trajet/carjaune/0/nuit?jour=20261023", friday, undefined, before)).toContain(">demain 0h30<");
  });
});

describe("the page of a trip", () => {
  it("marks the stop clicked on, is not indexed, and has no stop in its canonical address", async () => {
    const d = await departure();
    const local = d.pattern - CJ.first_pattern;
    const t = (await tripRun("carjaune", local, d.trip, 20261023, NOW))!;
    const path = `/bus/trajet/carjaune/${local}/${encodeURIComponent(d.trip)}?jour=20261023`;
    const html = tripPage(ORIGIN, path, t, d.stop, NOW);
    expect(html).toContain(`<meta name="robots" content="noindex">`);
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}${path}">`);
    expect(html).toContain(`<li id="arret-${d.stop - CJ.first_stop}" class="ici" aria-current="location">`);
    expect(html.match(/arrêt choisi/g)).toHaveLength(1);
    expect(html).toContain(`<h1>Ligne ${t.ligne} vers ${t.direction}</h1>`);
    expect(html).toContain(`, aujourd&#39;hui</p>`);
    expect(html).toContain("Horaires publiés par Car Jaune, sans les retards ni les déviations.");
    // Without a stop in the link, none is marked.
    expect(tripPage(ORIGIN, path, t, undefined, NOW)).not.toContain("arrêt choisi");
  });

  it("gives the delay the network announces at each stop, while the bus is in its feed", async () => {
    const d = await departure();
    const local = d.pattern - CJ.first_pattern;
    const t0 = NOW.getTime() / 1000;
    const stopId = (id: number) => CJ.temps_reel!.arrets[id - CJ.first_stop];
    const store = new MemoryStore();
    store.put("rt:carjaune", { value: { at: t0 - 30, trips: { [d.trip]: { [stopId(d.stop)]: t0 + d.in + 5 * 60 } }, cancelled: [], alerts: [], vehicles: [] }, fetchedAt: NOW.getTime() });
    const t = (await tripRun("carjaune", local, d.trip, 20261023, NOW, new Cache(store)))!;
    expect(t.direct).toEqual({ etat: "suivi", flux: t0 - 30 });
    const html = tripPage(ORIGIN, "/x", t, d.stop, NOW);
    expect(html).toMatch(/<b class="rt" title="Heure annoncée en direct par le réseau">annoncé \d+h\d\d \(\+5 min\)<\/b>/);
    expect(html).toContain("Prévu : horaires publiés par Car Jaune. Annoncé : heure donnée en direct par Car Jaune, flux de ");

    // A feed that does not speak of it; one that is too old.
    store.put("rt:carjaune", { value: { at: t0 - 30, trips: {}, cancelled: [], alerts: [], vehicles: [] }, fetchedAt: NOW.getTime() });
    const absent = (await tripRun("carjaune", local, d.trip, 20261023, NOW, new Cache(store)))!;
    expect(tripPage(ORIGIN, "/x", absent, undefined, NOW)).toContain("Ce bus ne figure pas dans le flux en direct de Car Jaune (flux de ");
    store.put("rt:carjaune", { value: { at: t0 - 3600, trips: {}, cancelled: [d.trip], alerts: [], vehicles: [] }, fetchedAt: NOW.getTime() });
    const old = (await tripRun("carjaune", local, d.trip, 20261023, NOW, new Cache(store)))!;
    expect(old.supprime).toBeUndefined();
    expect(tripPage(ORIGIN, "/x", old, undefined, NOW)).toContain("Le flux en direct de Car Jaune ne répond pas pour le moment : horaires publiés seulement.");

    // Cancelled: said above the stops, their times struck.
    store.put("rt:carjaune", { value: { at: t0 - 30, trips: {}, cancelled: [d.trip], alerts: [], vehicles: [] }, fetchedAt: NOW.getTime() });
    const cut = (await tripRun("carjaune", local, d.trip, 20261023, NOW, new Cache(store)))!;
    const page = tripPage(ORIGIN, "/x", cut, undefined, NOW);
    expect(page).toContain("Départ supprimé, annoncé en direct par Car Jaune (flux de ");
    expect(page).toContain("<s>");
  });

  it("says a trip the timetables no longer have, with the way to the bus stations", () => {
    const html = tripGonePage(ORIGIN, "/bus/trajet/carjaune/1/x", "carjaune");
    expect(html).toContain("Ce départ ne figure plus dans les horaires publiés par Car Jaune.");
    expect(html).toContain(`<a href="/bus">Prochains départs dans les gares →</a>`);
    expect(html).toContain(`<meta name="robots" content="noindex">`);
    expect(tripGonePage(ORIGIN, "/bus/trajet/x", undefined)).toContain("Ce départ ne figure plus dans les horaires publiés des réseaux.");
  });
});
