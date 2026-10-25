import { counted } from "../src/budget.js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parseAscii, parseCsv } from "../src/providers/acspo.js";
import * as meteofrance from "../src/providers/meteofrance.js";
import { inReunionBeacons } from "../src/providers/pioupiou.js";
import { temperatureMer } from "../src/tools/mer.js";
import { meteoActuelle } from "../src/tools/meteo.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-18T19:20:00Z");

/** A cache already holding the recorded upstream answers, so that no test touches the network. */
async function offlineCache({ acspoCached = true, acspoDay = "2026-10-16", copyAgeMs = 0 } = {}) {
  const store = new MemoryStore();
  const at = NOW.getTime();
  const beacons = inReunionBeacons(JSON.parse(fixture("pioupiou_all.json")).data);
  const live = beacons.map((b) => ({ ...b, measurements: { ...b.measurements, date: "2026-10-18T19:16:00Z" } }));
  await store.put("metar", { value: JSON.parse(fixture("metar.json")), fetchedAt: at });
  await store.put("pioupiou:all", { value: beacons, fetchedAt: at });
  await store.put("pioupiou:live", { value: live, fetchedAt: at });
  // The copy of /mer the scheduled event wrote (web/data.ts buildSea): temperature_mer reads the satellites' grids there.
  const lu = at - copyAgeMs;
  const satellites = [
    ...(acspoCached ? [{ source: "acspo", jours: [parseAscii(fixture("acspo.ascii"), acspoDay)], lu }] : []),
    { source: "modis", jours: parseCsv(fixture("modis.csv"), "sstMasked"), lu },
  ];
  await store.put("web:mer", { value: { plages: [], sources: [], satellites }, fetchedAt: lu });
  return new Cache(store, () => at);
}

const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe("meteo_actuelle", () => {
  it("answers for a beach with the nearest wind and the nearest temperature", async () => {
    const r = body(await meteoActuelle(await offlineCache(), "plage de l'Hermitage", NOW));
    expect(r.lieu.trouve).toBe("Plage de l'Ermitage-les-Bains");
    expect(r.resume).toMatch(/Cambaie/);
    expect(r.resume).toMatch(/°C/);
    expect(r.stations[0]).toMatchObject({ heure_mesure: "18/10 23:16", age_min: 4 });
  });

  it("warns that the coast does not speak for Cilaos", async () => {
    const r = body(await meteoActuelle(await offlineCache(), "Cilaos", NOW));
    expect(r.stations.every((s: { pertinence: string }) => s.pertinence === "faible")).toBe(true);
    expect(r.resume).toMatch(/Attention/);
  });

  it("tours the island without a place", async () => {
    const r = body(await meteoActuelle(await offlineCache(), undefined, NOW));
    expect(r.stations).toHaveLength(3);
  });

  it("says when a place is unknown", async () => {
    const r = await meteoActuelle(await offlineCache(), "Tombouctou", NOW);
    expect(r.isError).toBe(true);
  });
});

describe("temperature_mer", () => {
  // Offline: what the cache does not hold (the swell's forecast) must not wait on the network; a test may stub its own.
  beforeEach(() =>
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    }));
  afterEach(() => vi.unstubAllGlobals());

  it("gives the satellite reading with its date and its caveats", async () => {
    const r = body(await temperatureMer(await offlineCache(), "Hermitage", NOW));
    expect(r.mesure).toMatchObject({ nature: "mesure_satellite", jour_mesure: "2026-10-16", age_jours: 2 });
    expect(r.resume).toMatch(/^Eau de mer près de Plage de l'Ermitage-les-Bains\u00a0: \d+(,\d)? °C, mesurée par satellite le 16\/10, il y a 2 jours \(moyenne du jour, point de mesure à \d+(,\d)? km\)\./);
    expect(r.avertissements).toContain(
      "Mesure du 16/10, il y a 2 jours\u00a0: ce n'est pas la température d'aujourd'hui. Une mesure par satellite paraît le lendemain, " +
        "et les jours de nuages il n'y en a pas\u00a0: la dernière peut donc dater de plusieurs jours.",
    );
  });

  it("counts the age in calendar days at La Réunion, and says « hier » for yesterday's", async () => {
    // 16 October read on the 19th at 01:00, La Réunion: three days, though less than 72 hours.
    const night = new Date("2026-10-18T21:00:00Z");
    const late = body(await temperatureMer(await offlineCache(), "Hermitage", night));
    expect(late.resume).toContain("mesurée par satellite le 16/10, il y a 3 jours (");
    // The 17th read on the 18th: yesterday's, without the clouds.
    const r = body(await temperatureMer(await offlineCache({ acspoDay: "2026-10-17" }), "Hermitage", NOW));
    expect(r.resume).toContain("mesurée par satellite hier, 17/10 (");
    expect(r.avertissements).toContain("Mesure d'hier (17/10)\u00a0: ce n'est pas la température d'aujourd'hui. Une mesure par satellite paraît le lendemain.");
  });

  it("gives each point of the coast its day and age", async () => {
    const r = body(await temperatureMer(await offlineCache(), undefined, NOW));
    expect(r.resume).toMatch(/^Eau de mer, MESURÉE par satellite\u00a0: Plage de Boucan-Canot\u00a0: \d+(,\d)? °C \(le 16\/10, il y a 2 jours\)\u00a0; /);
  });

  it("falls back to MODIS when the copy was made with the NOAA CoastWatch server down", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    const r = body(await temperatureMer(await offlineCache({ acspoCached: false }), "Saint-Leu", NOW));
    expect(r.mesure).toMatchObject({ nature: "mesure_satellite", source: expect.stringMatching(/MODIS/) });
    expect(r.sources[0].source).toMatch(/MODIS/);
  });

  it("answers from the copy of /mer however old, and never asks the satellites itself (cam-change 273)", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(String(url));
      throw new Error("offline");
    });
    const satellites = () => asked.filter((u) => u.includes("/thredds/") || u.includes("/erddap/"));
    // A copy of 7 hours: the scheduled event has not refreshed it since.
    const cache = await offlineCache({ copyAgeMs: 7 * 3600_000 });
    const place = body(await temperatureMer(cache, "Saint-Leu", NOW));
    expect(place.mesure).toMatchObject({ nature: "mesure_satellite", jour_mesure: "2026-10-16" });
    const tour = body(await temperatureMer(cache, undefined, NOW));
    expect(tour.resume).toMatch(/^Eau de mer, MESURÉE par satellite : Plage de Boucan-Canot : \d+(,\d)? °C \(le 16\/10, il y a 2 jours\)/);
    expect(tour.mis_a_jour).toBe("18/10 16:20");
    // Without a copy, no measure rather than a wait on NOAA.
    const bare = new Cache(new MemoryStore(), () => NOW.getTime());
    expect((await temperatureMer(bare, "Saint-Leu", NOW)).isError).toBe(true);
    expect(satellites()).toEqual([]);
  });

  it("does not invent a sea temperature for Cilaos", async () => {
    const r = body(await temperatureMer(await offlineCache(), "Cilaos", NOW));
    expect(r.mesure).toBeUndefined();
    expect(r.resume).toMatch(/Pas de mesure/);
  });
});

describe("meteo_actuelle with the Météo-France stations", () => {
  const MF_NOW = new Date("2026-10-22T05:25:00Z");
  const SLOT = 6 * 60_000;
  const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

  /** The recorded 05:18 slot, copied back over the hour before, with a little rain at Cilaos. */
  async function mfCache() {
    const store = new MemoryStore();
    const at = MF_NOW.getTime();
    const rows = meteofrance.parseCsv(fixture("meteofrance_6min.csv"));
    const last = Date.parse("2026-10-22T05:18:00Z");
    const slots: Record<string, { value: unknown; fetchedAt: number }> = {};
    slots[iso(last + SLOT)] = { value: [], fetchedAt: at }; // not published yet
    for (let k = 0; k < 10; k++) {
      const time = iso(last - k * SLOT);
      const rain = (id: string) => (id === "97424410" && (k === 0 || k === 3) ? 0.2 * (k + 1) : 0);
      const value = rows.map((r) => ({ ...r, time, rr_per: r.rr_per == null ? null : rain(r.id) }));
      slots[time] = { value, fetchedAt: at };
    }
    await store.put("meteofrance:6min", { value: slots, fetchedAt: at });
    await store.put("metar", { value: JSON.parse(fixture("metar.json")), fetchedAt: at });
    await store.put("pioupiou:all", { value: [], fetchedAt: at });
    await store.put("pioupiou:live", { value: [], fetchedAt: at });
    return new Cache(store, () => at);
  }

  beforeEach(() => {
    meteofrance.configure({ token: "test" });
    vi.stubGlobal("fetch", async () => {
      throw new Error("no network in tests");
    });
  });
  afterEach(() => {
    meteofrance.configure({});
    vi.unstubAllGlobals();
  });

  it("answers for Cilaos from the Cilaos station, with the rain", async () => {
    const r = body(await meteoActuelle(await mfCache(), "Cilaos", MF_NOW));
    expect(r.stations[0]).toMatchObject({ station: "Cilaos", source: "meteofrance", pertinence: "bonne", age_min: 7 });
    expect(r.resume).toMatch(/il pleut \(0,2 mm en 6 min, 1 mm en 1 h\)/);
    expect(r.couverture).toMatch(/56 stations Météo-France/);
  });

  it("answers for a summit from the highest stations, not from the coast", async () => {
    const r = body(await meteoActuelle(await mfCache(), "Piton des Neiges", MF_NOW));
    const [first, second] = r.stations as { station: string; altitude_m: number }[];
    expect(first.altitude_m).toBeGreaterThan(1500);
    expect(second.altitude_m).toBeGreaterThan(1500);
    expect(r.resume).not.toMatch(/Gillot/);
  });

  it("tours the island with a fixed selection, without the airport twice", async () => {
    const r = body(await meteoActuelle(await mfCache(), undefined, MF_NOW));
    expect(r.stations).toHaveLength(10);
    expect(r.stations.map((s: { station: string }) => s.station)).toContain("Piton Maïdo");
    expect(r.stations.map((s: { station: string }) => s.station)).toContain("Gros Piton Sainte-Rose");
    expect(r.stations.some((s: { source: string }) => s.source === "metar")).toBe(false);
  });

  it("renews the OAuth token once when another copy of the server voided it", async () => {
    meteofrance.configure({ applicationId: "app" });
    const tokens = ["old", "new"];
    let tokenCalls = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.endsWith("/token")) {
        tokenCalls++;
        return Response.json({ access_token: tokens.shift(), expires_in: 3600 });
      }
      const ok = (init.headers as Record<string, string>).Authorization === "Bearer new";
      return ok ? new Response(fixture("meteofrance_6min.csv")) : new Response("", { status: 401 });
    });
    // As in the Worker, where the stations and the radar of one question share their token.
    const { value } = await counted(Infinity, () => meteoActuelle(new Cache(new MemoryStore(), () => MF_NOW.getTime()), "Cilaos", MF_NOW));
    expect(body(value).stations[0].station).toBe("Cilaos");
    expect(tokenCalls).toBe(2);
  });
});
