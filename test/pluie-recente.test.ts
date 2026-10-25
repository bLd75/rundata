import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import * as meteofrance from "../src/providers/meteofrance.js";
import { meteoActuelle } from "../src/tools/meteo.js";
import { CONVENTION, recentRainBlock } from "../src/tools/pluie-recente.js";
import type { Fit } from "../src/tools/representativeness.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

// The hourly package of 25/10/2026, read at 12:57 Réunion time: its newest hour ends at 08:00Z, 12 h in Réunion.
const NOW = new Date("2026-10-25T08:57:00Z");
const HOURLY = meteofrance.parseHourly(fixture("meteofrance_horaire.csv"), NOW.getTime());
const SLOT = 6 * 60_000;
const near: Fit = { distance_km: 1.2, direction: "SO", ecart_altitude_m: -17, versant: "sud", pertinence: "bonne", avertissements: [], score: 1 };

/** The recorded 6-minute slot copied over 08:06 to 08:54 (12:06 to 12:54 in Réunion), with `rain` at Saint-Joseph. */
async function cache(rain: Record<string, number> = {}, metar?: string, clock = NOW, hourly = true) {
  const store = new MemoryStore();
  const at = NOW.getTime();
  const rows = meteofrance.parseCsv(fixture("meteofrance_6min.csv"));
  const entries: Record<string, { value: unknown; fetchedAt: number }> = hourly ? { horaire: { value: HOURLY, fetchedAt: at } } : {};
  for (let t = Date.parse("2026-10-25T08:06:00Z"); t <= Date.parse("2026-10-25T08:54:00Z"); t += SLOT) {
    const time = iso(t);
    entries[time] = { value: rows.map((r) => ({ ...r, time, rr_per: r.rr_per == null ? null : r.id === "97412384" ? rain[time] ?? 0 : 0 })), fetchedAt: at };
  }
  entries[iso(Date.parse("2026-10-25T09:00:00Z"))] = { value: [], fetchedAt: at };
  await store.put("meteofrance:6min", { value: entries, fetchedAt: at });
  const metars = metar
    ? [{ icaoId: "FMEP", obsTime: Date.parse("2026-10-25T08:30:00Z") / 1000, reportTime: "2026-10-25T08:30:00.000Z", temp: 24, dewp: 21, wdir: 130, wspd: 17, altim: 1018, metarType: "METAR", rawOb: metar, lat: -21.32, lon: 55.425, elev: 21, name: "St Pierre/Pierrefonds", cover: "BKN", clouds: [] }]
    : [];
  await store.put("metar", { value: metars, fetchedAt: at });
  await store.put("pioupiou:all", { value: [], fetchedAt: at });
  await store.put("pioupiou:live", { value: [], fetchedAt: at });
  return new Cache(store, () => clock.getTime());
}

describe("the rain of the last hours", () => {
  let calls = 0;
  beforeEach(() => {
    calls = 0;
    meteofrance.configure({ token: "test" });
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("/paquet/horaire")) calls++;
      throw new Error("no network in tests");
    });
  });
  afterEach(() => {
    meteofrance.configure({});
    vi.unstubAllGlobals();
  });

  it("reads only the last 24 hours of the hourly package, the airports' -0.1 as no rain", () => {
    expect(HOURLY.end).toBe("2026-10-25T08:00:00Z");
    expect(Object.keys(HOURLY.rr).sort()).toEqual(["97412356", "97412384", "97416463", "97418110", "97422440", "97424410"]);
    for (const hours of Object.values(HOURLY.rr)) expect(hours).toHaveLength(meteofrance.HOURS_KEPT);
    // La Crête: 2.6 mm in the hour ending at 08:00Z, 9.1 in the one before.
    expect(HOURLY.rr["97412356"].slice(0, 3)).toEqual([2.6, 9.1, 0.6]);
    expect(Math.min(...HOURLY.rr["97418110"].map((v) => v ?? 0))).toBe(0);
    // Before 08:00Z is published, the newest hour is 07:00Z.
    expect(meteofrance.parseHourly(fixture("meteofrance_horaire.csv"), Date.parse("2026-10-25T07:59:00Z")).end).toBe("2026-10-25T07:00:00Z");
  });

  it("writes each hour from its start to its end, Réunion time: Météo-France dates an hour's rain by its end", () => {
    const rain = { hourly: HOURLY, slots: () => [] };
    const b = recentRainBlock(rain, { id: "97412356", nom: "La Crête", fit: near }, "Saint-Joseph", NOW, false)!;
    // The value dated 08:00Z (12 h in Réunion) is the rain from 11 h to 12 h.
    expect(b.par_heure.slice(0, 3)).toEqual(["11 h–12 h : 2,6 mm", "10 h–11 h : 9,1 mm", "9 h–10 h : 0,6 mm"]);
    expect(b.convention).toBe(CONVENTION);
    expect(b.derniere_pluie).toBe("aujourd'hui entre 11 h et 12 h");
    // Midnight to noon: 2.6 + 9.1 + 0.6 (the 0.2 of yesterday 20 h–21 h left out).
    expect(b.cumul_depuis_minuit).toBe("12,3 mm de 0 h à 12 h");
    // Twelve hours, the ones of yesterday named so.
    expect(b.par_heure).toHaveLength(12);
    expect(b.par_heure.at(-1)).toBe("0 h–1 h : 0");
  });

  it("goes back 24 hours when the last rain is older than 12 hours, yesterday's hours named", () => {
    const b = recentRainBlock({ hourly: HOURLY, slots: () => [] }, { id: "97422440", nom: "Plaine des Cafres", fit: near }, "Plaine des Cafres", NOW, false)!;
    expect(b.par_heure).toHaveLength(24);
    expect(b.par_heure).toContain("hier 22 h–23 h : 0,2 mm");
    expect(b.derniere_pluie).toBe("hier entre 22 h et 23 h");
    expect(b.cumul_depuis_minuit).toBe("0 de 0 h à 12 h");
  });

  it("answers « il a plu quand ? » at Saint-Joseph to the 6 minutes, the hour under way included", async () => {
    const r = body(await meteoActuelle(await cache({ "2026-10-25T08:30:00Z": 0.4 }), "Saint-Joseph", NOW));
    expect(r.pluie_recente).toMatchObject({
      station: "Saint-Joseph",
      pertinence: "bonne",
      nature: "mesure (pluviomètre Météo-France)",
      derniere_pluie: "aujourd'hui entre 12 h 24 et 12 h 30",
      cumul_depuis_minuit: "0,4 mm de 0 h à 12 h 54",
    });
    expect(r.pluie_recente.par_heure[0]).toBe("12 h–12 h 54 : 0,4 mm (heure en cours)");
    expect(r.pluie_recente.par_heure[1]).toBe("11 h–12 h : 0");
    expect(r.resume).toContain("Pluie à Saint-Joseph (pluviomètre, ");
    expect(r.resume).toContain("dernière pluie aujourd'hui entre 12 h 24 et 12 h 30\u00a0; 0,4 mm de 0 h à 12 h 54 (depuis minuit).");
    expect(r.pluie_recente.bruine).toBeUndefined();
  });

  it("says when the gauge is not at the place, so that no one says it did not rain there", async () => {
    const r = body(await meteoActuelle(await cache(), "Piton des Neiges", NOW));
    expect(r.pluie_recente.pertinence).not.toBe("bonne");
    expect(r.pluie_recente.station).toBe("Cilaos");
    expect(r.pluie_recente.avertissements[1]).toBe("Pluie mesurée à Cilaos, pas à Piton des Neiges : elle peut y être très différente. Ne pas dire qu'il a plu ou non à Piton des Neiges sans le préciser.");
  });

  it("warns that a light drizzle may not be measured when the gauge and the radar see nothing under a loaded sky", async () => {
    // 24 hours back from 12 h.
    const dry = "pas de pluie mesurée depuis hier 12 h";
    const loaded = body(await meteoActuelle(await cache({}, "METAR FMEP 250830Z AUTO 13017KT 9000 FEW009 SCT013 BKN019 24/21 Q1018 TEMPO 3000 SHRA BKN010TCU"), "Saint-Joseph", NOW));
    expect(loaded.pluie_recente.derniere_pluie).toBe(dry);
    expect(loaded.pluie_recente.bruine).toMatch(/une bruine ou une pluie très faible peut leur échapper \(un pluviomètre compte la pluie par 0,2 mm\)/);
    // Clear sky now, showers only in the trend: nothing said.
    const clear = body(await meteoActuelle(await cache({}, "METAR FMEP 250830Z AUTO 13017KT 9999 FEW020 24/21 Q1018 TEMPO 3000 SHRA BKN010TCU"), "Saint-Joseph", NOW));
    expect(clear.pluie_recente.bruine).toBeUndefined();
  });

  describe("reading the hourly package again", () => {
    it("only once the next hour should be in it, keeping the hours in hand when it cannot be read", async () => {
      const at = async (now: string, hourly = true) =>
        body(await meteoActuelle(await cache({}, undefined, new Date(now), hourly), "Saint-Joseph", new Date(now)));
      // 09:10Z: the 09:00Z hour is not due before 09:15Z, the 08:00Z one in hand is enough.
      expect((await at("2026-10-25T09:10:00Z")).pluie_recente.par_heure[1]).toBe("11 h–12 h : 0");
      expect(calls).toBe(0);
      // 09:20Z: due, asked again; unreadable here, so the hours in hand.
      expect((await at("2026-10-25T09:20:00Z")).pluie_recente.par_heure[1]).toBe("11 h–12 h : 0");
      expect(calls).toBe(1);
      // Never read: the answer goes without the block.
      const r = await at("2026-10-25T09:20:00Z", false);
      expect(r.pluie_recente).toBeUndefined();
      expect(r.stations[0].station).toBe("Saint-Joseph");
    });

    it("is never read for the place pages", async () => {
      const now = new Date("2026-10-25T09:20:00Z");
      await meteoActuelle(await cache({}, undefined, now), "Saint-Joseph", now, false);
      expect(calls).toBe(0);
    });
  });
});
