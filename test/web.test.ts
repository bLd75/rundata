import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failed, handle } from "../src/app.js";
import { stopPages } from "../src/providers/transit.js";
import { PAGE_BUDGET, count, counted, later, left } from "../src/budget.js";
import { Cache, MemoryStore, stampOf, TieredStore, type CacheEntry } from "../src/cache.js";
import { configure } from "../src/providers/mf-auth.js";
import * as mf from "../src/providers/vigilance.js";
import * as feux from "../src/providers/feux.js";
import { alerteOf, buildPlace, buildSea, type SeaData, snapshot, withoutForecast } from "../src/web/data.js";
import { buildSatellites, SATELLITES } from "../src/tools/mer.js";
import { homePage } from "../src/web/home.js";
import { communesPage } from "../src/web/commune.js";
import { VERSION } from "../src/server.js";
import { COVERAGE as SEA_COVERAGE } from "../src/tools/mer.js";
import { CSS, DESCRIPTION_MAX, FONT_PATH, meteoPage, placePage, seaPage, STYLE_PATH, vigilanceLive, vigilancePage } from "../src/web/pages.js";
import { PAGES, pageOf } from "../src/web/places.js";
import { htmlFor, isReader, site } from "../src/web/site.js";
import { unzip } from "../src/zip.js";
import { RANDONNEES, SENTIERS } from "../src/providers/traces.js";
import { SECTEURS as SECTEURS_RANDO } from "../src/traces/secteurs.js";
import { PASSES } from "../src/historique/cyclones-passes.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const NOW = new Date("2026-10-22T06:00:00Z");
const RUN = "2026-10-21T18.00.00Z";
const html = (path: string) => new Request(`https://rundata.re${path}`, { headers: { accept: "text/html" } });

function overLimit() {
  if (left() < 0) throw new Error("Too many subrequests by single Worker invocation");
}

/** The data center's cache, shared by the isolates there; each read or write is a subrequest. */
class EdgeLike extends MemoryStore {
  async get(key: string) {
    count();
    overLimit();
    return super.get(key);
  }
  async put(key: string, entry: CacheEntry) {
    count(1, true); // as the Worker's store (worker.ts): a write may use the part of the budget kept for writes
    return super.put(key, entry);
  }
}

/** As EdgeLike, counting the reads of each key. */
class ReadsByKey extends EdgeLike {
  reads = new Map<string, number>();
  async get(key: string) {
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
    return super.get(key);
  }
}

const isolate = (edge = new EdgeLike(), kv = new MemoryStore()) =>
  new Cache(new TieredStore(new MemoryStore(), edge), () => NOW.getTime(), false, kv);

function upstream(url: string): Response {
  if (url.includes("/token")) return Response.json({ access_token: "t", expires_in: 3600 });
  if (url.includes("DPPaquetObs")) return new Response(fixture("meteofrance_6min.csv"));
  if (url.includes("DPVigilance")) return new Response(fixture("vigilance_om.zip"));
  if (url.includes("aviationweather")) return new Response(fixture("metar.json"));
  if (url.endsWith("/live/all")) return new Response(fixture("pioupiou_all.json"));
  if (url.includes("pioupiou")) return Response.json({ data: JSON.parse(String(fixture("pioupiou_all.json"))).data[0] });
  if (url.includes("/thredds/dodsC/gridLEODYNRTL3SWW00/")) return new Response(fixture("acspo.ascii"));
  if (url.includes("erdMH1sstd1day")) return new Response(fixture("modis.csv"));
  if (url.includes("marine-api.open-meteo")) return new Response(fixture("openmeteo_houle.json"));
  if (new URL(url).hostname === "firms.modaps.eosdis.nasa.gov") return new Response(fixture("firms_viirs_noaa20.csv"));
  if (new URL(url).hostname.endsWith(".arcgis.com")) return new Response(fixture(`onf/${url.includes("/5/query") ? "sentiers" : url.includes("/4/query") ? "routes" : "couche"}.json`));
  if (url.includes("air-quality-api.open-meteo")) return new Response(fixture("cams_uv.json"));
  if (url.includes("open-meteo.com/data")) return new Response(fixture("openmeteo_meta.json"));
  if (url.includes("open-meteo")) return new Response(fixture("openmeteo_cilaos.json"));
  if (url.includes("api-lannuaire")) {
    // The fixture holds the town halls of the whole island; the API answers for the commune asked.
    const insee = decodeURIComponent(url).match(/code_insee_commune="(\d+)"/)?.[1];
    const all = JSON.parse(String(fixture("annuaire_mairie.json")));
    return Response.json({ ...all, results: all.results.filter((r: { code_insee_commune: string }) => !insee || r.code_insee_commune === insee) });
  }
  if (url.includes("GetCapabilities")) return new Response(`<x>TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___${RUN}</x>`);
  if (url.includes("GetCoverage")) {
    const tif = url.includes("PRESSURE__GROUND") ? "ps" : url.includes("MEAN_SEA_LEVEL") ? "pmsl" : "t2m";
    return new Response(fixture(`arome/${tif}.tif`));
  }
  throw new Error(`unexpected ${url}`);
}

beforeEach(() => {
  configure({ applicationId: "test" });
  vi.stubGlobal("fetch", async (url: string) => {
    overLimit();
    return upstream(String(url));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  configure({});
});

/** A page as a Worker serves it: counted, background work awaited within the same invocation. */
async function serve(cache: Cache, path: string) {
  const pending: Promise<unknown>[] = [];
  const { value, used } = await counted(PAGE_BUDGET, async () => {
    const r = (await site(html(path), cache, (p) => pending.push(p), NOW))!;
    await Promise.all(pending);
    return r;
  });
  return { r: value, text: await value.text(), used };
}

describe("the budget of subrequests", () => {
  /** As the Worker serves it: the work after the response awaited, its subrequests counted against `budget`. */
  async function within(cache: Cache, path: string, budget: number) {
    const { value, settled } = await counted(budget, () => handle(html(path), cache, later));
    const total = await settled();
    return { status: value.status, text: await value.text(), ...total };
  }
  const PATHS = ["/", "/meteo", "/vigilance", "/mer", "/aujourdhui/saint-leu", "/communes", "/communes/saint-paul", "/communes/petite-ile", `/meteo/${PAGES[0].slug}`, "/evenements", "/trafic", "/actualites", "/sport", "/bus", "/randonnees", "/presse"];

  it("never goes past it, the work after the response included, and every page still answers", async () => {
    for (const budget of [0, 6, 18]) {
      const cache = isolate();
      for (const path of PATHS) {
        const r = await within(cache, path, budget);
        expect(r.status, `${path} with ${budget}`).toBeLessThan(500);
        expect(r.text, `${path} with ${budget}`).toContain("</html>");
        expect(r.used, `${path} with ${budget}`).toBeLessThanOrEqual(budget);
      }
    }
  });

  it("stays within it with the fires seen by satellite, cold, on the pages that build them", async () => {
    feux.configure("key");
    try {
      for (const budget of [0, 6, 18, PAGE_BUDGET]) {
        const cache = isolate();
        for (const path of ["/sentiers", "/randonnees", "/feux", "/communes/saint-paul", "/vigilance"]) {
          const r = await within(cache, path, budget);
          expect(r.status, `${path} with ${budget}`).toBeLessThan(500);
          expect(r.used, `${path} with ${budget}`).toBeLessThanOrEqual(budget);
        }
      }
      const r = await within(isolate(), "/sentiers", PAGE_BUDGET);
      expect(r.text).toContain('<h2 id="h-feux">Feux de végétation vus par satellite</h2>');
    } finally {
      feux.configure(undefined);
    }
  });

  it("serves a commune's page cold, with its forecast, within it", async () => {
    const r = await within(isolate(), "/communes/saint-paul", PAGE_BUDGET);
    expect(r.status).toBe(200);
    expect(r.used + r.refused).toBeGreaterThan(0);
    expect(r.used).toBeLessThanOrEqual(PAGE_BUDGET);
  });
});

describe("home page", () => {
  it("renders the live block from the stations, within the Worker's subrequests, and then from cache", async () => {
    const edge = new EdgeLike();
    const cold = await serve(isolate(edge), "/");
    expect(cold.r.headers.get("cache-control")).toBe("public, max-age=60");
    expect(cold.text).toContain("<h1>La Réunion <span class=\"n974\">974</span> en direct</h1>");
    // The hero's island carries the temperatures measured now.
    // Each temperature leads to its station's row on the weather page; its bubble, said the same way to a screen
    // reader, gives the station, its altitude, the value to the tenth, and when and by whom it was measured.
    expect(cold.text).toMatch(/<figure class="hero-map"><svg class="map relief" viewBox="[^"]+" role="group"[^]*?<a class="mk" href="\/meteo#st-[a-z0-9-]+" aria-label="[^"]+ · [\d\u202f]+\u202fm : \d+(,\d)?\u202f°C, mesurée à\u00a0\d\d:\d\d par [^"]+, voir le détail" data-tp="[^"]+ · [\d\u202f]+\u202fm" data-tv="\d+(,\d)?\u202f°C" data-td="mesurée à\u00a0\d\d:\d\d par [^"]+"><circle class="hit"[^>]+\/><title>[^<]+<\/title><circle class="sh"/);
    expect(cold.text).toContain('<a class="mtip" data-mtip hidden aria-hidden="true" tabindex="-1" href="/meteo">');
    expect(cold.text).toMatch(/meteo_actuelle\(lieu: "[^"]+"\)<\/p>\s*<p class="bubble ai">\d+(,\d)?\u202f°C, mesurés à\u00a0\d\d:\d\d/);
    expect(cold.text).toContain("Piton Maïdo");
    expect(cold.text).toMatch(/mesuré à\u00a0\d\d:\d\d/);
    // The badge says when the stations measured, never « en direct » at a time already past; the script counts the age
    // again in the browser, from the time of the data.
    expect(cold.text).not.toContain("En direct · <b>");
    expect(cold.text).toMatch(/<span data-nojs>Mesures de <b>\d\d:\d\d<\/b> à La Réunion<\/span><span data-js hidden><b data-clock>\d\d:\d\d<\/b> à La Réunion · mesuré <span data-age="[\dT:.-]+Z">il y a \d+\u00a0(min|h)<\/span>/);
    expect(cold.used).toBeLessThanOrEqual(PAGE_BUDGET);
    // Another isolate of the same data center: the weather from the edge, and the oldest of the other tiles brought up
    // to date afterwards, still within the limit.
    const warm = await serve(isolate(edge), "/");
    expect(warm.text).toContain("Piton Maïdo");
    expect(warm.used).toBeLessThanOrEqual(PAGE_BUDGET);
  });

  it("takes the sea from the copy of /mer, however old, and never asks the satellites itself, nor does a place on the coast", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      overLimit();
      asked.push(String(url));
      return upstream(String(url));
    });
    const satellites = () => asked.filter((u) => u.includes("/thredds/") || u.includes("/erddap/"));
    // No copy of /mer yet: the page goes without the sea rather than ask NOAA.
    const bare = await serve(isolate(), "/meteo");
    expect(bare.text).toContain("Piton Maïdo");
    expect(bare.text).not.toContain("Par satellite, le");
    expect(satellites()).toEqual([]);
    // The grids the scheduled event shared, and the copy of /mer it made from them three hours ago: Saint-Leu's reading
    // of 19 October.
    const edge = new EdgeLike();
    await edge.put(SATELLITES, { value: (await counted(PAGE_BUDGET, () => buildSatellites(isolate(), NOW))).value, fetchedAt: NOW.getTime() - 3600_000 });
    asked.length = 0;
    const sea = (await counted(PAGE_BUDGET, () => buildSea(isolate(edge), NOW))).value;
    expect(satellites()).toEqual([]);
    const leu = sea.plages.find((b) => b.nom === "Saint-Leu")!;
    Object.assign(leu, { valeur: 26.4, jour: "2026-10-19" });
    for (const b of sea.plages) if (b !== leu && b.jour) b.jour = "2026-10-18";
    await edge.put("web:mer", { value: sea, fetchedAt: NOW.getTime() - 3 * 3600_000 });
    const { text } = await serve(isolate(edge), "/meteo");
    expect(text).toMatch(/<li><span>Saint-Leu<\/span><b>26,4[^<]*°C<\/b><\/li>/);
    expect(text).toContain("Par satellite, le 19/10.");
    expect(satellites()).toEqual([]);
    // The page of a place on the coast reads the shared grids too.
    const place = await serve(isolate(edge), "/meteo/saint-leu");
    expect(place.text).toMatch(/Au large, le \d\d\/10/);
    expect(satellites()).toEqual([]);
  });

  it("never asks the satellites from /mer either, when its copy is rebuilt after a view", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      overLimit();
      asked.push(String(url));
      return upstream(String(url));
    });
    const satellites = () => asked.filter((u) => u.includes("/thredds/") || u.includes("/erddap/"));
    // Without the shared grids, and with them three hours old beside a copy of /mer as old: the page is rebuilt from them.
    expect((await serve(isolate(), "/mer")).text).toContain("Boucan-Canot");
    expect(satellites()).toEqual([]);
    const grids = (await counted(PAGE_BUDGET, () => buildSatellites(isolate(), NOW))).value;
    asked.length = 0;
    const edge = new EdgeLike();
    await edge.put(SATELLITES, { value: grids, fetchedAt: NOW.getTime() - 3 * 3600_000 });
    await edge.put("web:mer", { value: { plages: [], sources: [] }, fetchedAt: NOW.getTime() - 3 * 3600_000 });
    const cache = isolate(edge);
    await serve(cache, "/mer");
    expect((await cache.peek<SeaData>("web:mer"))!.value.plages.some((b) => b.valeur != null)).toBe(true);
    expect(satellites()).toEqual([]);
  });

  it("keeps the last copy's readings, with their day, while the satellites' grids are not shared yet", async () => {
    // Right after the deploy that shares them: the scheduled event has not built them yet, and a view rebuilds /mer.
    const edge = new EdgeLike();
    const old: SeaData = { plages: [{ nom: "Saint-Leu", commune: "Saint-Leu", lon: 55.28, lat: -21.17, valeur: 25.1, jour: "2026-10-20", distance_km: 0.3 }], sources: [{ source: "Température de surface de la mer par satellite (NOAA ACSPO L3S)", licence: "Domaine public (NOAA)", attribution: "NOAA" }] };
    await edge.put("web:mer", { value: old, fetchedAt: NOW.getTime() - 3 * 3600_000 });
    const cache = isolate(edge);
    await serve(cache, "/mer");
    const sea = (await cache.peek<SeaData>("web:mer"))!;
    expect(sea.fetchedAt.getTime()).toBe(NOW.getTime());
    expect(sea.value.plages.find((b) => b.nom === "Saint-Leu")).toMatchObject({ valeur: 25.1, jour: "2026-10-20", houle: expect.anything() });
    expect(sea.value.sources.map((s) => s.source)).toContain(old.sources[0].source);
  });

  it("reads no tile from the data center's cache on a warm isolate whose copies are fresh", async () => {
    // Every tile's copy fresh in the data center's cache, as other isolates left them, and the weather's too.
    const edge = new ReadsByKey();
    for (const key of ["web:meteo", "web:actualites", "web:volcan", "web:air", "web:electricite", "web:calendrier", "web:bus", "web:trafic", "web:velos", "web:bornes", "web:eau", "web:sentiers", "web:secheresse", "web:coupures", "web:sport", "web:cyclones", "web:historique", "web:agenda", "web:crues"]) {
      await edge.put(key, { value: {}, fetchedAt: NOW.getTime() });
    }
    const cache = isolate(edge);
    // These copies are empty: the page is served without them (site.ts), only the reads matter here.
    await serve(cache, "/");
    // The weather's build reads the copy of /mer for the sea, as a source and not as a tile.
    const tileReads = () => [...edge.reads].filter(([k]) => k.startsWith("web:") && k !== "web:meteo" && k !== "web:mer").reduce((a, [, n]) => a + n, 0);
    expect(tileReads()).toBe(18);
    // The same isolate a minute later: the tiles from its memory.
    edge.reads.clear();
    await serve(cache, "/");
    expect(tileReads()).toBe(0);
  });

  it("reads a page's copy from the data center's cache once, also when it is old and refreshed", async () => {
    const edge = new ReadsByKey();
    await isolate(edge).get("web:meteo", 3600, async () => ({ vieille: true }));
    // An hour later in a new isolate: the copy is served, then built again after the response.
    await edge.put("web:meteo", { value: (await edge.get("web:meteo"))!.value, fetchedAt: NOW.getTime() - 3600_000 });
    edge.reads.clear();
    const pending: Promise<unknown>[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await snapshot(isolate(edge), "web:meteo", async () => ({ neuve: true }), (p) => pending.push(p), NOW);
    await Promise.all(pending);
    errors.mockRestore();
    expect(edge.reads.get("web:meteo")).toBe(1);
    expect((await edge.get("web:meteo"))!.value).toEqual({ neuve: true });
  });

  it("still explains everything when no data is there yet", () => {
    const page = homePage("https://rundata.re", null, NOW);
    expect(page).toContain("Se met à jour");
    expect(page).toContain("https://rundata.re/mcp");
    expect(page).toContain('<link rel="canonical" href="https://rundata.re/">');
    const ld = page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1];
    expect(JSON.parse(ld).map((x: { "@type": string }) => x["@type"])).toEqual(["WebSite", "Organization", "SoftwareApplication"]);
    // Every category: a tile, and a link in the menu.
    for (const name of ["Météo", "Vigilance", "Mer", "Volcan", "Bus", "Air", "Électricité", "Calendrier", "Services publics", "Terrain et risques"]) {
      expect(page).toContain(`${name}</`);
    }
    expect(page).toContain('<li><a href="/electricite">Électricité</a></li>');
    // The menu: every category, with its icon, the current one marked.
    expect(meteoPage("https://rundata.re", null, NOW)).toMatch(/<a class="k-meteo" href="\/meteo" aria-current="page"><span class="kb"><svg[^]*?<\/svg><\/span><span class="gn">Météo<\/span><\/a>/);
    expect(placePage("https://rundata.re", pageOf("cilaos")!, null, NOW)).toMatch(/<a class="k-meteo" href="\/meteo" aria-current="page">/);
    expect(page).toMatch(/<a class="k-velos" href="\/velos"><span class="kb">/);
  });

  it("tells ChatGPT users how to refresh the list of tools it keeps", () => {
    const page = homePage("https://rundata.re", null, NOW);
    for (const words of ["<b>Des outils manquent ?</b>", "<b>Paramètres → Intégrations → Plugins</b>", "<b>Actualiser les outils</b>", "<b>Supprimer l'application</b>"]) expect(page).toContain(words);
  });

  it("carries the tags that link previews read", () => {
    const page = homePage("https://rundata.re", null, NOW);
    for (const tag of ['property="og:image" content="https://rundata.re/og.png?v=', 'property="og:image:width" content="1200"',
      'name="twitter:card" content="summary_large_image"', 'property="og:locale" content="fr_FR"']) expect(page).toContain(tag);
    expect(page.match(/<title>(.*?)<\/title>/)![1].length).toBeLessThanOrEqual(65);
    // The title names what people look for; the AI stays in the h1 and the description.
    expect(page).toContain("<title>La Réunion 974 en direct : météo, routes, rando, sorties</title>");
    expect(page).toContain('property="og:title" content="La Réunion 974 en direct : météo, routes, rando, sorties"');
    expect(page).toMatch(/name="description" content="[^"]*974/);
    for (const link of ["https://www.facebook.com/rundata.re", "https://www.instagram.com/rundata.re/", "https://www.whatsapp.com/channel/0029VbEDFav5Ui2agqGyG63Q", "https://glama.ai/mcp/servers/rundata-re/rundata", "https://github.com/rundata-re/rundata", "https://www.data.gouv.fr/reuses/"]) expect(page).toContain(`href="${link}`);
  });

  it("keep every description within what search engines show", () => {
    const desc = (html: string) => html.match(/name="description" content="([^"]*)"/)![1].replace(/&#39;|&amp;|&quot;/g, "'");
    const pages = [homePage("https://rundata.re", null, NOW), seaPage("https://rundata.re", null, NOW), meteoPage("https://rundata.re", null, NOW),
      ...PAGES.map((p) => placePage("https://rundata.re", p, null, NOW))];
    for (const page of pages) expect(desc(page).length, desc(page)).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});

describe("place pages", () => {
  it("one per commune and per famous place, all resolved", () => {
    expect(PAGES.filter((p) => p.commune)).toHaveLength(24);
    expect(pageOf("cilaos")?.place.nom).toBe("Cilaos");
    expect(pageOf("piton-de-la-fournaise")?.place.altitude_m).toBeGreaterThan(2000);
    expect(new Set(PAGES.map((p) => p.slug)).size).toBe(PAGES.length);
  });

  it("show the measurement and the labelled forecast cold within the budget, and warm from one read", async () => {
    const edge = new EdgeLike();
    const cold = await serve(isolate(edge), "/meteo/cilaos");
    expect(cold.text).toContain("<h1>Météo à Cilaos <span class=\"n974\">974</span></h1>");
    expect(cold.text).toContain("Mesuré en ce moment près de Cilaos");
    expect(cold.text).not.toContain("Température de la mer à Cilaos");
    expect(cold.used).toBeLessThanOrEqual(PAGE_BUDGET);
    // Cold, the budget holds the stations and the forecast too (FORECAST_MIN_LEFT in web/data.ts no longer bites).
    expect(cold.text).toContain("Prévision, pas une mesure");
    const next = await counted(PAGE_BUDGET, () => buildPlace(isolate(edge), pageOf("cilaos")!, NOW));
    expect(next.used).toBeLessThanOrEqual(PAGE_BUDGET);
    const built = placePage("https://rundata.re", pageOf("cilaos")!, { value: next.value, fetchedAt: NOW, stale: false }, NOW);
    expect(built).toContain("Mesuré en ce moment près de Cilaos");
    expect(built).toContain("Prévision, pas une mesure");
    // The UV index of each day, from its own forecast (CAMS), credited with the others.
    expect(built).toMatch(/<p>UV : \d+ \((faible|modéré|élevé|très élevé|extrême)\)<\/p>/);
    expect(built).toContain("Indice UV prévu par le service Copernicus");
    const warm = await serve(isolate(edge), "/meteo/cilaos");
    // Its copy, the vigilance, the hikers' page's copy for the state of the hikes around, and the volcano's banner.
    expect(warm.used).toBeLessThanOrEqual(4);
  });

  it("give the sea temperature on the coast", async () => {
    const { text, used } = await serve(isolate(), "/meteo/saint-leu");
    expect(text).toContain("Température de la mer à Saint-Leu");
    expect(used).toBeLessThanOrEqual(PAGE_BUDGET);
  });

  it("answer an unknown place with a 404 that links to the others", async () => {
    const r = (await site(html("/meteo/paris"), isolate(), () => {}, NOW))!;
    expect(r.status).toBe(404);
    const text = await r.text();
    expect(text).toContain('href="/meteo/saint-denis"');
    expect(text).toContain('<ul class="chips"><li><a href="/meteo">Météo</a></li>');
  });
});

describe("commune pages", () => {
  it("give every category for the commune, cold within the limit, warm from a few reads", async () => {
    const edge = new EdgeLike();
    const cold = await serve(isolate(edge), "/communes/saint-leu");
    expect(cold.r.status).toBe(200);
    expect(cold.text).toContain(`<h1>Saint-Leu <span class="n974">974</span> en direct</h1>`);
    expect(cold.text).toMatch(/<h3><a href="\/meteo\/saint-leu">Météo<\/a><\/h3><p class="tv">\d+(,\d)?\u202f°C<\/p>/);
    expect(cold.text).toContain("est dans la zone Ouest");
    expect(cold.text).toMatch(/<h3>Mairie<\/h3><p class="tv">(Ouverte|Fermée)<\/p>/);
    expect(cold.text).toContain("Mer"); // on the coast
    expect(cold.used).toBeLessThanOrEqual(PAGE_BUDGET);
    const warm = await serve(isolate(edge), "/communes/saint-leu");
    expect(warm.text).toMatch(/<h3>Mairie<\/h3><p class="tv">(Ouverte|Fermée)<\/p>/);
    // One read per tile's copy, the hikes and the outings included, and the volcano's banner.
    expect(warm.used).toBeLessThanOrEqual(18);
  });

  it("have their day on a page of its own, cold within the limit, warm from a few reads", async () => {
    const edge = new EdgeLike();
    const cold = await serve(isolate(edge), "/aujourdhui/saint-leu");
    console.log("DEBUG used", cold.used, (cold.text.match(/<section[^>]*>[^]{0,300}/g) ?? []).slice(0, 3).join("\n---\n"));
    expect(cold.r.status).toBe(200);
    expect(cold.text).toContain("<h1>Aujourd&#39;hui à Saint-Leu</h1>");
    expect(cold.text).toContain('<link rel="canonical" href="https://rundata.re/aujourdhui/saint-leu">');
    expect(cold.text).toContain('href="/communes/saint-leu"');
    // The weather is built at once; the rest only read, and named with its page while it has no copy.
    expect(cold.text).toMatch(/mesurés à\u00a0\d\d:\d\d par la station/);
    expect(cold.text).toContain("rundata.re ne mesure pas les bouchons");
    expect(cold.text).toMatch(/Pas de copie récente pour\u00a0: .*<a href="\/coupures-eau\/saint-leu">coupures d&#39;eau<\/a>/);
    expect(cold.used).toBeLessThanOrEqual(PAGE_BUDGET);
    // Another isolate: a read for each copy and the vigilance, and the oldest copy missing brought up to date when it fits.
    const warm = await serve(isolate(edge), "/aujourdhui/saint-leu");
    expect(warm.used).toBeLessThanOrEqual(20);
    expect((await serve(isolate(), "/aujourdhui/maido")).r.status).toBe(404);
    expect((await serve(isolate(edge), "/communes/saint-leu")).text).toContain('<a class="btn glass" href="/aujourdhui/saint-leu">Aujourd&#39;hui à Saint-Leu\u00a0: le résumé de la journée →</a>');
  });

  it("leave the sea out in the Hauts, and only exist for the 24 communes", async () => {
    const { text } = await serve(isolate(), "/communes/cilaos");
    expect(text).not.toContain(`<h3><a href="/mer">Mer</a></h3>`);
    for (const path of ["/communes/maido", "/communes/paris"]) {
      expect((await site(html(path), isolate(), () => {}, NOW))!.status).toBe(404);
    }
  });

  it("are listed by zone, and linked from the menu, the home page and the weather pages", async () => {
    const list = (await serve(isolate(), "/communes")).text;
    expect(list.match(/<li><a href="\/communes\/[a-z-]+"/g)).toHaveLength(24);
    expect(list).toContain(`<a class="k-communes" href="/communes" aria-current="page">`);
    expect(homePage("https://rundata.re", null, NOW)).toContain(`href="/communes/saint-paul"`);
    expect((await serve(isolate(), "/meteo/saint-paul")).text).toContain(`href="/communes/saint-paul"`);
    // Its water, on its own page.
    expect((await serve(isolate(), "/communes/saint-paul")).text).toContain(`<h3><a href="/coupures-eau/saint-paul">Eau</a></h3>`);
  });
});

describe("what crawlers and previews fetch", () => {
  it("serves /chiffres from the code before any copy, its counts of the sources left out", async () => {
    const r = await handle(new Request("https://rundata.re/chiffres"), isolate());
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("<h1>rundata.re en chiffres</h1>");
    expect(html).toContain("sources publiques lues");
    expect(html).not.toContain("stations météo lues");
  });

  it("robots.txt points to the sitemap, which lists every page", async () => {
    const robots = await (await handle(new Request("https://rundata.re/robots.txt"), isolate())).text();
    expect(robots).toContain("Sitemap: https://rundata.re/sitemap.xml");
    const map = await (await handle(new Request("https://rundata.re/sitemap.xml"), isolate())).text();
    // The pages, the 24 communes, their water, their day and their places for children, a page per hike and per ONF trail with its GPS trace, and per past
    // cyclone, and the busiest bus stops.
    const stops = [...stopPages().values()].filter((p) => p.indexe);
    expect(map.match(/<loc>/g)).toHaveLength(PAGES.length + 55 + 24 + 24 + 24 + 24 + SECTEURS_RANDO.length + RANDONNEES.length + Object.keys(SENTIERS).length + PASSES.length + stops.length);
    expect(map).toContain(`<loc>https://rundata.re/bus/arret/${stops[0].slug}</loc>`);
    expect(map).toContain("<loc>https://rundata.re/enfants</loc>");
    expect(map).toContain("<loc>https://rundata.re/sites-sans-reponse</loc>");
    expect(map).toContain("<loc>https://rundata.re/chiffres</loc>");
    expect(map).toContain("<loc>https://rundata.re/randonnees/sentier-du-piton-des-neiges</loc>");
    expect(map).toContain("<loc>https://rundata.re/sentiers/le-bloc-piton-des-neiges</loc>");
    expect(map).toContain("<loc>https://rundata.re/communes</loc>");
    expect(map).toContain("<loc>https://rundata.re/communes/saint-paul</loc>");
    expect(map).toContain("<loc>https://rundata.re/meteo</loc>");
    expect(map).toContain("<loc>https://rundata.re/volcan</loc>");
    expect(map).toContain("<loc>https://rundata.re/bornes</loc>");
    expect(map).toContain("<loc>https://rundata.re/confidentialite</loc>");
    expect(map).toContain("<loc>https://rundata.re/baignade</loc>");
    expect(map).toMatch(/<loc>https:\/\/rundata.re\/nouveautes<\/loc><lastmod>\d{4}-\d\d-\d\d<\/lastmod>/);
    expect(map).toContain("<loc>https://rundata.re/vigilance</loc>");
    expect(map).toContain("<loc>https://rundata.re/meteo/cilaos</loc><changefreq>hourly</changefreq>");
  });

  it("serves the privacy policy and the terms, linked from every page's footer", async () => {
    for (const path of ["/confidentialite", "/conditions"]) {
      const r = await handle(new Request(`https://rundata.re${path}`), isolate());
      expect(r.status).toBe(200);
      const html = await r.text();
      expect(html).toContain(`<link rel="canonical" href="https://rundata.re${path}">`);
      expect(html).toContain('href="/confidentialite"');
      expect(html).toContain("contact@rundata.re");
    }
  });

  it("says the service is free, not that it is non-commercial, in the terms", async () => {
    const html = await (await handle(new Request("https://rundata.re/conditions"), isolate())).text();
    expect(html).toContain("rundata.re est un service gratuit\u00a0: un site et un connecteur MCP");
    expect(html).not.toContain("non commercial");
  });

  // Files of public/, served by Cloudflare before the Worker (no request billed), with the headers of public/_headers.
  const asset = (path: string) => new Uint8Array(readFileSync(new URL(`../public${path}`, import.meta.url)));
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");

  it("has a 1200×630 PNG for link previews, and the flag as favicon", async () => {
    const png = asset("/og.png");
    expect(png.length).toBeLessThan(300_000);
    const view = new DataView(png.buffer);
    expect([view.getUint32(0), view.getUint32(16), view.getUint32(20)]).toEqual([0x89504e47, 1200, 630]);
    expect(headers).toContain("/og.png\n  Cache-Control: public, max-age=604800\n");
    // Not in the Worker any more: Cloudflare answers before it.
    expect(await site(new Request("https://rundata.re/og.png"), new Cache(), () => {})).toBeNull();
    const icon = await handle(new Request("https://rundata.re/favicon.svg"), isolate());
    expect(await icon.text()).toContain("#e3262d");
  });

  it("lays the island's relief under the hero map, a WebP kept for good", async () => {
    const page = homePage("https://rundata.re", null);
    const path = page.match(/<image href="(\/relief-[0-9a-f]{8}\.webp)"/)?.[1];
    expect(path).toBeDefined();
    const webp = asset(path!);
    expect(new TextDecoder().decode(webp.slice(8, 12))).toBe("WEBP");
    expect(webp.length).toBeLessThan(250_000);
    expect(headers).toContain("/relief-*\n  Cache-Control: public, max-age=31536000, immutable\n");
    expect(await site(new Request(`https://rundata.re${path}`), new Cache(), () => {})).toBeNull();
  });

  it("has the headings' font where the pages ask for it, kept for good", async () => {
    const woff2 = asset(FONT_PATH);
    expect(new TextDecoder().decode(woff2.slice(0, 4))).toBe("wOF2");
    expect(woff2.length).toBeLessThan(80_000);
    expect(headers).toContain("/font/*\n  Cache-Control: public, max-age=31536000, immutable\n");
    expect(await site(new Request(`https://rundata.re${FONT_PATH}`), new Cache(), () => {})).toBeNull();
  });

  it("serves the stylesheet apart, kept a year at its address, and no page copies it any more", async () => {
    const page = homePage("https://rundata.re", null);
    expect(page).toContain(`<link rel="stylesheet" href="${STYLE_PATH}">`);
    expect(page).not.toContain("<style");
    expect(STYLE_PATH).toMatch(/^\/style-[0-9a-z]+\.css$/);
    const res = await handle(new Request(`https://rundata.re${STYLE_PATH}`), isolate());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe(CSS);
    // A page of an earlier version (a copy kept offline, a version still rolling out) gets today's, a few minutes only.
    const old = await site(new Request("https://rundata.re/style-0.css"), new Cache(), () => {});
    expect(old!.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await old!.text()).toBe(CSS);
    // Its only address, the font's, is absolute: read the same from the file as from the page.
    expect([...CSS.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1])).toEqual([FONT_PATH]);
  });

  it("gives command-line clients one line and crawlers the page", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const curl = await handle(new Request("https://rundata.re/", { headers: { "user-agent": "curl/8.5", accept: "*/*" } }), new Cache());
    expect(await curl.text()).toContain("Point d'accès MCP : https://rundata.re/mcp");
    const bot = await handle(new Request("https://rundata.re/", { headers: { "user-agent": "Googlebot/2.1", accept: "*/*" } }), new Cache());
    expect(bot.headers.get("content-type")).toContain("text/html");
  });
});

describe("page data", () => {
  it("builds a place's copy again a minute on when it lacks its forecast, not after five", async () => {
    let t = NOW.getTime();
    const cache = new Cache(new TieredStore(new MemoryStore(), new MemoryStore()), () => t, false);
    let builds = 0;
    // Cold, the forecast did not fit; every later build has it.
    const build = async () => (builds++ ? { meteo: {}, prevision: { jours: [] } } : { meteo: {} });
    const view = async () => {
      const pending: Promise<unknown>[] = [];
      const got = await snapshot(cache, "web:lieu:essai", build, (p) => pending.push(p), new Date(t), undefined, false, withoutForecast);
      await Promise.all(pending);
      return got;
    };
    expect((await view())!.value).not.toHaveProperty("prevision");
    // Thirty seconds on: as it is.
    t += 30_000;
    await view();
    expect(builds).toBe(1);
    // A minute and a half on: built again after the response, and the next view has the forecast.
    t += 60_000;
    await view();
    expect(builds).toBe(2);
    expect((await view())!.value).toHaveProperty("prevision");
    // Complete, it waits the usual five minutes.
    t += 90_000;
    await view();
    expect(builds).toBe(2);
  });

  it("is sent without its live block when it takes too long, and finished in the background", async () => {
    const c = new Cache(new MemoryStore(), () => NOW.getTime());
    const later: Promise<unknown>[] = [];
    const slow = () => new Promise<number>((r) => setTimeout(() => r(42), 30));
    expect(await snapshot(c, "k", slow, (p) => later.push(p), NOW, 5)).toBeNull();
    await Promise.all(later);
    expect((await snapshot(c, "k", slow, () => {}, NOW, 5))?.value).toBe(42);
  });

  it("built before its family's revision was raised, is built again at the first view after the deploy, not served", async () => {
    const store = new MemoryStore();
    // Stamped with a revision older than any in web/revisions.ts.
    await store.put("web:agenda", { value: "ancienne", fetchedAt: NOW.getTime() - 60_000, version: "rendu-0" });
    const c = new Cache(store, () => NOW.getTime(), false, undefined, "2.0.0");
    expect((await snapshot(c, "web:agenda", async () => "nouvelle", () => {}, NOW))?.value).toBe("nouvelle");
  });

  // 29/10/2026: « L'actualité se charge : rechargez la page » on /actualites at the first view after the deploy of #471,
  // which raised its revision, its copy of 3 minutes before still there.
  describe("built again after a deploy, too long for the wait", () => {
    const slow = () => new Promise<string>((r) => setTimeout(() => r("nouvelle"), 30));
    /** A view of a page whose copy, if any, is `ageMs` old and stamped `version`, then the view after its build. */
    async function views(ageMs?: number, version?: string) {
      const store = new MemoryStore();
      if (ageMs != null) await store.put("web:lieu:essai", { value: "ancienne", fetchedAt: NOW.getTime() - ageMs, ...(version && { version }) });
      const c = new Cache(store, () => NOW.getTime(), false, undefined, "2.0.0");
      const later: Promise<unknown>[] = [];
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const first = await snapshot(c, "web:lieu:essai", slow, (p) => later.push(p), NOW, 5);
      const said = log.mock.calls.map((x) => String(x[0])).filter((x) => x.startsWith("copie ancienne"));
      log.mockRestore();
      await Promise.all(later);
      return { first, said, next: (await snapshot(c, "web:lieu:essai", slow, () => {}, NOW, 5))?.value };
    }

    it("serves the copy of another revision as it is, said in the log and not kept, its build going on behind", async () => {
      const { first, said, next } = await views(3 * 60_000, "rendu-0");
      expect(first).toMatchObject({ value: "ancienne", outdated: true });
      // Its time, as the page says it (« Mis à jour à … »): the copy's, not the view's.
      expect(first!.fetchedAt.getTime()).toBe(NOW.getTime() - 3 * 60_000);
      expect(htmlFor(first)["cache-control"]).toBe("no-store");
      expect(said).toEqual([`copie ancienne servie pendant la construction : web:lieu:essai, révision rendu-0→${stampOf("web:lieu:essai", "2.0.0")}, âge 3 min`]);
      expect(next).toBe("nouvelle");
      // A copy written before the stamps were kept: the same, said « sans ».
      expect((await views(20 * 60_000)).said).toEqual([`copie ancienne servie pendant la construction : web:lieu:essai, révision sans→${stampOf("web:lieu:essai", "2.0.0")}, âge 20 min`]);
      // A page from its own fresh copy is kept, as before.
      expect(htmlFor({ value: 1, fetchedAt: NOW, stale: false })["cache-control"]).toBe("public, max-age=60");
    });

    it("does not serve a copy more than 24 hours old: what its page says in the present would be wrong", async () => {
      for (const version of ["rendu-0", stampOf("web:lieu:essai", "2.0.0")]) {
        const { first, said, next } = await views(25 * 3600_000, version);
        expect(first, version).toBeNull();
        expect(said).toEqual([]);
        expect(next).toBe("nouvelle");
      }
    });

    it("says the page is loading when there is no copy at all, as before", async () => {
      const { first, said, next } = await views();
      expect(first).toBeNull();
      expect(said).toEqual([]);
      expect(next).toBe("nouvelle");
    });
  });

  it("is waited for by the fetchers of AI assistants and search engines, not by people", () => {
    const ua = (a: string) => new Request("https://rundata.re/", { headers: { "user-agent": a } });
    expect(isReader(ua("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"))).toBe(true);
    expect(isReader(ua("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)"))).toBe(true);
    expect(isReader(ua("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"))).toBe(false);
  });

  it("is waited for by the assistants' fetchers and their search robots, not by the crawlers that train a model", () => {
    const ua = (a: string) => new Request("https://rundata.re/", { headers: { "user-agent": a } });
    for (const a of [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
      "meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    ])
      expect(isReader(ua(a)), a).toBe(true);
    for (const a of [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)",
      "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    ])
      expect(isReader(ua(a)), a).toBe(false);
  });

  it("is refreshed before the answer for an AI assistant, after it for a person", async () => {
    let t = NOW.getTime();
    const c = new Cache(new MemoryStore(), () => t);
    let n = 0;
    const build = async () => ++n;
    await snapshot(c, "k", build, () => {}, new Date(t));
    t += 10 * 60_000;
    expect((await snapshot(c, "k", build, () => {}, new Date(t), 1000, true))?.value).toBe(2);
  });

  it("is served old and refreshed after the response", async () => {
    let t = NOW.getTime();
    const c = new Cache(new MemoryStore(), () => t);
    let n = 0;
    const build = async () => ++n;
    await snapshot(c, "k", build, () => {}, new Date(t));
    t += 10 * 60_000;
    const later: Promise<unknown>[] = [];
    expect((await snapshot(c, "k", build, (p) => later.push(p), new Date(t)))?.value).toBe(1);
    await Promise.all(later);
    expect((await snapshot(c, "k", build, () => {}, new Date(t)))?.value).toBe(2);
  });
});

describe("vigilance and sea pages", () => {
  async function vigilanceSample() {
    const zip = fixture("vigilance_om.zip");
    const files = await unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, (n) => n.endsWith("_FMEE_.txt"));
    return mf.parse(JSON.parse(files.get("CDPV95_FMEE_.txt")!), JSON.parse(files.get("CDPV96_FMEE_.txt")!));
  }

  it("shows the vigilance zone by zone, without a banner when all is green", async () => {
    const { r, text, used } = await serve(isolate(), "/vigilance");
    expect(r.headers.get("cache-control")).toBe("public, max-age=60");
    expect(text).toContain("Pas d'alerte cyclonique");
    expect(text).toContain("Vigilance dans les 5 zones de l'île");
    expect(text).toContain("Sud-Est");
    expect(text).toContain("Ce que dit Météo-France");
    expect(text).not.toContain('class="alerte');
    expect(used).toBeLessThanOrEqual(PAGE_BUDGET);
  });

  it("puts a banner on every page while something is above green", async () => {
    const v = structuredClone(await vigilanceSample());
    v.zones[mf.ISLAND][mf.CYCLONE] = [{ couleur: 3, debut: "2026-10-22T00:00:00Z" }];
    const a = alerteOf(v, NOW)!;
    expect(a).toEqual({ couleur: 3, texte: expect.stringContaining("ALERTE CYCLONIQUE orange"), ecoles: true, court: { cyclone: 3, prevue: false } });
    expect(homePage("https://rundata.re", null, NOW, a)).toContain('<div class="alerte vg vg3" data-court role="status">');
    // On a phone, one line to /vigilance; the sentence stays for wider screens.
    expect(homePage("https://rundata.re", null, NOW, a)).toContain('<a class="ligne" href="/vigilance"><span aria-hidden="true">⚠</span><span class="txt">Alerte cyclonique orange du préfet</span><span aria-hidden="true">→</span></a><a class="ligne" href="/ecoles-cyclone"><span class="txt">Écoles et crèches fermées</span><span aria-hidden="true">→</span></a><div class="wrap">');
    expect(homePage("https://rundata.re", null, NOW, a)).toContain('<a href="/ecoles-cyclone">Écoles fermées →</a>');
    const page = vigilancePage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW, a);
    expect(page).toContain("Alerte cyclonique orange");
    expect(page).not.toContain("Voir la vigilance zone par zone");
    v.zones[mf.ISLAND][mf.CYCLONE] = [];
    v.zones["VIGI974-12"][12] = [{ couleur: 2, debut: "2026-10-22T00:00:00Z" }];
    expect(alerteOf(v, NOW)?.texte).toBe("Vigilance Météo-France : jaune fortes pluies / orages (Est).");
    expect(alerteOf(v, NOW)?.court).toEqual({ couleur: "jaune", phenomenes: ["Fortes pluies / orages"], zones: [mf.ZONES["VIGI974-12"]] });
    // The worst colour's phenomena and zones only, each once.
    v.zones["VIGI974-11"] = { 12: [{ couleur: 2, debut: "2026-10-22T00:00:00Z" }], 1: [{ couleur: 1, debut: "2026-10-22T00:00:00Z" }] };
    expect(alerteOf(v, NOW)?.court).toMatchObject({ couleur: "jaune", phenomenes: ["Fortes pluies / orages"] });
    expect(new Set((alerteOf(v, NOW)?.court as { zones: string[] }).zones)).toEqual(new Set([mf.ZONES["VIGI974-11"], mf.ZONES["VIGI974-12"]]));
  });

  it("never says « 2 jours de retard »: a measure appears the next day at the earliest, later on cloudy days (marketing)", async () => {
    const sea = (await serve(isolate(), "/mer")).text;
    expect(sea).toContain("<h3>Au mieux, la mesure d'hier</h3>");
    expect(sea).toContain("publiée au plus tôt le lendemain");
    const place = (await serve(isolate(), "/meteo/saint-leu")).text;
    expect(place).toContain("du jour indiqué (une mesure paraît au plus tôt le lendemain)");
    for (const said of [sea, place, SEA_COVERAGE]) expect(said).not.toMatch(/jours? de (retard|décalage)/);
  });

  it("gives the sea temperature beach by beach, and the swell forecast apart", async () => {
    // The satellites' grids, which the scheduled event shares.
    const edge = new EdgeLike();
    await edge.put(SATELLITES, { value: (await counted(PAGE_BUDGET, () => buildSatellites(isolate(), NOW))).value, fetchedAt: NOW.getTime() });
    const cache = isolate(edge);
    const { text, used } = await serve(cache, "/mer");
    expect(text).toContain("Température de la mer et houle <span class=\"n974\">974</span>");
    expect(text).toMatch(/<title>Mer Réunion\u00a0: houle, température de l(&#39;|')eau et marée · 974<\/title>/);
    expect(text).toContain("Boucan-Canot");
    expect(text).toContain('href="/meteo/saint-paul"');
    expect(text).toMatch(/\d+,\d °C/);
    // The swell: its own section, labelled a forecast, one line per beach.
    const swell = text.match(/<section aria-labelledby="h-houle">[^]*?<\/section>/)![0];
    expect(swell).toContain("Prévision, pas une mesure");
    expect(swell.match(/<li>/g)).toHaveLength(14);
    expect(swell).toMatch(/<b>\d+(,\d)?\u202fm<\/b><span>(du |de l')[a-z-]+, période \d+ s, vers \d+\u00a0h<\/span><span>jusqu'à\u00a0\d+(,\d)?\u202fm /);
    expect(used).toBeLessThanOrEqual(PAGE_BUDGET);
    // A coastal commune's tile says it too, from the same copy.
    const saintLeu = await serve(cache, "/communes/saint-leu");
    expect(saintLeu.text).toMatch(/houle prévue\u00a0: \d+(,\d)?\u202fm/);
  });
});

describe("a commune's RSS feed", () => {
  /** The feed as a reader gets it: the subrequests of the response alone, then the work left for after it. */
  async function feed(cache: Cache, path: string) {
    const pending: Promise<unknown>[] = [];
    const { value, used } = await counted(PAGE_BUDGET, () => site(html(path), cache, (p) => pending.push(p), NOW));
    const text = await value!.text();
    await Promise.all(pending);
    return { r: value!, text, used };
  }
  const answer = (value: unknown) => async () => value;

  it("is read from the pages' copies, never built for the feed, and kept a few minutes", async () => {
    const edge = new EdgeLike();
    // Cold: the vigilance as every page has it; the other copies are not there yet, so it is kept a minute only.
    const cold = await feed(isolate(edge), "/communes/saint-paul.rss");
    expect(cold.r.status).toBe(200);
    expect(cold.r.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(cold.r.headers.get("cache-control")).toBe("public, max-age=60");
    expect(cold.text).toContain("<title>Saint-Paul : alertes · rundata.re</title>");
    expect(cold.text).not.toMatch(/Sentier fermé|Piton de la Fournaise/);

    // The pages' copies there (another isolate of the data center): read, and nothing else is fetched.
    const cache = isolate(edge);
    await cache.get("web:coupures", 300, answer({ resume: "", avis: [], couverture: "", a_savoir: "", sources: [], communes_suivies: [] }));
    await cache.get("web:randonnees", 300, answer({ randonnees: [], secteurs: [{ secteur: "Ouest", communes: ["Saint-Paul"], sentiers: [{ k: "s1", nom: "Sentier du Maïdo", commune: "Saint-Paul", km: 3, etat: "fermé", cause: "Éboulis", boucle: false, randonnees: [] }] }], lignes: [], fermes: 1, suivis: 1, sources: [] }));
    await cache.get("web:volcan", 300, answer({ resume: "", etat: { eruption_en_cours: false, niveau_orsec: "Alerte 1" }, avertissements: [], sources: [] }));
    vi.stubGlobal("fetch", async (url: string) => {
      throw new Error(`the feed fetched ${url}`);
    });
    const warm = await feed(cache, "/communes/saint-paul.rss");
    expect(warm.r.headers.get("cache-control")).toBe("public, max-age=300");
    expect(warm.text).toContain("<title>Sentier fermé : Sentier du Maïdo</title>");
    expect(warm.text).toContain("<title>Piton de la Fournaise : Alerte 1</title>");
    expect(warm.used).toBeLessThanOrEqual(4);
  });

  it("is announced on the commune's page and linked in its footer", async () => {
    const { text } = await serve(isolate(), "/communes/le-port");
    expect(text).toContain('<link rel="alternate" type="application/rss+xml" title="Le Port : alertes · rundata.re" href="/communes/le-port.rss">');
    expect(text).toContain('<a href="/communes/le-port.rss" title="À ajouter dans une application de lecture de flux (Feedly, NetNewsWire…)">🔔 Les alertes du Port par RSS</a>');
    // Only there.
    expect((await serve(isolate(), "/mer")).text).not.toContain("application/rss+xml");
  });

  it("has none for a place that is not a commune", async () => {
    expect((await feed(isolate(), "/communes/maido.rss")).r.status).toBe(404);
    expect((await feed(isolate(), "/communes/paris.rss")).r.status).toBe(404);
  });
});

describe("a copy the code can no longer read", () => {
  it("leaves the page without its live block, not kept, and builds the copy again after the response", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const cache = isolate();
    // A copy written by older code, fresh: the page would otherwise serve it as it is.
    await cache.get("web:mer", 3600, async () => ({ ancienne: true }));
    const { r, text } = await serve(cache, "/mer");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(text).toContain("</html>");
    expect(errors.mock.calls.some((c) => String(c[0]).startsWith("page /mer : rendu impossible"))).toBe(true);
    // Built again after the response: the next view has a copy it can read, and is kept again.
    expect((await cache.peek<object>("web:mer"))!.value).not.toHaveProperty("ancienne");
    const next = await serve(cache, "/mer");
    expect(next.r.headers.get("cache-control")).toBe("public, max-age=60");
    errors.mockRestore();
  });

  it("does the same on a page of many copies, the home page", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const cache = isolate();
    await cache.get("web:meteo", 3600, async () => ({ ancienne: true }));
    const { r, text } = await serve(cache, "/");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(text).toContain("</html>");
    expect(errors.mock.calls.some((c) => String(c[0]).startsWith("page / : rendu impossible"))).toBe(true);
    errors.mockRestore();
  });

  it("turns anything else that throws into a short page, never kept, and a line in the log", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = failed("/communes/saint-paul", new Error("champ absent"));
    expect(r.status).toBe(500);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.text()).toContain("Page indisponible pour un instant");
    expect(errors).toHaveBeenCalledWith(`erreur : /communes/saint-paul (version ${VERSION})`, expect.stringContaining("champ absent"));
    errors.mockRestore();
  });
});

describe("the maps lead to what they show", () => {
  const anchors = (page: string, prefix: string) =>
    [...(page.match(/<svg class="map[^]*?<\/svg>/g) ?? []).join("").matchAll(/<a class="(?:mk|zn)(?: [^"]*)?" href="([^"]+)" aria-label="([^"]+)"/g)]
      .filter(([, href]) => href.startsWith(prefix))
      .map(([, href, label]) => ({ href, label }));
  const ids = (page: string) => new Set([...page.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));

  it("takes each station of the weather map and of the home page's island to its row on /meteo, which exists", async () => {
    const cache = isolate();
    const meteo = (await serve(cache, "/meteo")).text;
    const here = anchors(meteo, "#");
    // One marker per station, each to its row: every station that measured, not the tour alone.
    expect(here).toHaveLength(meteo.match(/<li class="st tgt"/g)!.length);
    expect(here.length).toBeGreaterThan(40);
    const rows = ids(meteo);
    expect(here.filter((a) => !rows.has(a.href.slice(1)))).toEqual([]);
    expect(here.filter((a) => !/^[^:]+\s·\s[\d\s]+m\s:\s.+, mesures de \d\d:\d\d par .+, voir le détail$/.test(a.label))).toEqual([]);
    // The rows can be reached under the sticky header, and say so for a moment when reached.
    expect(meteo).toMatch(/<li class="st tgt" id="st-[a-z0-9-]+" /);

    const home = (await serve(cache, "/")).text;
    const there = anchors(home, "/meteo#");
    expect(there.length).toBeGreaterThan(5);
    expect(there.filter((a) => !rows.has(a.href.slice("/meteo#".length)))).toEqual([]);
  });

  it("shows the vigilance as Météo-France publishes it, without a map of the communes, and takes each of /communes to its page", async () => {
    const zip = fixture("vigilance_om.zip");
    const files = await unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, (n) => n.endsWith("_FMEE_.txt"));
    const v = mf.parse(JSON.parse(files.get("CDPV95_FMEE_.txt")!), JSON.parse(files.get("CDPV96_FMEE_.txt")!));
    const page = vigilancePage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW);
    // Météo-France's display as it publishes it: no map of ours coloured commune by commune, its link at the head of the page.
    expect(page).not.toMatch(/<svg class="map/);
    expect(anchors(page, "#")).toEqual([]);
    expect(page.indexOf('<a href="https://vigilance.meteofrance.fr/fr/la-reunion" rel="noopener">Consulter le site officiel de Météo-France</a>')).toBeLessThan(page.indexOf('id="h-zones"'));
    // Its 5 land zones, phenomenon by phenomenon.
    const cards = ids(page);
    for (const z of ["z-nord", "z-est", "z-sud-est", "z-sud", "z-ouest"]) expect(cards.has(z)).toBe(true);
    // Green said only when Météo-France issued it on all the land, on the page and the home page's tile.
    expect(page).toContain("Aucune vigilance particulière à La Réunion");
    expect(vigilanceLive({ value: v, fetchedAt: NOW, stale: false }, NOW)?.valeur).toContain("vert");
    const bare = structuredClone(v);
    for (const z of ["VIGI974-11", "VIGI974-12", "VIGI974-13", "VIGI974-14", "VIGI974-15"]) delete bare.zones[z];
    const none = vigilancePage("https://rundata.re", { value: bare, fetchedAt: NOW, stale: false }, NOW);
    expect(none).not.toContain("Aucune vigilance particulière");
    expect(none).toContain('<p class="lead">Pas de vigilance émise.</p>');
    expect(vigilanceLive({ value: bare, fetchedAt: NOW, stale: false }, NOW)).toMatchObject({ valeur: "Pas de vigilance émise" });

    const communes = communesPage("https://rundata.re");
    const links = anchors(communes, "/communes/");
    expect(links).toHaveLength(24);
    const slugs = new Set(PAGES.filter((p) => p.commune).map((p) => `/communes/${p.slug}`));
    expect(links.filter((a) => !slugs.has(a.href))).toEqual([]);
    expect(links.find((a) => a.href === "/communes/saint-pierre")?.label).toBe("Saint-Pierre, voir sa page");
  });

  it("keeps a map without links an image", () => {
    const place = placePage("https://rundata.re", pageOf("cilaos")!, null, NOW);
    expect(place).toMatch(/<svg class="map terrain" viewBox="[^"]+" role="img"/);
    expect(place).not.toMatch(/<svg class="map[^]*?<a class="(mk|zn)"[^]*?<\/svg>/);
  });
});
