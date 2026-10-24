import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { counted } from "../src/budget.js";
import { Cache } from "../src/cache.js";
import * as climat from "../src/providers/climat.js";
import { historiqueMeteo, parseDate, period } from "../src/tools/historique.js";

// Real rows of the archive (scripts/build-climat.py): eight stations, the years 2006, 2025 and 2026 up to 23 October.
const NOW = new Date("2026-10-24T08:00:00Z");
let db: DatabaseSync;

beforeAll(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./fixtures/historique/climat.sql", import.meta.url), "utf8"));
});
afterEach(() => climat.configure(undefined));

function plug() {
  let queries = 0;
  climat.configure({
    all: async <T>(sql: string, ...params: unknown[]) => {
      queries++;
      return db.prepare(sql).all(...(params as (string | number)[])) as T[];
    },
  });
  return () => queries;
}

const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe("the period asked", () => {
  it("reads days, months and years, and ends yesterday", () => {
    expect(parseDate("01/10", false, "2026-10-23")).toBe("2026-10-01");
    expect(parseDate("01/12", false, "2026-10-23")).toBe("2025-12-01");
    expect(parseDate("2026-02", true, "2026-10-23")).toBe("2026-02-28");
    expect(parseDate("2006", false, "2026-10-23")).toBe("2006-01-01");
    expect(period(NOW, 14)).toEqual({ du: "2026-10-10", au: "2026-10-23" });
    expect(period(NOW, undefined, "2026-10")).toEqual({ du: "2026-10-01", au: "2026-10-23" });
    expect(period(NOW, undefined, "2026-10-24")).toHaveProperty("erreur");
    expect(period(NOW, undefined, "1950", "2000")).toHaveProperty("erreur");
  });
});

describe("historique_meteo", () => {
  it("says it is not there without the archive", async () => {
    const r = await historiqueMeteo(new Cache(), "Cilaos", {}, NOW);
    expect(r.isError).toBe(true);
  });

  it("takes rain, temperatures and sunshine from the best station for each, day by day", async () => {
    const queries = plug();
    const a = json(await historiqueMeteo(new Cache(), "Ravine des Cabris", { jours: 14 }, NOW));
    expect(a.periode).toEqual({ du: "10/10/2026", au: "23/10/2026", jours: 14 });
    expect(a.stations.map((s: { station: string; mesure: string }) => [s.station, s.mesure])).toEqual([
      ["Saint-Pierre Pierrefonds (aéroport)", "pluie, températures et rafales"],
      ["Pont-Mathurin", "ensoleillement"],
    ]);
    expect(a.jours).toHaveLength(14);
    expect(a.jours[13]).toEqual({ date: "23/10/2026", pluie_mm: 0, tmin: 21.4, tmax: 28.6, soleil_h: 7.4, soleil_pct: 59, rafale_max_kmh: 44 });
    expect(a.pluie).toMatchObject({ total_mm: 1, jours_de_pluie: 1, normale_mm: 8 });
    expect(a.temperatures).toMatchObject({ maximales_moyenne: 28, maximales_normale: 27.6 });
    expect(a.ensoleillement).toMatchObject({ jours_gris: 2, jours_mesures: 14 });
    expect(a.resume).toMatch(/^La Ravine des Cabris, du 10\/10\/2026 au 23\/10\/2026 : 1 mm de pluie/);
    // Its records since 1999, the years after the stored ones included.
    expect(a.records.rafale_max_kmh).toEqual({ valeur: 180, date: "22/01/2002" });
    expect(a.records.par_mois[0].mois).toBe("octobre");
    expect(a.nature).toBe("mesure");
    expect(queries()).toBeLessThanOrEqual(4);
  });

  it("answers for one day, years back", async () => {
    plug();
    const a = json(await historiqueMeteo(new Cache(), "Sainte-Marie", { du: "24/10/2006" }, NOW));
    expect(a.jours).toEqual([{ date: "24/10/2006", pluie_mm: 0.6, tmin: 21.4, tmax: 27.3, soleil_h: 7.8, soleil_pct: 62, rafale_max_kmh: 40 }]);
    expect(a.resume).toMatch(/le 24\/10\/2006 : 0,6 mm de pluie à Saint-Denis Gillot \(aéroport\) ; minimale 21,4 °C, maximale 27,3 °C/);
  });

  it("goes month by month over a longer period, each against its normal", async () => {
    plug();
    const a = json(await historiqueMeteo(new Cache(), "Cilaos", { du: "2025-01", au: "2026-09" }, NOW));
    expect(a.jours).toBeUndefined();
    expect(a.mois).toHaveLength(21);
    expect(a.mois[0]).toMatchObject({ mois: "janvier 2025" });
    expect(a.mois[0].pluie_normale_mm).toBeGreaterThan(100);
  });

  it("tours the island's climates without a place, in one read", async () => {
    const queries = plug();
    const { value } = await counted(50, async () => json(await historiqueMeteo(new Cache(), undefined, {}, NOW)));
    expect(value.stations.map((s: { zone: string }) => s.zone)).toEqual([
      "nord (Saint-Denis)", "ouest (côte sous le vent)", "sud (Saint-Pierre)", "est (au vent)", "Hauts (Plaine des Cafres)", "cirque de Cilaos",
    ]);
    expect(value.stations[0].pluie).toMatchObject({ total_mm: 16.8, normale_mm: 43, rapport_a_la_normale: "39 %" });
    expect(value.resume).toMatch(/^La Réunion du 24\/09\/2026 au 23\/10\/2026/);
    expect(queries()).toBe(2);
  });
});

describe("historique_meteo, hour by hour", () => {
  // Real rows of the hourly archive (scripts/build-climat-h.py): Cilaos, Gillot and Plaine des Palmistes, October 2026 up to the 24th at 8 h.
  let hdb: DatabaseSync;
  beforeAll(() => {
    hdb = new DatabaseSync(":memory:");
    hdb.exec(readFileSync(new URL("./fixtures/historique/climat-h.sql", import.meta.url), "utf8"));
  });
  const both = () => {
    let queries = 0;
    const of = (d: DatabaseSync) => ({
      all: async <T>(sql: string, ...params: unknown[]) => {
        queries++;
        return d.prepare(sql).all(...(params as (string | number)[])) as T[];
      },
    });
    climat.configure(of(db), of(hdb));
    return () => queries;
  };

  it("says yesterday hour by hour: when the sun shone, the coldest and warmest hours, the strongest gust", async () => {
    both();
    const a = json(await historiqueMeteo(new Cache(), "Cilaos", { du: "2026-10-23" }, NOW));
    expect(a.resume).toContain("Heure par heure (Cilaos) — 23/10 : pas de pluie ; soleil entre 8 h et 14 h ; 10,8 °C à 5 h, 25,8 °C à 12 h ; rafale max 27 km/h vers 13 h");
    expect(a.heure_par_heure.heures).toHaveLength(24);
    expect(a.heure_par_heure.heures[12]).toMatchObject({ heure: "23/10 12 h", temperature: 25.8, soleil_min: 56, vent_de: "SO" });
    expect(a.heure_par_heure.par_jour[0]).toMatchObject({ pluie_mm: 0, heures_ensoleillees: 6, tmax: { valeur: 25.8, heure: "12 h" } });
    expect(a.sources.map((x: { source: string }) => x.source).join()).toMatch(/horaires/);
  });

  it("names the rainy hours, each value being the hour that ends then", async () => {
    both();
    const a = json(await historiqueMeteo(new Cache(), "Plaine des Palmistes", { du: "2026-10-21" }, NOW));
    expect(a.resume).toContain("pluie entre 1 h et 2 h, entre 12 h et 15 h, entre 16 h et 18 h, entre 21 h et 22 h (4,4 mm, dont 1,8 mm en une heure, entre 14 h et 15 h)");
    expect(a.heure_par_heure.par_jour[0].heures_de_pluie).toContain("15 h : 1,8 mm");
  });

  it("gives last night, today up to the last hour published", async () => {
    both();
    const a = json(await historiqueMeteo(new Cache(), "Sainte-Marie", { du: "2026-10-24" }, NOW));
    expect(a.erreur).toBeUndefined();
    expect(a.heure_par_heure.stations[0].station).toBe("Saint-Denis Gillot (aéroport)");
    expect(a.heure_par_heure.heures.at(-1).heure).toBe("24/10 8 h");
    expect(a.resume).toMatch(/aujourd'hui, publié jusqu'à 8 h/);
  });

  it("leaves the hours out over a longer period, or when asked by day", async () => {
    both();
    const long = json(await historiqueMeteo(new Cache(), "Cilaos", { jours: 14 }, NOW));
    expect(long.heure_par_heure).toBeUndefined();
    const forced = json(await historiqueMeteo(new Cache(), "Cilaos", { du: "2026-10-17", au: "2026-10-23", detail: "heure" }, NOW));
    expect(forced.heure_par_heure.heures).toHaveLength(7 * 24);
    const daily = json(await historiqueMeteo(new Cache(), "Cilaos", { du: "2026-10-23", detail: "jour" }, NOW));
    expect(daily.heure_par_heure).toBeUndefined();
  });

  it("stays within a few queries", async () => {
    const queries = both();
    await counted(50, async () => historiqueMeteo(new Cache(), "Cilaos", { du: "2026-10-22", au: "2026-10-23" }, NOW));
    // Daily: stations, years, records and the year after them; hourly: stations, months.
    expect(queries()).toBe(6);
  });
});

describe("station names", () => {
  it("are written as people write them", () => {
    expect(climat.stationName("97418110", "GILLOT-AEROPORT")).toBe("Saint-Denis Gillot (aéroport)");
    expect(climat.stationName("x", "PLAINE DES CAFRES")).toBe("Plaine des Cafres");
    expect(climat.stationName("x", "ST-LEU")).toBe("Saint-Leu");
    expect(climat.stationName("x", "ILET A VIDOT")).toBe("Ilet à Vidot");
  });
});
