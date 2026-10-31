import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as transit from "../src/providers/transit.js";
import type * as rt from "../src/providers/gtfsrt.js";
import { Cache, MemoryStore } from "../src/cache.js";
import { departures, findStops, linesNamed, parseQuery, stationDepartures, transports } from "../src/tools/transports.js";

// Rows of the D1 database for the stations of Saint-Pierre, the cable car at Bancoul and Hell-Bourg, from the
// networks' GTFS of 23/10/2026 (scripts/build-transit.py).
// By feed, as scripts/build-transit.py writes them to the database.
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
    expect(r.resume).toMatch(/^Prochains départs à Gare de St-Pierre \(Saint-Pierre, Car Jaune\).*, d'après (les annonces en direct des réseaux et )?les horaires publiés\u00a0: /);
    expect(r.departs.length).toBeGreaterThan(5);
    expect(r.departs[0].dans_min).toBeLessThanOrEqual(r.departs[1].dans_min);
    expect(new Set(r.departs.map((d: { reseau: string }) => d.reseau)).size).toBeGreaterThan(1);
    expect(r.horaires).toMatch(/^théoriques/);
    expect(r.sources[0].licence).toBe("Licence Ouverte Etalab 2.0");
    // Where each bus comes from and goes, from the bundle: no row more is read for it.
    expect(r.departs.every((d: { origine?: string; terminus?: string }) => d.origine && d.terminus)).toBe(true);
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
    expect(mer.map((d: { heure: string }) => d.heure)).toEqual(["07:29", "07:30", "07:31"]);
  });

  it("looks further ahead in a cirque where buses are rare", async () => {
    const r = body(await transports("Hell-Bourg", undefined, NOW));
    expect(r.arrets[0].commune).toBe("Salazie");
    expect(r.departs.length).toBeGreaterThan(2);
  });

  it("gives the next morning's buses after the last one of the evening", async () => {
    // Friday 23/10/2026, 18h30: no more buses at Hell-Bourg until Saturday.
    const r = body(await transports("Hell-Bourg", undefined, new Date("2026-10-23T14:30:00Z")));
    expect(r.departs[0].heure).toBe("demain 05:51");
    expect(r.departs[0].dans_min).toBeGreaterThan(11 * 60);
    expect(r.resume).toMatch(/vers GARE SAINT ANDRE demain à 05:51 \(dans 11 h \d\d\)/);
  });

  it("reads only the patterns that may stop at the station in the next hours", async () => {
    const asked: number[] = [];
    transit.configure({
      all: async <T>(sql: string, keys: unknown) => {
        if (/FROM patterns/.test(sql)) asked.push((JSON.parse(String(keys)) as unknown[]).length);
        return fake.all<T>(sql, keys);
      },
    });
    const r = body(await transports("gare routière Saint-Pierre", undefined, NOW));
    const passing = Object.values(rows).reduce((n, f) => n + (f.patterns?.length ?? 0), 0);
    // 578 patterns pass at the station; on a Friday at 7h30, 65 of them may stop there in the next three hours.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBeLessThan(passing / 4);
    expect(r.departs.length).toBeGreaterThan(5);
  });

  it("tells a pattern that may stop in the hours asked from one that cannot", () => {
    // The cable car of Bancoul: one pattern a way, a cabin a minute from morning to evening, every day.
    const p = transit.NETWORKS.papang.first_pattern;
    const friday = [20261023, 4] as const;
    expect(transit.mayRun(p, 0, "papang", ...friday, 9 * 3600, 12 * 3600)).toBe(true);
    // Not at 3 in the morning, nor on a day out of its calendar.
    expect(transit.mayRun(p, 0, "papang", ...friday, 3 * 3600, 4 * 3600)).toBe(false);
    expect(transit.mayRun(p, 0, "papang", 20300101, 1, 9 * 3600, 12 * 3600)).toBe(false);
    // A pattern the bundle does not know is read, as before.
    expect(transit.mayRun(1e9, 0, "papang", ...friday, 3 * 3600, 4 * 3600)).toBe(true);
  });

  it("says when it cannot answer outside the Worker", async () => {
    transit.configure(undefined);
    const r = await transports("gare routière Saint-Pierre", undefined, NOW);
    expect(r.isError).toBe(true);
  });
});

describe("several bus stations at once", () => {
  it("gives each the departures it would have alone, from three reads of the timetables at most in all", async () => {
    const stations = ["gare routière Saint-Pierre", "gare routière du Tampon, CarSud", "Manapany les Bains", "Hell-Bourg"].map((q) => findStops(q).groups);
    // The morning, and the night, when stations with fewer than 3 departures in 3 hours look 20 hours ahead.
    for (const [at, further] of [[NOW, false], [new Date("2026-10-23T20:30:00Z"), true]] as const) {
      const alone: Awaited<ReturnType<typeof departures>>[] = [];
      const horizons: number[] = [];
      let looked = false;
      for (const groups of stations) {
        const soon = await departures(groups, at);
        looked ||= soon.length < 3;
        alone.push(soon.length < 3 ? await departures(groups, at, 20 * 3600) : soon);
        horizons.push(soon.length < 3 ? 20 * 3600 : 3 * 3600);
      }
      if (further) expect(looked).toBe(true);
      let reads = 0;
      transit.configure({ all: <T>(sql: string, ...params: unknown[]) => (reads++, fake.all<T>(sql, ...params)) });
      const both = await stationDepartures(stations, at);
      expect(both.map((l) => l.departs)).toEqual(alone);
      // How far each looked: 20 hours where 3 gave fewer than 3 departures.
      expect(both.map((l) => l.horizon)).toEqual(horizons);
      expect(reads).toBeLessThanOrEqual(looked ? 3 : 2);
      transit.configure(fake);
      // Not a comparison of empty lists: the fixture has the timetables of three of them.
      expect(alone.filter((l) => l.length).length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("a line", () => {
  type Sens = { direction: string; nombre_arrets?: number; arrets?: string[] | string; departs_du_jour: { nombre: number; premier?: string; par_tranche?: unknown[] }; departs_apres_l_heure_demandee?: string[] };

  it("is found by its name, in the network named with it", () => {
    const [s1] = linesNamed("S1", "carjaune");
    expect(transit.ROUTES[s1]).toEqual(["carjaune", "S1", "St-Benoît / St-Pierre par le Grand Brûlé"]);
    expect(linesNamed("ligne S1 car jaune")).toEqual([s1]);
    expect(linesNamed("Z9Z")).toEqual([]);
  });

  it("alone, gives its stops in order for each direction and its day's departures in a few figures", async () => {
    const r = body(await transports(undefined, "S1", NOW));
    expect(r.resume).toMatch(/^Ligne S1 \(St-Benoît \/ St-Pierre par le Grand Brûlé\), Car Jaune, d'après les horaires publiés : Gare de St-Benoît → Gare de St-Pierre, 31 arrêts, \d+ départs aujourd'hui, de (\d\d:\d\d|\d+\u00a0h) à (\d\d:\d\d|\d+\u00a0h)/);
    const sens = r.sens as Sens[];
    expect(sens).toHaveLength(2);
    expect(sens[0].arrets).toContain("Saint-Joseph : Église Vincendo, Centre Multiservices, Gare de St-Joseph, Lycée Agricole, Manapany les Bains");
    // The way back by the same stops is said, not listed again.
    expect(sens[1].arrets).toBe("les mêmes arrêts, dans l'ordre inverse");
    expect(sens[0].departs_du_jour.nombre).toBeGreaterThan(3);
    expect(sens[0].departs_du_jour.par_tranche!.length).toBeGreaterThan(0);
    // No departure one by one unless an hour is asked.
    expect(r.departs).toBeUndefined();
    expect(sens[0].departs_apres_l_heure_demandee).toBeUndefined();
    expect(r.detail).toMatch(/redemander avec l'heure/);
    expect(JSON.stringify(r).length).toBeLessThan(6000);
  });

  it("at a place it serves, says so and gives its next departures there, with where each bus comes from", async () => {
    const r = body(await transports("Manapany", "S1", NOW));
    expect(r.arret).toMatchObject({ arret: "Manapany les Bains", commune: "Saint-Joseph", dessert_le_lieu_demande: true });
    expect(r.resume).toMatch(/Elle s'arrête à Manapany les Bains \(Saint-Joseph\)/);
    expect(r.departs.length).toBeGreaterThan(0);
    expect(r.departs.every((d: { ligne: string; origine: string; terminus: string }) => d.ligne === "S1" && /Gare de St-(Benoît|Pierre)/.test(d.origine) && d.terminus)).toBe(true);
  });

  it("at a place it does not serve, gives its nearest stop and how far", async () => {
    const r = body(await transports("Manapany", "S2 car jaune", NOW));
    expect(r.arret.dessert_le_lieu_demande).toBe(false);
    expect(r.arret.distance_du_lieu_demande).toMatch(/km$/);
    expect(r.resume).toMatch(/Elle ne passe pas à « Manapany » : son arrêt le plus proche est .+, à [\d,]+ km\./);
  });

  it("gives its departures one by one after the hour asked", async () => {
    const r = body(await transports("après 17h", "S1", NOW));
    const times = (r.sens as Sens[])[0].departs_apres_l_heure_demandee!;
    expect(times.length).toBeGreaterThan(0);
    expect(times.every((t) => Number(t.split(/[:\u00a0]/)[0]) >= 17)).toBe(true);
    expect(r.arret).toBeUndefined();
  });

  it("says when it does not run, what the timetables say beside it, and gives its next day of service", async () => {
    // Sunday 25/10/2026: the E1 runs on weekdays only.
    const sunday = body(await transports(undefined, "E1", new Date("2026-10-25T03:30:00Z")));
    expect(sunday.resume).toMatch(/^Ligne E1 \(St-Denis \/ St-Benoît, Car Jaune\)\u00a0: aucun départ aujourd'hui, dimanche 25 octobre\. D'après les horaires publiés, elle ne circule pas le dimanche\. Prochaine journée de service, lundi 26 octobre\u00a0: [^;]+, \d+ arrêts, \d+ départs de (\d\d:\d\d|\d+\u00a0h) à (\d\d:\d\d|\d+\u00a0h)\u00a0; /);
    expect(sunday.resume).not.toMatch(/le lundi 26 octobre|aujourd'hui,? de/);
    expect(sunday.jour).toBe("lundi 26 octobre");
    // Wednesday 11/11/2026, a public holiday, by the State's calendar when it is at hand: its name, never its date again.
    const WED = new Date("2026-11-11T03:30:00Z");
    const feries = (name: string) => ({ get: async () => ({ value: { "2026-11-11": name }, fetchedAt: new Date() }) }) as unknown as Cache;
    expect(body(await transports(undefined, "E1", WED, feries("Armistice 1918"))).resume)
      .toMatch(/^Ligne E1 \(St-Denis \/ St-Benoît, Car Jaune\)\u00a0: aucun départ aujourd'hui, mercredi 11 novembre, jour férié \(Armistice 1918\), d'après les horaires publiés\. Prochaine journée de service, jeudi 12 novembre\u00a0: /);
    expect(body(await transports(undefined, "E1", WED, feries("11 novembre"))).resume)
      .toMatch(/^Ligne E1 \(St-Denis \/ St-Benoît, Car Jaune\)\u00a0: aucun départ aujourd'hui, mercredi 11 novembre, jour férié, d'après les horaires publiés\. Prochaine/);
    // Without the calendar: a Wednesday its network's calendar leaves out, while it runs on the other Wednesdays.
    const unknown = body(await transports(undefined, "E1", WED));
    expect(unknown.resume).toMatch(/^Ligne E1 \(St-Denis \/ St-Benoît, Car Jaune\)\u00a0: aucun départ aujourd'hui, mercredi 11 novembre, d'après les horaires publiés, alors qu'elle circule le mercredi les autres semaines\. Les horaires ne disent pas pourquoi\u00a0: voir l'info trafic du réseau\. Prochaine journée de service, jeudi 12 novembre\u00a0: /);
    // The network's live alert about the line, when its feed has one, with the feed's time.
    const cj = transit.NETWORKS.carjaune;
    const [e1] = linesNamed("E1", "carjaune");
    const store = new MemoryStore();
    store.put("calendrier:feries:2026", { value: {}, fetchedAt: WED.getTime() });
    const alert = { titre: "Grève : lignes E1 et S2 non assurées", lignes: [cj.temps_reel!.lignes[e1 - cj.first_route]], arrets: [], periodes: [[null, null]] };
    store.put("rt:carjaune", { value: { at: WED.getTime() / 1000 - 30, trips: {}, cancelled: [], alerts: [alert], vehicles: [] }, fetchedAt: WED.getTime() });
    const told = body(await transports(undefined, "E1", WED, new Cache(store, () => WED.getTime(), false)));
    expect(told.resume).toMatch(/alors qu'elle circule le mercredi les autres semaines\. Info trafic de Car Jaune \(flux de 07:29\)\u00a0: «\u00a0Grève : lignes E1 et S2 non assurées\u00a0»\. Prochaine journée de service, jeudi 12 novembre\u00a0: /);
    expect(told.info_trafic).toEqual([{ reseau: "Car Jaune", lignes: ["E1"], titre: alert.titre }]);
  });

  it("at a stop with nothing running today, says so for all its lines, and what the timetables say beside it", async () => {
    // A stop served by the E1 alone: its first stop, with the passes of the E1's patterns only.
    const cj = transit.NETWORKS.carjaune;
    const [e1] = linesNamed("E1", "carjaune");
    const pats = transit.patternsOf(e1);
    const g = transit.GROUPS.find((x) => x.reseau === "carjaune" && x.ids.includes(transit.ENDS[pats[0]][1]))!;
    transit.configure({
      all: async <T>(sql: string, keys: unknown) => /FROM passes/.test(sql)
        ? g.ids.map((id) => ({ feed: cj.feed, id: id - cj.first_stop, passes: JSON.stringify(pats.map((p) => [p - cj.first_pattern, 0])) })) as T[]
        : fake.all<T>(sql, keys),
    });
    const asked = `${g.nom} car jaune`;
    const where = `${g.nom} \\(${g.commune}, Car Jaune\\)`;
    const sunday = body(await transports(asked, undefined, new Date("2026-10-25T06:00:00Z")));
    expect(sunday.resume).toMatch(new RegExp(`^Arrêt ${where}\u00a0: aucun départ aujourd'hui, dimanche 25 octobre\\. D'après les horaires publiés, aucune des lignes qui le desservent ne circule le dimanche\\. Prochains départs\u00a0: E1 vers St-(Denis|Benoît) demain à 5\u00a0h \\(dans 19 h\\)\u00a0; `));
    const WED = new Date("2026-11-11T06:00:00Z");
    const feries = { get: async () => ({ value: { "2026-11-11": "11 novembre" }, fetchedAt: new Date() }) } as unknown as Cache;
    expect(body(await transports(asked, undefined, WED, feries)).resume)
      .toMatch(new RegExp(`^Arrêt ${where}\u00a0: aucun départ aujourd'hui, mercredi 11 novembre, jour férié, d'après les horaires publiés\\. Prochains départs\u00a0: E1 `));
    expect(body(await transports(asked, undefined, WED)).resume)
      .toMatch(new RegExp(`^Arrêt ${where}\u00a0: aucun départ aujourd'hui, mercredi 11 novembre, d'après les horaires publiés\\. Prochains départs\u00a0: E1 `));
    // With the network's live alerts about its lines, quoted, two of them.
    const store = new MemoryStore();
    store.put("calendrier:feries:2026", { value: {}, fetchedAt: WED.getTime() });
    const line = cj.temps_reel!.lignes[e1 - cj.first_route];
    const alerts = [{ titre: "Grève : lignes E1 et S2 non assurées.", lignes: [line], arrets: [], periodes: [] }, { titre: "Travaux à Sainte-Suzanne", lignes: [line], arrets: [], periodes: [] }];
    store.put("rt:carjaune", { value: { at: WED.getTime() / 1000 - 30, trips: {}, cancelled: [], alerts, vehicles: [] }, fetchedAt: WED.getTime() });
    const told = body(await transports(asked, undefined, WED, new Cache(store, () => WED.getTime(), false)));
    expect(told.resume).toMatch(new RegExp(`^Arrêt ${where}\u00a0: aucun départ aujourd'hui, mercredi 11 novembre, d'après les horaires publiés\\. Info trafic de Car Jaune \\(flux de 09:59\\)\u00a0: «\u00a0Grève : lignes E1 et S2 non assurées\u00a0»\u00a0; «\u00a0Travaux à Sainte-Suzanne\u00a0»\\. Prochains départs\u00a0: [^.]+\\.$`));
    expect(told.info_trafic).toHaveLength(2);
  });

  it("gives line and stop names with single spaces, as some feeds have two", () => {
    expect(transit.ROUTES.some(([, s, l]) => /\s{2}/.test(s + l))).toBe(false);
    expect(transit.ROUTES.some(([net, s, l]) => net === "carsud" && s === "STD" && l === "Pointe Tremblet -Langevin - Gare St Joseph")).toBe(true);
    expect(transit.GROUPS.some((g) => /\s{2}/.test(g.nom))).toBe(false);
  });

  it("without its stops in the database, gives its termini and its hours, and says the list is missing", async () => {
    transit.configure({
      all: async <T>(sql: string, keys: unknown) => {
        if (/pattern_stops/.test(sql)) throw new Error("D1_ERROR: no such table: pattern_stops: SQLITE_ERROR");
        return fake.all<T>(sql, keys);
      },
    });
    const r = body(await transports("Manapany", "S1", NOW));
    expect(r.resume).toMatch(/La liste de ses arrêts n'est pas disponible pour le moment\./);
    expect(r.note).toMatch(/Liste des arrêts indisponible/);
    expect((r.sens as Sens[])[0]).not.toHaveProperty("arrets");
    expect((r.sens as Sens[])[0].departs_du_jour.nombre).toBeGreaterThan(3);
    expect(r.erreur).toBeUndefined();
  });

  it("asks which network when several have a line of that name", async () => {
    const r = body(await transports(undefined, "1", NOW));
    expect(r.resume).toMatch(/^Plusieurs réseaux ont une ligne « 1 »/);
  });
});

describe("where the bus is", () => {
  const T0 = NOW.getTime() / 1000;
  const cj = transit.NETWORKS.carjaune;
  const gtfsStop = (nom: string) => cj.temps_reel!.arrets[transit.GROUPS.find((g) => g.reseau === "carjaune" && g.nom === nom)!.ids[0] - cj.first_stop];
  const [s1] = linesNamed("S1", "carjaune");
  /** A cache already holding this Car Jaune feed, as read a moment ago. */
  const withFeed = (vehicles: rt.Vehicle[]) => {
    const store = new MemoryStore();
    store.put("rt:carjaune", { value: { at: T0 - 30, trips: {}, cancelled: [], alerts: [], vehicles }, fetchedAt: NOW.getTime() });
    return new Cache(store, () => NOW.getTime(), false);
  };
  /** The next S1 at Manapany les Bains, whose bus is on its way. */
  const nextS1 = async () => (await departures(findStops("Manapany les Bains").groups, NOW)).filter((d) => d.route === s1)[0];

  beforeEach(() => vi.stubGlobal("fetch", async () => new Response("down", { status: 503 })));
  afterEach(() => vi.unstubAllGlobals());

  it("is given with a departure and with the line, always with the time of its position", async () => {
    const d = await nextS1();
    const at = transit.stop(transit.GROUPS.find((g) => g.reseau === "carjaune" && g.nom === "Église Vincendo")!.ids[0]);
    const cache = withFeed([{ trip: d.trip, route: cj.temps_reel!.lignes[s1 - cj.first_route], lat: at.lat, lon: at.lon, at: T0 - 90, stop: gtfsStop("Église Vincendo"), status: 2 }]);
    const r = body(await transports("Manapany", "S1", NOW, cache));
    const row = r.departs.find((x: { position_du_bus?: unknown }) => x.position_du_bus);
    expect(row.position_du_bus).toMatchObject({ ou: "en route vers Église Vincendo (Saint-Joseph)", heure_de_la_position: "07:28" });
    expect(r.resume).toMatch(/position du bus à 07:28 : en route vers Église Vincendo \(Saint-Joseph\)/);
    expect(r.bus_en_circulation).toHaveLength(1);
    expect(r.bus_en_circulation[0].vers).toMatch(/^Gare de St-(Benoît|Pierre)$/);
    expect(r.resume).toMatch(/En ce moment, 1 bus de la ligne donne sa position : vers Gare de St-(Benoît|Pierre), en route vers Église Vincendo \(Saint-Joseph\) à 07:28\./);
    expect(JSON.stringify(r.sources)).toMatch(/GTFS-RT/);
  });

  it("naming no stop, is said near the nearest one", async () => {
    const d = await nextS1();
    const at = transit.stop(transit.GROUPS.find((g) => g.reseau === "carjaune" && g.nom === "Manapany les Bains")!.ids[0]);
    const r = body(await transports(undefined, "S1", NOW, withFeed([{ trip: d.trip, lat: at.lat + 0.001, lon: at.lon, at: T0 - 60 }])));
    expect(r.bus_en_circulation[0]).toMatchObject({ ou: "près de Manapany les Bains (Saint-Joseph)", heure_de_la_position: "07:29" });
  });

  it("is not given when its position is more than 10 minutes old", async () => {
    const d = await nextS1();
    const cache = withFeed([{ trip: d.trip, lat: -21.37, lon: 55.6, at: T0 - 11 * 60, stop: gtfsStop("Église Vincendo"), status: 2 }]);
    const r = body(await transports("Manapany", "S1", NOW, cache));
    expect(r.departs.some((x: { position_du_bus?: unknown }) => x.position_du_bus)).toBe(false);
    expect(r.bus_en_circulation).toBeUndefined();
    expect(r.resume).toMatch(/Aucun bus de la ligne ne donne sa position en ce moment, ce qui ne veut pas dire qu'aucun ne circule\./);
  });
});
