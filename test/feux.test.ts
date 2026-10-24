import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { counted } from "../src/budget.js";
import { Cache, MemoryStore } from "../src/cache.js";
import * as feux from "../src/providers/feux.js";
import { configure as configureMf } from "../src/providers/mf-auth.js";
import { QUIET, URGENCE } from "../src/tools/feux.js";
import { sentiersRandonnee } from "../src/tools/sentiers.js";
import { vigilanceMeteo } from "../src/tools/vigilance.js";
import type { RandonneesAnswer, SentiersAnswer } from "../src/web/data.js";
import { sentiersPage } from "../src/web/domains.js";
import { communeHikes } from "../src/web/liens.js";
import { pageOf } from "../src/web/places.js";

// Three VIIRS lists in FIRMS's column format: NOAA-20 saw two hot pixels above Saint-Paul (06:30 and 01:50, Réunion
// time), NOAA-21 one two days old, Suomi NPP nothing.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const onf = (f: string) => readFileSync(new URL(`./fixtures/onf/${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-24T04:00:00Z");
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const cache = () => new Cache(new MemoryStore(), () => NOW.getTime());
const FILES: Record<string, string> = { VIIRS_NOAA20_NRT: "firms_viirs_noaa20.csv", VIIRS_NOAA21_NRT: "firms_viirs_noaa21.csv", VIIRS_SNPP_NRT: "firms_viirs_snpp.csv" };

let asked: string[] = [];
function upstream(url: string, quiet = false): Response {
  if (url.includes("firms.modaps")) {
    asked.push(url);
    const source = Object.keys(FILES).find((s) => url.includes(`/${s}/`))!;
    return new Response(quiet ? fixture(FILES.VIIRS_SNPP_NRT) : fixture(FILES[source]));
  }
  if (url.includes("arcgis") || url.includes("query")) {
    const file = url.includes("/5/query") ? "sentiers.json" : url.includes("/4/query") ? "routes.json" : "couche.json";
    return new Response(onf(file), { headers: { "content-type": "application/json" } });
  }
  throw new Error(`unexpected ${url}`);
}

beforeEach(() => {
  asked = [];
  vi.stubGlobal("fetch", async (url: string) => upstream(String(url)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  feux.configure(undefined);
  configureMf({});
});

describe("fires seen by satellite", () => {
  it("are nothing at all without FIRMS's key: no request, no block, no line in the logs", async () => {
    const errors = vi.spyOn(console, "error");
    expect(await feux.feuxNow(cache(), NOW)).toBeNull();
    const r = body(await sentiersRandonnee(cache(), "Maïdo", NOW));
    expect(r.feux_detectes).toBeUndefined();
    expect(r.resume).not.toMatch(/feu/i);
    expect(asked).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("reads the three VIIRS satellites in one go, keeps the last 24 hours, and caches them for the island", async () => {
    feux.configure("key");
    const c = cache();
    const f = (await feux.feuxNow(c, NOW))!;
    expect(asked).toHaveLength(feux.COST);
    expect(asked[0]).toBe("https://firms.modaps.eosdis.nasa.gov/api/area/csv/key/VIIRS_SNPP_NRT/55.2,-21.4,55.85,-20.85/1");
    expect(f.satellites).toEqual(["Suomi NPP", "NOAA-20", "NOAA-21"]);
    // The one of 22/10 is past the day; the newest first, its hour read from « 230 ».
    expect(f.detections.map((d) => [d.t, d.confiance, d.commune])).toEqual([
      ["2026-10-24T02:30:00.000Z", "forte", "Saint-Paul"],
      ["2026-10-23T21:50:00.000Z", "moyenne", "Saint-Paul"],
    ]);
    expect(f.detections[0].frp_mw).toBe(12.4);
    await feux.feuxNow(c, NOW);
    expect(asked).toHaveLength(feux.COST);
  });

  it("is built only with twice its cost left, and keeps the satellites that answered", async () => {
    feux.configure("key");
    const { value } = await counted(2 * feux.COST - 1, () => feux.feuxNow(cache(), NOW));
    expect(value).toBeNull();
    expect(asked).toEqual([]);

    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes("NOAA21") ? new Response("", { status: 500 }) : upstream(String(url))));
    const f = (await feux.feuxNow(cache(), NOW))!;
    expect(f.satellites).toEqual(["Suomi NPP", "NOAA-20"]);
  });

  it("go first in the hikers' answer near them, with the label and the emergency numbers", async () => {
    feux.configure("key");
    const r = body(await sentiersRandonnee(cache(), "Maïdo", NOW));
    expect(r.resume).toMatch(/^Feu de végétation détecté par satellite près de [^,]+, à 06:30 \(2 détections dans le secteur\) : détection satellite, faux positifs possibles\. Vous voyez un feu \? Appelez le 18 ou le 112\./);
    expect(r.feux_detectes.urgence).toBe(URGENCE);
    expect(r.feux_detectes.detections[0]).toMatchObject({ quand: "06:30", commune: "Saint-Paul", confiance: "forte", satellite: "NOAA-20" });
    expect(r.feux_detectes.detections[0].distance_km).toBeLessThan(10);
    expect(r.sources.map((s: { source: string }) => s.source)).toContain(feux.SOURCE.nom);
  });

  it("say a quiet day as such, without claiming there is no fire", async () => {
    feux.configure("key");
    vi.stubGlobal("fetch", async (url: string) => upstream(String(url), true));
    const r = body(await sentiersRandonnee(cache(), undefined, NOW));
    expect(r.feux_detectes.resume).toBe(QUIET);
    expect(r.feux_detectes.detections).toBeUndefined();
    expect(r.resume).not.toMatch(/feu/i);
  });

  it("add one line to the vigilance, only when something was seen", async () => {
    configureMf({ applicationId: "test" });
    const withVigilance = () => {
      const store = new MemoryStore();
      void store.put("vigilance", { value: { emise: "2026-10-24T02:00:00Z", zones: {}, suivi: [] }, fetchedAt: NOW.getTime() });
      return new Cache(store, () => NOW.getTime());
    };
    feux.configure("key");
    const r = body(await vigilanceMeteo(withVigilance(), undefined, NOW));
    expect(r.feux_detectes).toMatch(/^2 feux de végétation détectés par satellite ces dernières 24 h, le dernier près de .+ \(Saint-Paul\) à 06:30 : détection satellite, faux positifs possibles\. Vous voyez un feu \? Appelez le 18 ou le 112\./);
    vi.stubGlobal("fetch", async (url: string) => upstream(String(url), true));
    expect(body(await vigilanceMeteo(withVigilance(), undefined, NOW)).feux_detectes).toBeUndefined();
  });
});

describe("fires on the site", () => {
  const seen: feux.Feux = {
    satellites: ["NOAA-20"],
    detections: [
      { lat: -21.07, lon: 55.38, t: "2026-10-24T02:30:00Z", satellite: "NOAA-20", confiance: "forte", frp_mw: 12, lieu: "Le Maïdo", commune: "Saint-Paul" },
      { lat: -21.07, lon: 55.39, t: "2026-10-23T19:00:00Z", satellite: "NOAA-20", confiance: "faible", frp_mw: 2, lieu: "Le Maïdo", commune: "Saint-Paul" },
    ],
  };
  const sentiers = (f?: feux.Feux) => ({
    value: { resume: "", fermes_par_commune: [], routes_forestieres_fermees: [], a_savoir: [], sources: [], points: [], suivis: 351, randonnees: [], ...(f ? { feux: f } : {}) } as SentiersAnswer,
    fetchedAt: NOW,
    stale: false,
  });

  it("have their section on /sentiers, first when there are some, with the emergency numbers and the map's points", () => {
    const html = sentiersPage("https://rundata.re", sentiers(seen), NOW);
    expect(html).toContain('<h2 id="h-feux">Feux de végétation vus par satellite</h2>');
    expect(html).toContain("<p><b>Vous voyez un feu ? Appelez le 18 ou le 112.</b></p>");
    expect(html).toContain("Feu détecté près de Le Maïdo, à 06:30 · confiance forte");
    expect(html).toContain("Feu détecté près de Le Maïdo, hier à 23:00 · confiance faible");
    expect(html.indexOf('id="h-feux"')).toBeLessThan(html.indexOf('id="h-fermes"'));
    expect(html).toContain("chaque point orange un feu détecté par satellite (faux positifs possibles)");
    expect(html).toContain("#e8590c");
  });

  it("say a quiet day after the closed trails, and nothing at all without the key", () => {
    const quiet = sentiersPage("https://rundata.re", sentiers({ satellites: ["NOAA-20"], detections: [] }), NOW);
    expect(quiet).toContain("Aucun feu détecté par satellite ces dernières 24 h. Les nuages et les heures entre deux passages peuvent en masquer.");
    expect(quiet).toContain("Appelez le 18 ou le 112");
    expect(quiet.indexOf('id="h-feux"')).toBeGreaterThan(quiet.indexOf('id="h-fermes"'));
    const none = sentiersPage("https://rundata.re", sentiers(), NOW);
    expect(none).not.toContain("h-feux");
    expect(none).not.toContain("feux de végétation");
  });

  it("are on the commune's hiking tile, with the emergency numbers", () => {
    const hikes = { value: { randonnees: [], secteurs: [{ secteur: "Hauts de l'Ouest", communes: ["Saint-Paul"], sentiers: [{ k: "s1", nom: "Sentier du Maïdo", commune: "Saint-Paul", km: 3, etat: "ouvert", boucle: false, randonnees: [] }] }], lignes: [], fermes: 0, suivis: 1, sources: [], feux: seen } as RandonneesAnswer, fetchedAt: NOW, stale: false };
    const tile = communeHikes(pageOf("saint-paul")!, hikes, NOW)!;
    expect(tile.live!.detail).toMatch(/^2 feux détectés par satellite, le dernier à 06:30 \(faux positifs possibles\) · <b>Vous voyez un feu \? Appelez le 18 ou le 112\.<\/b> · sur 1 sentiers/);
    // A commune with no trail of the ONF still says its fire.
    const port = communeHikes(pageOf("le-port")!, { ...hikes, value: { ...hikes.value, feux: { satellites: [], detections: [{ ...seen.detections[0], commune: "Le Port" }] } } }, NOW)!;
    expect(port.live).toEqual({ valeur: "Feu détecté", detail: "feu détecté par satellite à 06:30 (faux positifs possibles) · <b>Vous voyez un feu ? Appelez le 18 ou le 112.</b>" });
    expect(communeHikes(pageOf("le-port")!, { ...hikes, value: { ...hikes.value, feux: undefined } }, NOW)).toBeUndefined();
  });
});
