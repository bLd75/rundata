import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failed, handle } from "../src/app.js";
import { WORKER_BUDGET, count, counted, later, left } from "../src/budget.js";
import { Cache, MemoryStore, TieredStore, type CacheEntry } from "../src/cache.js";
import { configure } from "../src/providers/mf-auth.js";
import * as mf from "../src/providers/vigilance.js";
import * as feux from "../src/providers/feux.js";
import { alerteOf, buildPlace, snapshot, withoutForecast } from "../src/web/data.js";
import { homePage } from "../src/web/home.js";
import { communesPage } from "../src/web/commune.js";
import { VERSION } from "../src/server.js";
import { DESCRIPTION_MAX, meteoPage, placePage, seaPage, vigilancePage } from "../src/web/pages.js";
import { PAGES, pageOf } from "../src/web/places.js";
import { isReader, site } from "../src/web/site.js";
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
  if (url.includes("noaacwLEOACSPO")) return new Response(fixture("acspo.csv"));
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
  const { value, used } = await counted(WORKER_BUDGET, async () => {
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
      for (const budget of [0, 6, 18, WORKER_BUDGET]) {
        const cache = isolate();
        for (const path of ["/sentiers", "/randonnees", "/feux", "/communes/saint-paul", "/vigilance"]) {
          const r = await within(cache, path, budget);
          expect(r.status, `${path} with ${budget}`).toBeLessThan(500);
          expect(r.used, `${path} with ${budget}`).toBeLessThanOrEqual(budget);
        }
      }
      const r = await within(isolate(), "/sentiers", WORKER_BUDGET);
      expect(r.text).toContain('<h2 id="h-feux">Feux de végétation vus par satellite</h2>');
    } finally {
      feux.configure(undefined);
    }
  });

  it("serves a commune's page cold, with its forecast, within it", async () => {
    const r = await within(isolate(), "/communes/saint-paul", WORKER_BUDGET);
    expect(r.status).toBe(200);
    expect(r.used + r.refused).toBeGreaterThan(0);
    expect(r.used).toBeLessThanOrEqual(WORKER_BUDGET);
  });
});

describe("home page", () => {
  it("renders the live block from the stations, within the Worker's subrequests, and then from cache", async () => {
    const edge = new EdgeLike();
    const cold = await serve(isolate(edge), "/");
    expect(cold.r.headers.get("cache-control")).toBe("public, max-age=60");
    expect(cold.text).toContain("<h1>La Réunion <span class=\"n974\">974</span> en direct</h1>");
    // The hero's island carries the temperatures measured now.
    // Each temperature leads to its station's row on the weather page.
    expect(cold.text).toMatch(/<figure class="hero-map"><svg class="map relief" viewBox="[^"]+" role="group"[^]*?<a class="mk" href="\/meteo#st-[a-z0-9-]+" aria-label="[^"]+ : \d+ °C, voir le détail"><circle class="hit"[^>]+\/><title>[^<]+<\/title><circle class="sh"/);
    expect(cold.text).toMatch(/meteo_actuelle\(lieu: "[^"]+"\)<\/p>\s*<p class="bubble ai">\d+(,\d)?\u202f°C, mesurés à \d\d:\d\d/);
    expect(cold.text).toContain("Piton Maïdo");
    expect(cold.text).toMatch(/mesuré à \d\d:\d\d/);
    // The badge says when the stations measured, never « en direct » at a time already past; the script counts the age
    // again in the browser, from the time of the data.
    expect(cold.text).not.toContain("En direct · <b>");
    expect(cold.text).toMatch(/<span data-nojs>Mesures de <b>\d\d:\d\d<\/b> à La Réunion<\/span><span data-js hidden><b data-clock>\d\d:\d\d<\/b> à La Réunion · mesuré <span data-age="[\dT:.-]+Z">il y a \d+ (min|h)<\/span>/);
    expect(cold.used).toBeLessThanOrEqual(WORKER_BUDGET);
    // Another isolate of the same data center: the weather from the edge, and the oldest of the other tiles brought up
    // to date afterwards, still within the limit.
    const warm = await serve(isolate(edge), "/");
    expect(warm.text).toContain("Piton Maïdo");
    expect(warm.used).toBeLessThanOrEqual(WORKER_BUDGET);
  });

  it("reads no tile from the data center's cache on a warm isolate whose copies are fresh", async () => {
    // Every tile's copy fresh in the data center's cache, as other isolates left them, and the weather's too.
    const edge = new ReadsByKey();
    for (const key of ["web:meteo", "web:actualites", "web:volcan", "web:air", "web:electricite", "web:calendrier", "web:bus", "web:trafic", "web:velos", "web:bornes", "web:eau", "web:sentiers", "web:secheresse", "web:coupures", "web:sport", "web:cyclones", "web:historique", "web:agenda"]) {
      await edge.put(key, { value: {}, fetchedAt: NOW.getTime() });
    }
    const cache = isolate(edge);
    // These copies are empty: the page is served without them (site.ts), only the reads matter here.
    await serve(cache, "/");
    const tileReads = () => [...edge.reads].filter(([k]) => k.startsWith("web:") && k !== "web:meteo").reduce((a, [, n]) => a + n, 0);
    expect(tileReads()).toBe(17);
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
    expect(meteoPage("https://rundata.re", null, NOW)).toMatch(/<a class="k-meteo" href="\/meteo" aria-current="page"><span class="kb"><svg[^]*?<\/svg><\/span>Météo<\/a>/);
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
    for (const link of ["https://www.facebook.com/1432704299917309", "https://glama.ai/mcp/servers/bLd75/rundata", "https://github.com/rundata-re/rundata", "https://www.data.gouv.fr/reuses/"]) expect(page).toContain(`href="${link}`);
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

  it("show the measurement cold within the budget, the labelled forecast from the next build, warm from one read", async () => {
    const edge = new EdgeLike();
    const cold = await serve(isolate(edge), "/meteo/cilaos");
    expect(cold.text).toContain("<h1>Météo à Cilaos <span class=\"n974\">974</span></h1>");
    expect(cold.text).toContain("Mesuré en ce moment près de Cilaos");
    expect(cold.text).not.toContain("Température de la mer à Cilaos");
    expect(cold.used).toBeLessThanOrEqual(WORKER_BUDGET);
    // Cold, the stations take most of the budget: the forecast is left out rather than risk it (FORECAST_MIN_LEFT
    // in web/data.ts). The data center's next build of the page, its stations stored, has it.
    expect(cold.text).not.toContain("Prévision, pas une mesure");
    const next = await counted(WORKER_BUDGET, () => buildPlace(isolate(edge), pageOf("cilaos")!, NOW));
    expect(next.used).toBeLessThanOrEqual(WORKER_BUDGET);
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
    expect(used).toBeLessThanOrEqual(WORKER_BUDGET);
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
    expect(cold.text).toContain("pour la zone Ouest");
    expect(cold.text).toMatch(/<h3>Mairie<\/h3><p class="tv">(Ouverte|Fermée)<\/p>/);
    expect(cold.text).toContain("Mer"); // on the coast
    expect(cold.used).toBeLessThanOrEqual(WORKER_BUDGET);
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
    expect(cold.text).toMatch(/mesurés à \d\d:\d\d par la station/);
    expect(cold.text).toContain("rundata.re ne mesure pas les bouchons");
    expect(cold.text).toMatch(/Pas de copie récente pour\u00a0: .*<a href="\/coupures-eau\/saint-leu">coupures d&#39;eau<\/a>/);
    expect(cold.used).toBeLessThanOrEqual(WORKER_BUDGET);
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
  it("robots.txt points to the sitemap, which lists every page", async () => {
    const robots = await (await handle(new Request("https://rundata.re/robots.txt"), isolate())).text();
    expect(robots).toContain("Sitemap: https://rundata.re/sitemap.xml");
    const map = await (await handle(new Request("https://rundata.re/sitemap.xml"), isolate())).text();
    // The pages, the 24 communes, their water and their day, a page per hike and per ONF trail with its GPS trace, and per past cyclone.
    expect(map.match(/<loc>/g)).toHaveLength(PAGES.length + 46 + 24 + 24 + 24 + SECTEURS_RANDO.length + RANDONNEES.length + Object.keys(SENTIERS).length + PASSES.length);
    expect(map).toContain("<loc>https://rundata.re/enfants</loc>");
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

  it("serves a 1200×630 PNG for link previews, and the flag as favicon", async () => {
    const r = await handle(new Request("https://rundata.re/og.png"), isolate());
    const png = new Uint8Array(await r.arrayBuffer());
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(png.length).toBeLessThan(300_000);
    const view = new DataView(png.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
    const icon = await handle(new Request("https://rundata.re/favicon.svg"), isolate());
    expect(await icon.text()).toContain("#e3262d");
  });

  it("lays the island's relief under the hero map, a WebP kept for good", async () => {
    const page = homePage("https://rundata.re", null);
    const path = page.match(/<image href="(\/relief-[0-9a-f]{8}\.webp)"/)?.[1];
    expect(path).toBeDefined();
    const r = await handle(new Request(`https://rundata.re${path}`), isolate());
    const webp = new Uint8Array(await r.arrayBuffer());
    expect(r.headers.get("content-type")).toBe("image/webp");
    expect(r.headers.get("cache-control")).toContain("immutable");
    expect(new TextDecoder().decode(webp.slice(8, 12))).toBe("WEBP");
    expect(webp.length).toBeLessThan(250_000);
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

  it("is waited for by the fetchers of AI assistants and search engines, not by people", () => {
    const ua = (a: string) => new Request("https://rundata.re/", { headers: { "user-agent": a } });
    expect(isReader(ua("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"))).toBe(true);
    expect(isReader(ua("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)"))).toBe(true);
    expect(isReader(ua("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"))).toBe(false);
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
    expect(used).toBeLessThanOrEqual(WORKER_BUDGET);
  });

  it("puts a banner on every page while something is above green", async () => {
    const v = structuredClone(await vigilanceSample());
    v.zones[mf.ISLAND][mf.CYCLONE] = [{ couleur: 3, debut: "2026-10-22T00:00:00Z" }];
    const a = alerteOf(v, NOW)!;
    expect(a).toEqual({ couleur: 3, texte: expect.stringContaining("ALERTE CYCLONIQUE orange"), ecoles: true });
    expect(homePage("https://rundata.re", null, NOW, a)).toContain('<div class="alerte vg vg3" role="status">');
    expect(homePage("https://rundata.re", null, NOW, a)).toContain('<a href="/ecoles-cyclone">Écoles fermées →</a>');
    const page = vigilancePage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW, a);
    expect(page).toContain("Alerte cyclonique orange");
    expect(page).not.toContain("Voir la vigilance zone par zone");
    v.zones[mf.ISLAND][mf.CYCLONE] = [];
    v.zones["VIGI974-12"][12] = [{ couleur: 2, debut: "2026-10-22T00:00:00Z" }];
    expect(alerteOf(v, NOW)?.texte).toBe("Vigilance Météo-France : jaune fortes pluies / orages (Est).");
  });

  it("gives the sea temperature beach by beach, and the swell forecast apart", async () => {
    const cache = isolate();
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
    expect(swell).toMatch(/<b>\d+(,\d)?\u202fm<\/b><span>(du |de l')[a-z-]+, période \d+ s, vers \d+h<\/span><span>jusqu'à \d+(,\d)?\u202fm /);
    expect(used).toBeLessThanOrEqual(WORKER_BUDGET);
    // A coastal commune's tile says it too, from the same copy.
    const saintLeu = await serve(cache, "/communes/saint-leu");
    expect(saintLeu.text).toMatch(/houle prévue\u00a0: \d+(,\d)?\u202fm/);
  });
});

describe("a commune's RSS feed", () => {
  /** The feed as a reader gets it: the subrequests of the response alone, then the work left for after it. */
  async function feed(cache: Cache, path: string) {
    const pending: Promise<unknown>[] = [];
    const { value, used } = await counted(WORKER_BUDGET, () => site(html(path), cache, (p) => pending.push(p), NOW));
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
    [...(page.match(/<svg class="map[^]*?<\/svg>/g) ?? []).join("").matchAll(/<a class="(?:mk|zn)" href="([^"]+)" aria-label="([^"]+)"/g)]
      .filter(([, href]) => href.startsWith(prefix))
      .map(([, href, label]) => ({ href, label }));
  const ids = (page: string) => new Set([...page.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));

  it("takes each station of the weather map and of the home page's island to its row on /meteo, which exists", async () => {
    const cache = isolate();
    const meteo = (await serve(cache, "/meteo")).text;
    const here = anchors(meteo, "#");
    // One marker per station, each to its row.
    expect(here).toHaveLength(meteo.match(/<li class="st tgt"/g)!.length);
    expect(here.length).toBeGreaterThan(5);
    const rows = ids(meteo);
    expect(here.filter((a) => !rows.has(a.href.slice(1)))).toEqual([]);
    expect(here.every((a) => /^[^:]+ : (\d+ °C|vent \d+ km\/h|pas de mesure), voir le détail$/.test(a.label))).toBe(true);
    // The rows can be reached under the sticky header, and say so for a moment when reached.
    expect(meteo).toMatch(/<li class="st tgt" id="st-[a-z0-9-]+">/);

    const home = (await serve(cache, "/")).text;
    const there = anchors(home, "/meteo#");
    expect(there.length).toBeGreaterThan(5);
    expect(there.filter((a) => !rows.has(a.href.slice("/meteo#".length)))).toEqual([]);
  });

  it("takes each commune of the vigilance map to the card of its zone, and each of /communes to its page", async () => {
    const zip = fixture("vigilance_om.zip");
    const files = await unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, (n) => n.endsWith("_FMEE_.txt"));
    const v = mf.parse(JSON.parse(files.get("CDPV95_FMEE_.txt")!), JSON.parse(files.get("CDPV96_FMEE_.txt")!));
    const page = vigilancePage("https://rundata.re", { value: v, fetchedAt: NOW, stale: false }, NOW);
    const zones = anchors(page, "#");
    expect(zones).toHaveLength(24);
    const cards = ids(page);
    expect(zones.filter((a) => !cards.has(a.href.slice(1)))).toEqual([]);
    expect(new Set(zones.map((a) => a.href))).toEqual(new Set(["#z-nord", "#z-est", "#z-sud-est", "#z-sud", "#z-ouest"]));
    expect(zones.find((a) => a.label.startsWith("Saint-Pierre :"))?.label).toMatch(/^Saint-Pierre : (vigilance \p{L}+|rien d'émis), zone Sud, voir le détail$/u);
    expect(page).toMatch(/<svg class="map" viewBox="[^"]+" role="group"/);

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
