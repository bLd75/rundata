import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BALISES, MAX_SILENCE_MS, parse, type Releve } from "../src/providers/ffvl.js";
import { communeAt } from "../src/places/resolve.js";

// Real readings of the network's file, 29 October 2026 at 20:10 UTC: two beacons of La Réunion, two of mainland France, and the
// Maïdo's last reading, older.
const releves = JSON.parse(readFileSync(new URL("./fixtures/ffvl_releves.json", import.meta.url), "utf8")) as Releve[];
const AT = new Date("2026-10-29T20:10:00Z");

describe("the FFVL's beacons", () => {
  it("keeps the wind of the beacons of La Réunion only, as their mean, gusts and direction", () => {
    const obs = parse(releves, AT);
    expect(obs.map((o) => o.station.nom)).toEqual(["Balise de Kélonia", "Balise du Trou d'Eau"]);
    expect(obs[0]).toMatchObject({ station: { source: "ffvl", id: "164", altitude_m: 10, variables: ["vent"] }, time: new Date("2026-10-29T19:58:17Z") });
    expect(obs[0].readings).toEqual([
      { variable: "vent_moyen", valeur: 8, unite: "km/h", nature: "mesure" },
      { variable: "vent_direction", valeur: 112, unite: "° (d'où vient le vent)", nature: "mesure" },
      { variable: "rafales", valeur: 15, unite: "km/h", nature: "mesure" },
    ]);
    // Never its temperature, taken in its box.
    expect(obs.flatMap((o) => o.readings.map((r) => r.variable))).not.toContain("temperature");
  });

  it("leaves out a beacon silent for longer than two of its readings and a quarter of an hour, and one in the future", () => {
    expect(MAX_SILENCE_MS).toBe(75 * 60_000);
    const maido = releves.find((r) => r.idbalise === 170)!;
    expect(parse([maido], new Date(Date.parse(maido.date!) + 74 * 60_000)).map((o) => o.station.nom)).toEqual(["Balise du Maïdo"]);
    expect(parse([maido], new Date(Date.parse(maido.date!) + 76 * 60_000))).toEqual([]);
    expect(parse([maido], new Date(Date.parse(maido.date!) - 10 * 60_000))).toEqual([]);
    // A calm without a direction is still a measure.
    expect(parse([maido], new Date(Date.parse(maido.date!) + 60_000))[0].readings).toEqual([
      { variable: "vent_moyen", valeur: 0, unite: "km/h", nature: "mesure" },
      { variable: "rafales", valeur: 0, unite: "km/h", nature: "mesure" },
    ]);
  });

  it("places each beacon of La Réunion in the island, with its altitude, and keeps nothing of its contact", () => {
    expect(BALISES.map((b) => communeAt(b.lon, b.lat))).toEqual(["Saint-Leu", "Saint-Joseph", "Saint-Paul", "Saint-Paul", "Le Tampon", "Saint-Paul"]);
    for (const b of BALISES) expect(Object.keys(b).sort()).toEqual(["altitude_m", "id", "lat", "lon", "nom"]);
    expect(readFileSync(new URL("../src/providers/ffvl.ts", import.meta.url), "utf8")).not.toMatch(/contact_(name|phone|email)/);
  });
});
