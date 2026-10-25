import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { humidity, parseMetar, presentWeather, type MetarJson } from "../src/providers/metar.js";
import { inReunionBeacons, parse as parsePioupiou, type PioupiouJson } from "../src/providers/pioupiou.js";
import { dayUrl, grid, nearest, parseAscii } from "../src/providers/acspo.js";
import { Cache, MemoryStore } from "../src/cache.js";
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
  const days = [parseAscii(fixture("acspo.ascii"), "2026-10-23")];

  it("keeps the best-quality pixels of the day, in °C", () => {
    expect(days[0].pixels.length).toBeGreaterThan(10);
    expect(days[0].pixels[0]).toEqual([55.15, -20.79, 25.15]);
  });

  it("asks the island's box of the day's file", () => {
    const url = dayUrl("2026-10-23");
    expect(url).toContain("/2026/296/20261023120000-STAR-L3S_GHRSST-SSTsubskin-LEO_Daily-ACSPO_V2.81");
    expect(url).toContain("sea_surface_temperature%5B0%5D%5B5539:5572%5D%5B11757:11795%5D");
    expect(dayUrl("2026-01-01")).toContain("/2026/001/20260101");
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

describe("acspo's grid", () => {
  const ascii = fixture("acspo.ascii");
  // The same file with no temperature: a day of clouds over the island.
  const cloudy = ascii.replace(/(sea_surface_temperature\.sea_surface_temperature\[[^\n]*\n)([^]*?\n)\n/, (_, head: string, rows: string) => head + rows.replace(/, -?\d+/g, ", -32768") + "\n");
  // 25 October 2026 at 12:09 UTC: the files of the 21st to the 24th are on the server, the 24th since 03:42.
  const NOON = Date.parse("2026-10-25T12:09:00Z");
  const MIN = 60_000;
  afterEach(() => vi.unstubAllGlobals());

  /** The server, with the days that take too long or are not published, and those clouded over; the days asked. */
  function server(late: string[] = [], unpublished: string[] = [], clouded: string[] = []) {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const day = /\/(\d{8})120000-/.exec(String(url))![1];
      asked.push(day);
      if (late.includes(day)) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      if (unpublished.includes(day)) return new Response("not found", { status: 404 });
      return new Response(clouded.includes(day) ? cloudy : ascii);
    });
    return asked;
  }

  it("keeps a grid with the day due for three hours", async () => {
    const asked = server();
    let now = NOON;
    const cache = new Cache(new MemoryStore(), () => now);
    expect((await grid(cache, new Date(now))).value.map((d) => d.date)).toEqual(["2026-10-24", "2026-10-23", "2026-10-22", "2026-10-21"]);
    now += 2 * 60 * MIN;
    await grid(cache, new Date(now));
    expect(asked).toHaveLength(4);
    now += 61 * MIN;
    await grid(cache, new Date(now));
    expect(asked).toHaveLength(8);
  });

  it("asks again after half an hour a grid without the day due, and says which day is missing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    server(["20261024", "20261023"]);
    let now = NOON;
    const cache = new Cache(new MemoryStore(), () => now);
    expect((await grid(cache, new Date(now))).value[0].date).toBe("2026-10-22");
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual(["source acspo : jour 2026-10-24 manquant:", "source acspo : jour 2026-10-23 manquant:"]);
    const asked = server();
    now += 20 * MIN;
    expect((await grid(cache, new Date(now))).value[0].date).toBe("2026-10-22");
    expect(asked).toEqual([]);
    now += 11 * MIN;
    expect((await grid(cache, new Date(now))).value[0].date).toBe("2026-10-24");
    expect(asked).toHaveLength(4);
    errors.mockRestore();
  });

  it("does not wait for yesterday's file before the morning it is published", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let now = Date.parse("2026-10-25T03:00:00Z");
    server([], ["20261024"]);
    const cache = new Cache(new MemoryStore(), () => now);
    expect((await grid(cache, new Date(now))).value[0].date).toBe("2026-10-23");
    expect(errors).not.toHaveBeenCalled();
    const asked = server();
    now += 2 * 60 * MIN;
    await grid(cache, new Date(now));
    expect(asked).toEqual([]);
    errors.mockRestore();
  });

  it("keeps a day of clouds, so that it is not asked again, and reads the water in the day before", async () => {
    server([], [], ["20261024"]);
    let now = NOON;
    const cache = new Cache(new MemoryStore(), () => now);
    const g = await grid(cache, new Date(now));
    expect(g.value[0]).toEqual({ date: "2026-10-24", pixels: [] });
    expect(nearest(g.value, 55.2265, -21.0743)!.date).toBe("2026-10-23");
    const asked = server();
    now += 31 * MIN;
    await grid(cache, new Date(now));
    expect(asked).toEqual([]);
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
