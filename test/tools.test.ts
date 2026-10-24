import { counted } from "../src/budget.js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { parseCsv } from "../src/providers/acspo.js";
import * as meteofrance from "../src/providers/meteofrance.js";
import { inReunionBeacons } from "../src/providers/pioupiou.js";
import { temperatureMer } from "../src/tools/mer.js";
import { meteoActuelle } from "../src/tools/meteo.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-18T19:20:00Z");

/** A cache already holding the recorded upstream answers, so that no test touches the network. */
async function offlineCache({ acspoCached = true } = {}) {
  const store = new MemoryStore();
  const at = NOW.getTime();
  const beacons = inReunionBeacons(JSON.parse(fixture("pioupiou_all.json")).data);
  const live = beacons.map((b) => ({ ...b, measurements: { ...b.measurements, date: "2026-10-18T19:16:00Z" } }));
  await store.put("metar", { value: JSON.parse(fixture("metar.json")), fetchedAt: at });
  await store.put("pioupiou:all", { value: beacons, fetchedAt: at });
  await store.put("pioupiou:live", { value: live, fetchedAt: at });
  if (acspoCached) await store.put("acspo", { value: parseCsv(fixture("acspo.csv")), fetchedAt: at });
  await store.put("modis", { value: parseCsv(fixture("modis.csv"), "sstMasked"), fetchedAt: at });
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
    expect(r.avertissements.join(" ")).toMatch(/2 jours de retard/);
  });

  it("falls back to MODIS when the NOAA CoastWatch server is down", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    const r = body(await temperatureMer(await offlineCache({ acspoCached: false }), "Saint-Leu", NOW));
    expect(r.mesure).toMatchObject({ nature: "mesure_satellite", source: expect.stringMatching(/MODIS/) });
    expect(r.sources[0].source).toMatch(/MODIS/);
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
