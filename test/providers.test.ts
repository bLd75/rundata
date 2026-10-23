import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { humidity, parseMetar, presentWeather, type MetarJson } from "../src/providers/metar.js";
import { inReunionBeacons, parse as parsePioupiou, type PioupiouJson } from "../src/providers/pioupiou.js";
import { nearest, parseCsv } from "../src/providers/acspo.js";
import { observation as mfObservation, parseCsv as mfParse } from "../src/providers/meteofrance.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

describe("metar", () => {
  const obs = parseMetar(JSON.parse(fixture("metar.json")) as MetarJson[]);

  it("keeps the latest report of each airport", () => {
    expect(obs.map((o) => o.station.id).sort()).toEqual(["FMEE", "FMEP"]);
    const gillot = obs.find((o) => o.station.id === "FMEE")!;
    expect(gillot.time.toISOString()).toBe("2026-10-18T19:00:00.000Z");
    expect(gillot.brut).toBe("METAR FMEE 181900Z AUTO 13009KT CAVOK 22/16 Q1022 NOSIG");
  });

  it("converts units and flags computed values", () => {
    const r = Object.fromEntries(obs.find((o) => o.station.id === "FMEE")!.readings.map((x) => [x.variable, x]));
    expect(r.temperature.valeur).toBe(22);
    expect(r.vent_moyen.valeur).toBe(17); // 9 kt
    expect(r.vent_direction.valeur).toBe(130);
    expect(r.humidite).toMatchObject({ valeur: 69, nature: "derive" });
    expect(r.ciel.valeur).toBe("dégagé");
  });

  it("reports variable wind", () => {
    const r = obs.find((o) => o.station.id === "FMEP")!.readings.find((x) => x.variable === "vent_direction")!;
    expect(r.valeur).toBe("variable");
  });

  it("computes humidity", () => {
    expect(humidity(25, 25)).toBe(100);
    expect(humidity(30, 20)).toBe(55);
  });

  it("decodes present weather", () => {
    expect(presentWeather("-SHRA BR")).toBe("averses faible, brume");
    expect(presentWeather("+TSRA")).toBe("orage avec pluie fort");
  });
});

describe("pioupiou", () => {
  const all = JSON.parse(fixture("pioupiou_all.json")).data as PioupiouJson[];

  it("finds the beacons in Réunion", () => {
    expect(inReunionBeacons(all).map((p) => p.id)).toEqual([1300]);
  });

  it("drops silent beacons", () => {
    const p = all.find((x) => x.id === 1300)!;
    const t = new Date(p.measurements.date!);
    expect(parsePioupiou(p, new Date(t.getTime() + 10 * 60_000))?.readings[0]).toMatchObject({ variable: "vent_moyen" });
    expect(parsePioupiou(p, new Date(t.getTime() + 3 * 3600_000))).toBeNull();
  });
});

describe("acspo", () => {
  const days = parseCsv(fixture("acspo.csv"));

  it("parses pixels by day", () => {
    expect(days[0].date).toBe("2026-10-16");
    expect(days[0].pixels.length).toBeGreaterThan(10);
  });

  it("finds the nearest clear water", () => {
    const m = nearest(days, 55.2265, -21.0743)!; // plage de l'Ermitage
    expect(m.valeur).toBeGreaterThan(24);
    expect(m.valeur).toBeLessThan(26);
    expect(m.distance_km).toBeLessThan(6);
  });

  it("says nothing when the sea is too far", () => {
    expect(nearest(days, 55.47, -21.135)).toBeNull(); // Cilaos
  });
});

describe("meteofrance", () => {
  const rows = mfParse(fixture("meteofrance_6min.csv"));

  it("keeps the Réunion rows of a slot", () => {
    expect(rows).toHaveLength(56);
    expect(rows.every((r) => r.id.startsWith("974"))).toBe(true);
    const france = "lat;lon;geo_id_insee;validity_time;t\n46.2;5.6;01014002;2026-10-22T05:18:00Z;277.05\n";
    expect(mfParse(france)).toEqual([]);
  });

  it("converts Kelvin, m/s and Pa, and names the station", () => {
    const o = mfObservation(rows.find((r) => r.id === "97418110")!, 0)!;
    expect(o.station).toMatchObject({ nom: "Saint-Denis Gillot (aéroport)", altitude_m: 8 });
    expect(o.time.toISOString()).toBe("2026-10-22T05:18:00.000Z");
    const r = Object.fromEntries(o.readings.map((x) => [x.variable, x.valeur]));
    expect(r).toMatchObject({ temperature: 27.9, humidite: 64, vent_moyen: 18, rafales: 21, vent_direction: 70, pluie_6min: 0, pluie_1h: 0, pression_mer: 1020.1 });
  });

  it("leaves out what a station does not measure", () => {
    const o = mfObservation(rows.find((r) => r.id === "97424410")!, null)!;
    expect(o.station.nom).toBe("Cilaos");
    expect(o.readings.map((x) => x.variable)).toEqual(["temperature", "vent_moyen", "vent_direction", "rafales", "pluie_6min"]);
  });
});
