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
import { feuxDescription, feuxPage } from "../src/web/feux.js";
import { site } from "../src/web/site.js";
import { communeHikes } from "../src/web/liens.js";
import { pageOf } from "../src/web/places.js";
import { deadAnchors, doubleIds, mapLinks } from "./cartes.js";

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
  const host = new URL(url).hostname;
  if (host === "firms.modaps.eosdis.nasa.gov") {
    asked.push(url);
    const source = Object.keys(FILES).find((s) => url.includes(`/${s}/`))!;
    return new Response(quiet ? fixture(FILES.VIIRS_SNPP_NRT) : fixture(FILES[source]));
  }
  if (host.endsWith(".arcgis.com")) {
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
    vi.stubGlobal("fetch", async (url: string) => (new URL(String(url)).pathname.includes("/VIIRS_NOAA21_NRT/") ? new Response("", { status: 500 }) : upstream(String(url))));
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

  it("lead from the map to their line, and each closed trail to its line on /sentiers", () => {
    const trail = { nom: "Sentier de la Glacière", lon: 55.42, lat: -21.05 };
    const s = sentiers(seen);
    s.value.points = [trail];
    // Across two communes, listed under each: one anchor, on the first.
    s.value.fermes_par_commune = [
      { commune: "Saint-Paul", sentiers_fermes: [{ sentier: trail.nom, cause: "éboulement" }] },
      { commune: "La Possession", sentiers_fermes: [{ sentier: trail.nom }] },
    ] as SentiersAnswer["fermes_par_commune"];
    const html = sentiersPage("https://rundata.re", s, NOW);
    expect(mapLinks(html).map((l) => l.href)).toEqual(["#t-sentier-de-la-glaciere", "#f-1", "#f-2"]);
    expect(mapLinks(html)[0].label).toBe("Sentier de la Glacière : sentier fermé, voir le détail");
    expect(mapLinks(html)[1].label).toMatch(/^Feu vu par satellite : Feu détecté près de Le Maïdo, à 06:30 · confiance forte[^"]*, voir le détail$/);
    expect(deadAnchors(html)).toEqual([]);
    expect(doubleIds(html)).toEqual([]);

    feux.configure("key");
    const page = feuxPage("https://rundata.re", { fires: { ...seen, fetchedAt: NOW }, sentiers: s }, NOW);
    expect(mapLinks(page).map((l) => l.href)).toEqual(["/sentiers#t-sentier-de-la-glaciere", "#f-1", "#f-2"]);
    expect(deadAnchors(page)).toEqual([]);
    expect(doubleIds(page)).toEqual([]);
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

describe("the fires' page", () => {
  const at = (t: string, lieu = "Le Maïdo"): feux.Detection => ({ lat: -21.07, lon: 55.38, t, satellite: "NOAA-20", confiance: "forte", frp_mw: 12, lieu, commune: "Saint-Paul" });
  const page = (path: string) => site(new Request(`https://rundata.re${path}`, { headers: { accept: "text/html" } }), cache(), () => {}, NOW);

  it("says how many, the newest and where, in its description, and never « 0 » when it could not see", () => {
    const two = { satellites: ["NOAA-20"], detections: [at("2026-10-24T02:30:00Z"), at("2026-10-23T19:00:00Z")] };
    expect(feuxDescription(two, NOW)).toBe("2 feux vus par satellite en 24 h à La Réunion (974), le dernier à 06:30 près de Le Maïdo. Faux positifs possibles. Un feu ? 18 ou 112.");
    expect(feuxDescription({ satellites: [], detections: [at("2026-10-23T19:00:00Z")] }, NOW)).toBe("1 feu vu par satellite en 24 h à La Réunion (974), hier à 23:00 près de Le Maïdo. Faux positifs possibles. Un feu ? 18 ou 112.");
    const long = feuxDescription({ satellites: [], detections: [at("2026-10-24T02:30:00Z", "Ravine des Chèvres et Grand Bassin du Bras de la Plaine"), at("2026-10-24T01:00:00Z")] }, NOW);
    expect(long).toBe("2 feux vus par satellite en 24 h à La Réunion (974), le dernier à 06:30. Faux positifs possibles. Un feu ? 18 ou 112.");
    expect(feuxDescription({ satellites: ["NOAA-20"], detections: [] }, NOW)).toMatch(/^Aucun feu détecté par satellite ces dernières 24 h à La Réunion \(974\)\./);
    expect(feuxDescription(null, NOW)).not.toMatch(/\b0\b|Aucun/);
  });

  it("without the key: says the detection is not active, stays out of the search engines and the sitemap", async () => {
    const html = await (await page("/feux"))!.text();
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain("La détection des feux par satellite n&#39;est pas encore active sur rundata.re.");
    expect(html).toContain("<b>Vous voyez un feu\u00a0? Appelez le 18 ou le 112.</b>");
    expect(html).not.toMatch(/Aucun feu|0 feu/);
    expect(asked).toEqual([]);
    expect(await (await page("/sitemap.xml"))!.text()).not.toContain("/feux");
  });

  it("with it: the map, the list, the closed trails and the vigilance, worded by marketing, and in the sitemap", async () => {
    feux.configure("key");
    const r = (await page("/feux"))!;
    const html = await r.text();
    expect(r.headers.get("cache-control")).toBe("public, max-age=60");
    expect(html).toContain("<title>Feux de forêt Réunion\u00a0: détections satellite 24\u00a0h · 974</title>");
    expect(html).toContain("<h1>Feux de végétation à La Réunion, vus par satellite</h1>");
    expect(html).not.toContain("noindex");
    expect(html).toContain('<meta name="description" content="2 feux vus par satellite en 24\u00a0h à La Réunion (974), le dernier à\u00a006:30 près de');
    expect(html).toContain('<h2 id="h-feux">Les feux des dernières 24\u00a0h</h2>');
    expect(html).toContain("Feu détecté près de");
    expect(html).toContain(`<h2 id="h-sentiers">Les sentiers fermés par l'ONF</h2>`);
    expect(html).toContain('<h2 id="h-vigilance">La vigilance Météo-France</h2>');
    expect(html).toContain("Votre IA, branchée sur les feux");
    expect(html).toContain("Na difé dann bwa\u00a0? Maïdo i brul\u00a0? Gèt si https://rundata.re/feux é di amwin ousa lé, é si néna santyé fèrmé.");
    expect(html).toContain("#e8590c");
    expect(await (await page("/sitemap.xml"))!.text()).toContain("<loc>https://rundata.re/feux</loc>");
    // The satellites not answering: said, not kept.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    const down = (await page("/feux"))!;
    expect(down.headers.get("cache-control")).toBe("no-store");
    const downHtml = await down.text();
    expect(downHtml).toContain("Le service de la NASA ne répond pas pour le moment\u00a0: rechargez la page dans quelques minutes.");
    expect(downHtml).toContain("<b>Vous voyez un feu\u00a0? Appelez le 18 ou le 112.</b>");
  });

  it("is linked from /sentiers and from a commune's tile when there is a fire", () => {
    const f: feux.Feux = { satellites: ["NOAA-20"], detections: [at("2026-10-24T02:30:00Z")] };
    const s = { value: { resume: "", fermes_par_commune: [], routes_forestieres_fermees: [], a_savoir: [], sources: [], points: [], suivis: 1, randonnees: [], feux: f } as SentiersAnswer, fetchedAt: NOW, stale: false };
    expect(sentiersPage("https://rundata.re", s, NOW)).toContain('<a href="/feux">La carte des feux des dernières 24 h →</a>');
    const hikes = { value: { randonnees: [], secteurs: [], lignes: [], fermes: 0, suivis: 0, sources: [], feux: f } as RandonneesAnswer, fetchedAt: NOW, stale: false };
    expect(communeHikes(pageOf("saint-paul")!, hikes, NOW)!.foot).toBe('<a href="/feux">Voir la carte des feux →</a>');
  });

  it("never logs the key", async () => {
    feux.configure("secret-key");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (url: string) => {
      throw new Error(`failed ${url}`);
    });
    expect(await feux.feuxNow(cache(), NOW)).toBeNull();
    expect(errors).toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret-key");
  });
});
