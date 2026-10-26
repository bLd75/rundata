import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { breakdown, constraints, electricite } from "../src/tools/electricite.js";

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
    expect(b.parts[0].filiere).toBe("moteurs diesel et fioul");
    expect(b.renouvelable_pct).toBeGreaterThan(20);
    expect(b.renouvelable_pct).toBeLessThan(35);
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
    expect(r.resume).toContain("Météo de l'électricité EDF en ce moment : optimal.");
    expect(r.resume).toContain("vendredi 23/10 de 18\u00a0h à 22\u00a0h (heures de pointe)");
  });
});
