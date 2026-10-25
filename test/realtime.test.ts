import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import * as rt from "../src/providers/gtfsrt.js";
import * as transit from "../src/providers/transit.js";
import { applyRealtime, departureRow, departures, findStops, realtimeFeeds, transports } from "../src/tools/transports.js";

// 40 trips, 2 vehicles and the 3 alerts of the Car Jaune feed of 23/10/2026 at 20:55 (La Réunion).
const FEED = new Uint8Array(readFileSync(new URL("./fixtures/gtfs_rt_carjaune.pb", import.meta.url)));
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
const T0 = NOW.getTime() / 1000;
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cj = transit.NETWORKS.carjaune;
const gtfsStop = (stop: number) => cj.temps_reel!.arrets[stop - cj.first_stop];

beforeEach(() => {
  transit.configure(fake);
  // The other networks' feeds are down: no test reaches the network.
  vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
});
afterEach(() => {
  transit.configure(undefined);
  vi.unstubAllGlobals();
});

/** A cache already holding this feed for Car Jaune, as read a moment ago. */
function withFeed(feed: rt.Realtime) {
  const store = new MemoryStore();
  store.put("rt:carjaune", { value: feed, fetchedAt: NOW.getTime() });
  return new Cache(store, () => NOW.getTime(), false);
}

describe("GTFS-RT feed", () => {
  it("reads the trips' expected times, the skipped stops and the alerts", () => {
    const f = rt.decode(FEED);
    expect(new Date(f.at * 1000).toISOString()).toBe("2026-10-23T16:55:58.000Z");
    expect(Object.keys(f.trips)).toHaveLength(40);
    expect(f.trips["7-336134207"]["257"]).toBe(1792714536);
    expect(f.alerts.map((a) => a.titre)).toContain(`Arrêt "Barachois" non desservi et reporté`);
    const barachois = f.alerts.find((a) => a.titre.includes("Barachois"))!;
    expect(barachois.lignes).toEqual(["9", "35", "11", "36"]);
    expect(barachois.texte).toMatch(/le 25\/10\/2026 de 14h00 à 19h00/);
    expect(rt.active(barachois, barachois.periodes[0][0]! + 1)).toBe(true);
    expect(rt.active(barachois, barachois.periodes[0][1]! + 1)).toBe(false);
  });

  it("reads where the buses that send their position are, without their plate", () => {
    const f = rt.decode(FEED);
    expect(f.vehicles).toHaveLength(2);
    const [v] = f.vehicles!;
    expect(v).toMatchObject({ trip: "7-218169484", route: "13", stop: "514", status: 2, at: 1792774552 });
    expect(v.lat).toBeCloseTo(-20.88168, 4);
    expect(v.lon).toBeCloseTo(55.45491, 4);
    expect(JSON.stringify(f.vehicles)).not.toMatch(/DQ-032-PH/);
  });

  it("is fetched for the networks that have one, and left out once it stopped", async () => {
    vi.stubGlobal("fetch", async () => new Response(FEED));
    const at = new Date(rt.decode(FEED).at * 1000);
    const fresh = await realtimeFeeds(["carjaune", "citalis"], new Cache(new MemoryStore(), () => at.getTime(), false), at);
    expect([...fresh.keys()]).toEqual(["carjaune"]);
    const later = new Date(at.getTime() + (rt.MAX_AGE_SECONDS + 60) * 1000);
    expect((await realtimeFeeds(["carjaune"], new Cache(new MemoryStore(), () => later.getTime(), false), later)).size).toBe(0);
  });
});

describe("departures in real time", () => {
  it("take the announced time, a skipped stop and a cancelled trip, and come in the order the buses are expected", async () => {
    const list = (await departures(findStops("gare routière Saint-Pierre").groups, NOW)).filter((d) => d.reseau === "carjaune").slice(0, 3);
    expect(list).toHaveLength(3);
    const [late, skipped, cancelled] = list;
    const feed: rt.Realtime = {
      at: T0 - 20,
      trips: {
        // 12 minutes late: now after the two others.
        [late.trip]: { [gtfsStop(late.stop)]: T0 + late.in + 12 * 60 },
        [skipped.trip]: { [gtfsStop(skipped.stop)]: rt.SKIPPED },
      },
      cancelled: [cancelled.trip],
      alerts: [],
    };
    const out = applyRealtime(list, new Map([["carjaune", feed]]), NOW);
    expect(out.map((d) => d.trip)).toEqual([skipped.trip, cancelled.trip, late.trip]);
    const row = departureRow(out[2]);
    expect(row.retard_min).toBe(12);
    expect(row.heure_annoncee).not.toBe(row.heure);
    expect(departureRow(out[0]).temps_reel).toBe("ne passe pas à cet arrêt");
    expect(out[1].supprime).toBe(true);
  });

  it("are given by the tool with the alerts about these lines, and say so", async () => {
    const list = (await departures(findStops("gare routière Saint-Pierre").groups, NOW)).filter((d) => d.reseau === "carjaune");
    const d = list[0];
    const route = cj.temps_reel!.lignes[d.route - cj.first_route];
    const feed: rt.Realtime = {
      at: T0 - 20,
      trips: { [d.trip]: { [gtfsStop(d.stop)]: T0 + d.in + 5 * 60 } },
      cancelled: [],
      alerts: [
        { titre: "Déviation à Saint-Pierre", lignes: [route], arrets: [], periodes: [] },
        { titre: "Travaux ailleurs", lignes: ["autre"], arrets: [], periodes: [] },
        { titre: "Fini", lignes: [route], arrets: [], periodes: [[T0 - 7200, T0 - 3600]] },
      ],
    };
    const r = body(await transports("gare routière Saint-Pierre", undefined, NOW, withFeed(feed)));
    expect(r.resume).toMatch(/\(dans \d+ min, retard de 5 min annoncé en direct\)/);
    expect(r.resume).toMatch(/d'après les annonces en direct des réseaux et les horaires publiés\u00a0: /);
    expect(r.departs.find((x: { retard_min?: number }) => x.retard_min === 5)).toBeTruthy();
    expect(r.info_trafic.map((a: { titre: string }) => a.titre)).toEqual(["Déviation à Saint-Pierre"]);
    expect(r.horaires).toMatch(/^Car Jaune : heures annoncées en direct par le réseau \(flux de \d\d:\d\d\)/);
    expect(JSON.stringify(r.sources)).toMatch(/GTFS-RT/);
    // Early or on time: the participle agrees with the noun before it (marketing).
    // A bus due in 5 minutes at least: 2 minutes early is still to come.
    const e = list.find((x) => x.in >= 5 * 60)!;
    const at = async (late: number) => body(await transports("gare routière Saint-Pierre", undefined, NOW, withFeed({ ...feed, trips: { [e.trip]: { [gtfsStop(e.stop)]: T0 + e.in + late } } }))).resume;
    expect(await at(-2 * 60)).toMatch(/, avance de 2 min annoncée en direct\)/);
    expect(await at(0)).toMatch(/, à l'heure, annoncé en direct\)/);
  });

  it("without a feed, stay the timetables as published", async () => {
    const r = body(await transports("gare routière Saint-Pierre", undefined, NOW));
    expect(r.horaires).toMatch(/^théoriques/);
    expect(r.departs.every((x: { retard_min?: number }) => x.retard_min === undefined)).toBe(true);
  });
});
