import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { advisoryTime, parseList, parseTimeline, seasonOf, stageOfWind, systemName } from "../src/providers/cyclones.js";
import { cyclones, side } from "../src/tools/cyclones.js";

// GDACS on 24/10/2026: no system in the basin since the end of the 2025-2026 season (Indusa, April). The track is
// FYTIA's as of the RSMC's advisory 20 (3 February 2026, 06:00 UTC): a moderate tropical storm 290 km south-south-west
// of La Réunion, closest then, forecast to weaken while it moves away to the south-east.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/cyclones/${f}`, import.meta.url));
const OCTOBER = new Date("2026-10-24T06:00:00Z");
const FYTIA = new Date("2026-02-03T08:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = (now: Date) => new Cache(new MemoryStore(), () => now.getTime());

function file(url: string): string | undefined {
  if (url.includes("geteventlist")) return url.includes("pagenumber=2") ? "liste_page2.json" : "liste_page1.json";
  if (url.includes("getepisodedata") && url.includes("eventid=1001254")) return "episode_fytia.json";
  if (url.includes("gettimeline?id=732239")) return "timeline_fytia.json";
}

describe("cyclones", () => {
  let calls: string[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      const f = file(url);
      return f ? new Response(fixture(f)) : new Response("", { status: 503 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads GDACS's names, times and winds as the RSMC gives them", () => {
    expect(systemName("FYTIA-26")).toBe("Fytia");
    expect(systemName("12-20252026-26")).toBe("système n° 12 (non baptisé)");
    expect(advisoryTime("03 Feb 2026 06:00")).toBe("2026-02-03T06:00:00.000Z");
    expect(seasonOf(OCTOBER)).toEqual({ nom: "2026-2027", debut: "2026-07-01T00:00:00.000Z" });
    expect(seasonOf(FYTIA).nom).toBe("2025-2026");
    // FYTIA at its peak: 179 km/h over 1 minute at GDACS, 85 kt over 10 minutes at the RSMC, a tropical cyclone.
    expect(stageOfWind(157)).toBe("cyclone tropical");
    expect(stageOfWind(185)).toBe("cyclone tropical intense");
    // Horacio: 213 km/h is 115 kt, the top of the intense tropical cyclone.
    expect(stageOfWind(213)).toBe("cyclone tropical intense");
    expect(side(225)).toBe("au sud-ouest");
    expect(side(100)).toBe("à l'est");
  });

  it("keeps the systems of the south-west Indian Ocean only", () => {
    const list = parseList(JSON.parse(fixture("liste_page1.json").toString()));
    expect(list.map((s) => s.nom)).toEqual(expect.arrayContaining(["Fytia", "Gezani", "Indusa", "Horacio", "Dudzai"]));
    expect(list.find((s) => s.nom === "Champi")).toBeUndefined();
    expect(list.find((s) => s.nom === "Fytia")).toMatchObject({ vent_max_kmh: 157, centre: "CMRS de La Réunion", fin: "2026-02-04T06:00:00.000Z" });
  });

  it("splits a timeline into the observed track and the RSMC's forecast", () => {
    const t = parseTimeline(JSON.parse(fixture("timeline_fytia.json").toString()));
    expect(t.observee).toHaveLength(20);
    expect(t.observee.at(-1)).toMatchObject({ heure: "2026-02-03T06:00:00.000Z", lon: 54.24, lat: -23.47, stade: "tempête tropicale modérée", vent_kmh: 83, pression_hpa: 988 });
    expect(t.prevue.map((p) => p.stade)).toEqual(["tempête tropicale modérée", "dépression résiduelle", "dépression résiduelle", "dépression résiduelle", "dépression résiduelle"]);
    expect(t.prevue[0].pression_hpa).toBeUndefined();
  });

  it("follows an active system: where it is from the island, where it goes, how close it will come", async () => {
    const r = body(await cyclones(cache(FYTIA), undefined, FYTIA));
    expect(r.systemes_actifs).toHaveLength(1);
    const f = r.systemes_actifs[0];
    expect(f).toMatchObject({ nom: "Fytia", stade: "tempête tropicale modérée", vent_moyen_kmh: 83, pression_hpa: 988, distance_km: 290, situation: "à 290 km au sud-sud-ouest de La Réunion", s_eloigne: true });
    expect(f.deplacement).toBe("vers le sud-sud-est à 12 km/h");
    expect(f.au_plus_pres_selon_la_prevision).toBeUndefined();
    expect(f.prevision_cmrs[0]).toEqual({ heure: "03/02 à 22:00", stade: "tempête tropicale modérée", vent_moyen_kmh: 74, distance_km: 340, situation: "au sud" });
    expect(r.resume).toContain("Fytia : tempête tropicale modérée (vent moyen 83 km/h), à 290 km au sud-sud-ouest de La Réunion le 03/02 à 10:00, se déplace vers le sud-sud-est à 12 km/h. La prévision du CMRS l'éloigne de La Réunion.");
    expect(r.saison_precedente).toBeUndefined();
    // The list (two pages towards July 2024), then the episode and its timeline: 4 requests.
    expect(calls.filter((u) => u.includes("geteventlist"))).toHaveLength(2);
    expect(calls).toHaveLength(4);
  });

  it("measures from the place asked", async () => {
    const r = body(await cyclones(cache(FYTIA), "Saint-Philippe", FYTIA));
    expect(r.lieu.commune).toBe("Saint-Philippe");
    expect(r.systemes_actifs[0].situation).toMatch(/de Saint-Philippe$/);
    expect(r.systemes_actifs[0].distance_km).toBeLessThan(300);
  });

  it("says plainly that nothing is active out of season, with the last system and the season before", async () => {
    const r = body(await cyclones(cache(OCTOBER), undefined, OCTOBER));
    expect(r.systemes_actifs).toBeUndefined();
    expect(r.resume).toMatch(/^Aucun système tropical actif dans le sud-ouest de l'océan Indien\. Saison 2026-2027 : aucun système pour le moment\. Dernier système : Indusa, du 01\/04\/2026 au 05\/04\/2026/);
    expect(r.saison_precedente.nom).toBe("2025-2026");
    expect(r.saison_precedente.systemes.map((s: { nom: string }) => s.nom)).toEqual(expect.arrayContaining(["Fytia", "Gezani", "Chenge", "Blossom", "Awo"]));
    expect(r.saison_precedente.systemes.find((s: { nom: string }) => s.nom === "Gezani").stade_max).toBe("cyclone tropical intense");
    expect(r.consulter.meteo_france).toBe("https://meteofrance.re/fr/cyclone");
    expect(r.phases_alerte).toContain("alerte violette");
    // A full first page that stops in October 2025: the second one reaches July 2025.
    expect(calls.filter((u) => u.includes("pagenumber=2"))).toHaveLength(1);
    expect(calls.some((u) => u.includes("getepisodedata"))).toBe(false);
  });

  it("says so when GDACS does not answer", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    const r = await cyclones(cache(OCTOBER), undefined, OCTOBER);
    expect(r).toMatchObject({ isError: true });
    expect(body(r).consulter.meteo_france).toBe("https://meteofrance.re/fr/cyclone");
  });
});
