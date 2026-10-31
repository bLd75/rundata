import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { breakdown, constraints, electricite, produced } from "../src/tools/electricite.js";
import { electriciteLive, electricitePage } from "../src/web/domains.js";

const fixture = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
// EDF's open data of 23/10/2026 around 03:15 heure de La Réunion: a night mix, peak hours in the evening.
const NOW = new Date("2026-10-22T23:20:00Z");
const mix = () => { const { _id, _i, _rand, _score, _updatedAt, jour, ...m } = fixture("edf_mix.json").results[0]; return m; };
const hours = () => fixture("edf_signal.json").results;
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe("electricity", () => {
  // The mairies' notices of power cuts are not read here (test/courant.test.ts).
  beforeEach(() => vi.stubGlobal("fetch", async () => new Response("", { status: 404 })));
  afterEach(() => vi.unstubAllGlobals());

  it("shares out the production and adds up the renewables", () => {
    const b = breakdown(mix());
    expect(b.parts[0].filiere).toBe("bioliquide");
    expect(b.renouvelable_pct).toBe(100);
  });

  // EDF's line of 31/10/2026 05:20, read on its open data: the batteries charging (-2.1 MW).
  const line = { date: "2026-10-31T05:20:00+04:00", stockage: -2.1174, diesel: 107.732, turbines_combustion: 13.926, bioenergies: 51.316, charbon: 76.542, photovoltaique: 3.77, total: 281.028, hydraulique: 25.248, eolien: 4.612, statut: "Estimé" };

  it("counts biomass and bioliquid as renewable, as EDF titles its columns", () => {
    const b = breakdown(line);
    expect(b.renouvelable_pct).toBe(95.1);
    expect(b.parts.map((p) => [p.filiere, p.renouvelable])).toEqual([
      ["bioliquide", true],
      ["biomasse", true],
      ["bioénergies", true],
      ["hydraulique", true],
      ["turbines à combustion", false],
      ["éolien", true],
      ["solaire photovoltaïque", true],
    ]);
  });

  it("leaves the batteries out of the shares, in charge or not, and says EDF's total", async () => {
    expect(produced(line)).toBeCloseTo(283.146, 3);
    const b = breakdown(line);
    expect(b.parts.some((p) => p.filiere.startsWith("stockage"))).toBe(false);
    expect(b.parts.reduce((s, p) => s + p.part_pct, 0)).toBeCloseTo(100, 0);
    // Discharging, they give back what the others produced: the share does not move.
    expect(breakdown({ ...line, stockage: 5, total: 288.146 })).toEqual(b);
    const store = new MemoryStore();
    void store.put("edf:mix", { value: line, fetchedAt: Date.parse("2026-10-31T01:25:00Z") });
    const at = new Date("2026-10-31T01:25:00Z");
    const r = body(await electricite(new Cache(store, () => at.getTime()), at));
    expect(r.production).toMatchObject({ total_mw: 281, renouvelable_pct: 95.1 });
    expect(r.resume).toMatch(/^Production d'électricité à 05:20 \(il y a 5 min\) : 281 MW, dont 95,1 % renouvelable\./);
  });

  it("runs the strained hours together", () => {
    const c = constraints(hours());
    expect(c[0]).toEqual({ quand: "vendredi 23/10 de 18\u00a0h à 22\u00a0h", signal: "heures de pointe", recharge_conseillee_pct: 50 });
  });

  it("answers from cached EDF data", async () => {
    const store = new MemoryStore();
    void store.put("edf:mix", { value: mix(), fetchedAt: NOW.getTime() });
    void store.put("edf:signal", { value: hours(), fetchedAt: NOW.getTime() });
    const r = body(await electricite(new Cache(store, () => NOW.getTime()), NOW));
    expect(r.resume).toMatch(/^Production d'électricité à 03:\d\d \(il y a \d+ min\) : \d+ MW, dont [\d,]+ % renouvelable\./);
    expect(r.resume).toContain("Météo de l'électricité EDF pour cette heure : optimal.");
    expect(r.resume).toContain("vendredi 23/10 de 18\u00a0h à 22\u00a0h (heures de pointe)");
  });

  it("says EDF's signal with the update of its dataset, as EDF's terms ask, in the tool, the page and the home tile", async () => {
    // The lines' Last-Modified is the dataset's update (« dataUpdatedAt » on opendata-reunion.edf.fr): one request.
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).includes("7tgfic35") ? new Response(JSON.stringify(fixture("edf_signal.json")), { headers: { "last-modified": "Thu, 22 Oct 2026 18:00:37 GMT" } }) : new Response("", { status: 404 }));
    const store = new MemoryStore();
    void store.put("edf:mix", { value: mix(), fetchedAt: NOW.getTime() });
    const r = body(await electricite(new Cache(store, () => NOW.getTime()), NOW));
    expect(r.resume).toContain("Météo de l'électricité EDF pour cette heure : optimal (annoncée par EDF le 22/10 à 22:00).");
    expect(r.meteo_electricite.mis_a_jour).toBe("22/10 22:00");
    const data = { value: r, fetchedAt: NOW, stale: false };
    expect(electricitePage("https://rundata.re", data, NOW)).toContain("Signal d'EDF pour cette heure : <b>optimal</b> (annoncé par EDF le 22/10 à 22:00).");
    expect(electriciteLive(data, NOW)?.detail).toContain("· signal EDF optimal (annoncé le 22/10 à 22:00)");
    // A copy of the signal kept from before: the hours alone, said without a date rather than not at all.
    const before = new MemoryStore();
    void before.put("edf:signal", { value: hours(), fetchedAt: NOW.getTime() });
    expect(body(await electricite(new Cache(before, () => NOW.getTime()), NOW)).resume).toContain("Météo de l'électricité EDF pour cette heure : optimal.");
  });
});
