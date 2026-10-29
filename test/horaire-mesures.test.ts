import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as meteofrance from "../src/providers/meteofrance.js";

const csv = readFileSync(new URL("./fixtures/meteofrance_horaire.csv", import.meta.url), "utf8");
// The hourly package of 25/10/2026, read at 12:57 Réunion time: its newest hour ends at 08:00Z.
const HOURLY = meteofrance.parseHourly(csv, Date.parse("2026-10-25T08:57:00Z"));

describe("the hourly package's measures", () => {
  it("keeps temperature, humidity, wind and pressure hour by hour, in the units shown", () => {
    const [h0, h1] = meteofrance.stationHours(HOURLY, "97416463");
    // 298.85 K, 74 %, 130°, 9.0 m/s, 11.6 m/s, 101860 Pa, rr1 -0.1.
    expect(h0).toEqual({ fin: "2026-10-25T08:00:00Z", rr: 0, t: 25.7, u: 74, dd: 130, ff: 32, raf: 42, pmer: 1018.6 });
    expect(h1).toMatchObject({ fin: "2026-10-25T07:00:00Z", t: 24.7, u: 80, ff: 32, raf: 44, pmer: 1019 });
  });

  it("leaves null what a station does not report", () => {
    const [h0] = meteofrance.stationHours(HOURLY, "97412356");
    expect(h0).toEqual({ fin: "2026-10-25T08:00:00Z", rr: 2.6, t: 18.4, u: null, dd: null, ff: null, raf: null, pmer: null });
  });

  it("keeps HOURS_KEPT hours, and reads a copy saved before the measures were kept", () => {
    expect(meteofrance.stationHours(HOURLY, "97416463")).toHaveLength(HOURLY.rr["97416463"].length);
    const old = { end: HOURLY.end, rr: HOURLY.rr };
    expect(meteofrance.stationHours(old, "97416463")[0]).toEqual({ fin: "2026-10-25T08:00:00Z", rr: 0, t: null, u: null, dd: null, ff: null, raf: null, pmer: null });
    expect(meteofrance.stationHours(HOURLY, "00000000")).toEqual([]);
  });
});
